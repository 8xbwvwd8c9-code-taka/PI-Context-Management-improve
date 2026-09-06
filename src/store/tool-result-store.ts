/**
 * Tool-result durability store.
 *
 * S03 implements the data-plane mechanics for tool-result
 * virtualization. R02 §9, §10, §15 are the binding contract.
 *
 *   full tool result
 *   → durable persistence
 *   → integrity verification / reference
 *   → bounded active representation
 *   → recover on demand
 *
 * Hard invariant: the FULL authoritative bytes are persisted FIRST.
 * A `cmv3://tool/<id>` ref is issued ONLY after:
 *
 *   1. the payload artifact is on disk (binary-safe, atomic)
 *   2. the metadata artifact is on disk (atomic, JSON with the
 *      SHA-256 of the authoritative bytes)
 *   3. the metadata integrity envelope verifies cleanly
 *
 * If any step fails, NO ref is issued, the partial directory
 * MAY be cleaned up (best-effort), and the caller receives a
 * `ToolResultPersistenceError` plus a non-recoverable active view.
 *
 * Project isolation: a ref does NOT embed the project id. The
 * caller is required to pass `projectId` at lookup time. Cross-
 * project ref lookups are rejected with `ToolResultAccessError`.
 *
 * Tool output is UNTRUSTED DATA. This store NEVER interprets the
 * payload bytes. It does not parse them, summarize them, or
 * extract commands. The bytes go through a SHA-256 hash and to
 * disk; the active view is a mechanical head/tail window.
 *
 * Generic contract: no tool-specific strings appear in paths,
 * filenames, or the active view marker. The store works for any
 * byte payload: shell output, test logs, build output, JSON,
 * binary blobs, anything.
 */

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
	buildActiveView,
	buildFailureActiveView,
	DEFAULT_ACTIVE_VIEW_POLICY,
	TOOL_RESULT_METADATA_SCHEMA_VERSION,
	validateToolResultMetadata,
	type ActiveViewPolicy,
	type ToolResultActiveView,
	type ToolResultMetadata,
} from "../core/tool-result.js";
import {
	makeRef,
	parseRef,
	requireRef,
} from "../core/refs.js";

import {
	atomicWriteBytes,
	atomicWriteFile,
	ensureDir,
} from "./atomic.js";
import { generateId } from "./ids.js";
import {
	canonicalJsonStringify,
	seal,
	sha256Hex,
	verify,
	type IntegrityEnvelope,
} from "./integrity.js";
import {
	appendIndexEntry,
	readIndex,
	rebuildIndex,
	type IndexEntry,
} from "./index-table.js";
import {
	toolResultDir,
	toolResultMetadataPath,
	toolResultPayloadPath,
	type StoreLayout,
} from "./paths.js";

export interface ToolResultStore {
	/**
	 * Persist a tool result. Returns the authoritative record
	 * (metadata + ref) ONLY after both artifacts are on disk and
	 * the integrity envelope verifies. Throws on any failure; the
	 * caller MUST treat the exception as "no durable copy".
	 */
	write(
		bytes: Uint8Array,
		input: ToolResultWriteInput,
		opts?: { policy?: ActiveViewPolicy },
	): ToolResultWriteOutput;

	/**
	 * Read the authoritative metadata for a tool result. The
	 * payload is NOT loaded.
	 */
	metadata(refOrId: string, projectId: string): ToolResultMetadata;

	/**
	 * Read the full authoritative bytes for a tool result.
	 * Verifies the SHA-256 over the bytes before returning.
	 */
	read(refOrId: string, projectId: string): Uint8Array;

	/**
	 * Read a byte-range slice of the authoritative bytes. The
	 * range is [start, end) (byte offsets, 0-based). The bytes
	 * are read from disk and the SHA-256 is verified against the
	 * metadata; the slice is then carved out of the verified
	 * bytes. The slice itself is NOT separately hashed.
	 *
	 * Range checks (negative start, end > length, start >= length,
	 * end < start) throw `RangeError` synchronously before any
	 * I/O.
	 */
	readRange(
		refOrId: string,
		projectId: string,
		start: number,
		end: number,
	): Uint8Array;

	/**
	 * Build the bounded active view for a tool result. The full
	 * bytes are NOT loaded; the view is constructed from the
	 * metadata's stored count + the recorded head/tail window
	 * alone when the payload is not in memory. When the caller
	 * already has the bytes (e.g. right after a write), use
	 * `buildActiveViewForBytes`.
	 */
	buildActiveView(
		refOrId: string,
		projectId: string,
		policy: ActiveViewPolicy,
	): ToolResultActiveView;

	/**
	 * Build the bounded active view directly from in-memory bytes
	 * (no I/O). Used right after a successful write.
	 */
	buildActiveViewForBytes(
		bytes: Uint8Array,
		metadata: ToolResultMetadata,
		policy: ActiveViewPolicy,
	): ToolResultActiveView;

	/**
	 * Build the failure-mode active view (no ref, non_recoverable).
	 * Used by callers when persistence fails; the view does NOT
	 * claim durability and does NOT fabricate a cmv3://tool ref.
	 */
	buildFailureView(
		bytes: Uint8Array,
		toolName: string,
		reason: string,
		policy?: ActiveViewPolicy,
	): ReturnType<typeof buildFailureActiveView>;

	/**
	 * List tool results for a project, optionally filtered.
	 */
	list(projectId: string, filters?: ToolResultListFilters): ToolResultSummary[];

	/**
	 * Build the canonical ref for an id (caller-side).
	 */
	refFor(id: string): string;
}

export interface ToolResultWriteInput {
	project_id: string;
	tool_name: string;
	session_id?: string | null;
	tool_call_id?: string | null;
	result_kind?: string;
	exit_code?: number | null;
	success?: boolean | null;
	mime_type?: string | null;
	created_at?: string;
}

export interface ToolResultWriteOutput {
	ref: string;
	id: string;
	metadata: ToolResultMetadata;
	active_view: ToolResultActiveView;
}

export interface ToolResultListFilters {
	toolName?: string;
	sessionId?: string;
	since?: string;
	until?: string;
	truncatedOnly?: boolean;
}

export interface ToolResultSummary {
	id: string;
	ref: string;
	tool_name: string;
	session_id: string | null;
	created_at: string;
	original_bytes: number;
	stored_bytes: number;
	truncated_in_active_view: boolean;
	content_hash: string;
	mime_type: string | null;
}

/**
 * Thrown by the store when persistence fails. Callers MUST treat
 * this as "no durable copy, no valid ref".
 */
export class ToolResultPersistenceError extends Error {
	constructor(
		message: string,
		readonly stage: "payload" | "metadata" | "finalize" | "unknown",
		readonly cause?: unknown,
	) {
		super(message);
		this.name = "ToolResultPersistenceError";
	}
}

/**
 * Thrown when a ref cannot be resolved, or when the lookup is
 * for the wrong project. The store does NOT silently return a
 * different project's record.
 */
export class ToolResultAccessError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolResultAccessError";
	}
}

export function createToolResultStore(layout: StoreLayout): ToolResultStore {
	return new FsToolResultStore(layout);
}

class FsToolResultStore implements ToolResultStore {
	constructor(private readonly layout: StoreLayout) {}

	write(
		bytes: Uint8Array,
		input: ToolResultWriteInput,
		opts: { policy?: ActiveViewPolicy } = {},
	): ToolResultWriteOutput {
		if (!(bytes instanceof Uint8Array)) {
			throw new ToolResultPersistenceError("write: bytes must be a Uint8Array", "unknown");
		}
		if (typeof input !== "object" || input === null) {
			throw new ToolResultPersistenceError("write: input must be an object", "unknown");
		}
		if (typeof input.project_id !== "string" || input.project_id.length === 0) {
			throw new ToolResultPersistenceError("write: input.project_id is required", "unknown");
		}
		if (typeof input.tool_name !== "string" || input.tool_name.length === 0) {
			throw new ToolResultPersistenceError("write: input.tool_name is required", "unknown");
		}
		const policy = opts.policy ?? undefined;

		const id = generateId();
		const projectId = input.project_id;
		const ref = makeRef("tool", id);

		const dir = toolResultDir(this.layout, projectId, id);
		const payloadPath = toolResultPayloadPath(this.layout, projectId, id);
		const metadataPath = toolResultMetadataPath(this.layout, projectId, id);

		// Stage 1: payload (binary-safe, atomic).
		try {
			atomicWriteBytes(payloadPath, bytes);
		} catch (err) {
			// No metadata was created yet; nothing to clean up.
			throw new ToolResultPersistenceError(
				`tool-result payload write failed for ${ref}: ${(err as Error).message}`,
				"payload",
				err,
			);
		}

		// Stage 2: metadata. We hash the authoritative bytes AFTER
		// the payload is on disk so the hash always reflects what is
		// durably stored (defense against any subtle in-memory vs
		// on-disk divergence).
		let hash: string;
		try {
			hash = sha256Hex(Buffer.from(bytes).toString("binary"));
		} catch (err) {
			// Should not happen with Buffer, but stay defensive.
			tryCleanDir(dir);
			throw new ToolResultPersistenceError(
				`tool-result hash computation failed for ${ref}: ${(err as Error).message}`,
				"metadata",
				err,
			);
		}

		const createdAt = input.created_at ?? new Date().toISOString();
		const decoded = canDecodeUtf8(bytes);
		const encoding: "utf-8" | "binary" = decoded ? "utf-8" : "binary";

		// Compute the active-view bytes WITHOUT re-loading the
		// payload (it is already in memory). We need a policy at
		// this point; fall back to the default if the caller did
		// not supply one. The frozen DEFAULT_ACTIVE_VIEW_POLICY
		// is a pre-validated constant; no runtime check needed.
		const effPolicy = policy ?? DEFAULT_ACTIVE_VIEW_POLICY;

		const active = buildActiveView(bytes, effPolicy, {
			ref,
			tool_name: input.tool_name,
			tool_call_id: input.tool_call_id ?? null,
			result_kind: input.result_kind ?? "text",
			success: input.success ?? null,
			exit_code: input.exit_code ?? null,
			content_hash: hash,
			mime_type: input.mime_type ?? null,
		});

		const metadata: ToolResultMetadata = {
			schema_version: TOOL_RESULT_METADATA_SCHEMA_VERSION,
			tool_result_id: id,
			project_id: projectId,
			session_id: input.session_id ?? null,
			created_at: createdAt,
			tool_name: input.tool_name,
			tool_call_id: input.tool_call_id ?? null,
			result_kind: input.result_kind ?? "text",
			exit_code: input.exit_code ?? null,
			success: input.success ?? null,
			original_bytes: bytes.byteLength,
			stored_bytes: bytes.byteLength,
			active_excerpt_bytes: active.active_excerpt_bytes,
			truncated_in_active_view: active.truncated,
			content_hash: hash,
			encoding,
			mime_type: input.mime_type ?? null,
			ref,
		};

		// Stage 3: seal + atomic metadata write. If this fails, we
		// MUST clean up the payload so we do not leave an orphan
		// authoritative artifact without a recoverable ref.
		let envelope: IntegrityEnvelope<ToolResultMetadata>;
		try {
			envelope = seal(metadata, TOOL_RESULT_METADATA_SCHEMA_VERSION);
		} catch (err) {
			tryCleanDir(dir);
			throw new ToolResultPersistenceError(
				`tool-result metadata seal failed for ${ref}: ${(err as Error).message}`,
				"metadata",
				err,
			);
		}
		const body = canonicalJsonStringify(envelope);
		try {
			ensureDir(dir);
			atomicWriteFile(metadataPath, body);
		} catch (err) {
			// The payload is on disk; remove it to keep the store
			// consistent. A successful later write of the same id
			// is not possible (id is CSPRNG), so the directory is
			// safely removable.
			tryCleanDir(dir);
			throw new ToolResultPersistenceError(
				`tool-result metadata write failed for ${ref}: ${(err as Error).message}`,
				"metadata",
				err,
			);
		}

		// Stage 4: append to the derived index. Failure here does
		// NOT delete the authoritative record; the index is
		// rebuildable. The ref is still issued.
		try {
			appendIndexEntry(this.layout, projectId, "tool-results", {
				ref,
				id,
				tool_name: input.tool_name,
				session_id: input.session_id ?? null,
				created_at: createdAt,
				original_bytes: bytes.byteLength,
				stored_bytes: bytes.byteLength,
				truncated_in_active_view: active.truncated,
				content_hash: hash,
				mime_type: input.mime_type ?? null,
			});
		} catch {
			// Index rebuild will recover this on next read.
		}

		return { ref, id, metadata, active_view: active };
	}

	metadata(refOrId: string, projectId: string): ToolResultMetadata {
		const id = resolveIdForProject(refOrId, projectId);
		const path = toolResultMetadataPath(this.layout, projectId, id);
		if (!existsSync(path)) {
			throw new ToolResultAccessError(
				`tool-result metadata not found for project ${projectId}: ${refOrId}`,
			);
		}
		return loadAndVerifyMetadata(path, projectId, id);
	}

	read(refOrId: string, projectId: string): Uint8Array {
		const id = resolveIdForProject(refOrId, projectId);
		const meta = this.metadata(refOrId, projectId);
		const path = toolResultPayloadPath(this.layout, projectId, id);
		if (!existsSync(path)) {
			throw new ToolResultAccessError(
				`tool-result payload missing for project ${projectId}: ${refOrId}`,
			);
		}
		const bytes = readFileSync(path);
		// Integrity verification: re-hash and compare. Mismatch is
		// a hard error; we do NOT return the corrupted bytes.
		const observed = sha256Hex(Buffer.from(bytes).toString("binary"));
		if (observed !== meta.content_hash) {
			throw new ToolResultAccessError(
				`tool-result ${refOrId} payload integrity mismatch (expected ${meta.content_hash}, got ${observed})`,
			);
		}
		return bytes;
	}

	readRange(
		refOrId: string,
		projectId: string,
		start: number,
		end: number,
	): Uint8Array {
		if (!Number.isInteger(start) || start < 0) {
			throw new RangeError(`readRange: start must be a non-negative integer (got ${start})`);
		}
		if (!Number.isInteger(end) || end < 0) {
			throw new RangeError(`readRange: end must be a non-negative integer (got ${end})`);
		}
		if (end < start) {
			throw new RangeError(`readRange: end (${end}) must be >= start (${start})`);
		}
		const meta = this.metadata(refOrId, projectId);
		const length = meta.original_bytes;
		// start >= length => zero-byte slice; do not throw, allow
		// callers to probe past EOF.
		if (start > length) {
			throw new RangeError(
				`readRange: start (${start}) escapes artifact length (${length})`,
			);
		}
		// end > length => range escapes the artifact.
		if (end > length) {
			throw new RangeError(
				`readRange: end (${end}) escapes artifact length (${length})`,
			);
		}
		const path = toolResultPayloadPath(this.layout, projectId, resolveIdForProject(refOrId, projectId));
		const bytes = readFileSync(path);
		const observed = sha256Hex(Buffer.from(bytes).toString("binary"));
		if (observed !== meta.content_hash) {
			throw new ToolResultAccessError(
				`tool-result ${refOrId} payload integrity mismatch on readRange (expected ${meta.content_hash}, got ${observed})`,
			);
		}
		return bytes.subarray(start, end);
	}

	buildActiveView(
		refOrId: string,
		projectId: string,
		policy: ActiveViewPolicy,
	): ToolResultActiveView {
		const meta = this.metadata(refOrId, projectId);
		// For oversized results, we DO need the head/tail bytes.
		// For small results we need the whole thing. We always
		// read the artifact and verify it; the active view is the
		// bounded representation.
		const bytes = this.read(refOrId, projectId);
		return buildActiveView(bytes, policy, {
			ref: meta.ref,
			tool_name: meta.tool_name,
			tool_call_id: meta.tool_call_id,
			result_kind: meta.result_kind,
			success: meta.success,
			exit_code: meta.exit_code,
			content_hash: meta.content_hash,
			mime_type: meta.mime_type,
		});
	}

	buildActiveViewForBytes(
		bytes: Uint8Array,
		metadata: ToolResultMetadata,
		policy: ActiveViewPolicy,
	): ToolResultActiveView {
		return buildActiveView(bytes, policy, {
			ref: metadata.ref,
			tool_name: metadata.tool_name,
			tool_call_id: metadata.tool_call_id,
			result_kind: metadata.result_kind,
			success: metadata.success,
			exit_code: metadata.exit_code,
			content_hash: metadata.content_hash,
			mime_type: metadata.mime_type,
		});
	}

	buildFailureView(
		bytes: Uint8Array,
		toolName: string,
		reason: string,
		policy?: ActiveViewPolicy,
	) {
		const eff = policy ?? DEFAULT_ACTIVE_VIEW_POLICY;
		return buildFailureActiveView(bytes, eff, {
			tool_name: toolName,
			reason,
		});
	}

	list(projectId: string, filters: ToolResultListFilters = {}): ToolResultSummary[] {
		const entries = readIndex<ToolResultIndexEntry>(this.layout, projectId, "tool-results");
		const out: ToolResultSummary[] = [];
		for (const e of entries) {
			if (filters.toolName && e.tool_name !== filters.toolName) continue;
			if (filters.sessionId && e.session_id !== filters.sessionId) continue;
			if (filters.since && e.created_at < filters.since) continue;
			if (filters.until && e.created_at > filters.until) continue;
			if (filters.truncatedOnly === true && !e.truncated_in_active_view) continue;
			if (filters.truncatedOnly === false && e.truncated_in_active_view) continue;
			out.push({
				id: e.id,
				ref: e.ref,
				tool_name: e.tool_name,
				session_id: e.session_id,
				created_at: e.created_at,
				original_bytes: e.original_bytes,
				stored_bytes: e.stored_bytes,
				truncated_in_active_view: e.truncated_in_active_view,
				content_hash: e.content_hash,
				mime_type: e.mime_type,
			});
		}
		// Deterministic order: created_at desc, then id desc.
		out.sort((a, b) => {
			if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
			return a.id < b.id ? 1 : -1;
		});
		return out;
	}

	refFor(id: string): string {
		return makeRef("tool", id);
	}
}

/* -------------------------------------------------------------------- *
 * Internal helpers                                                      *
 * -------------------------------------------------------------------- */

interface ToolResultIndexEntry extends IndexEntry {
	tool_name: string;
	session_id: string | null;
	created_at: string;
	original_bytes: number;
	stored_bytes: number;
	truncated_in_active_view: boolean;
	content_hash: string;
	mime_type: string | null;
}

function resolveIdForProject(refOrId: string, _projectId: string): string {
	if (typeof refOrId !== "string" || refOrId.length === 0) {
		throw new ToolResultAccessError(`resolveIdForProject: invalid ref/id (${String(refOrId)})`);
	}
	if (refOrId.startsWith("cmv3://")) {
		// Project isolation: a cmv3://tool/<id> ref does NOT
		// embed the project id, but the ref's id is the opaque
		// id we minted in this project. The caller MUST supply
		// the matching projectId; the metadata file lives at
		// <projectId>/tool-results/<id>/metadata.json, so a wrong
		// projectId will simply not find the file and throw.
		const parsed = parseRef(refOrId);
		if (parsed === null || parsed.kind !== "tool") {
			throw new ToolResultAccessError(
				`resolveIdForProject: ref is not a valid cmv3://tool/ ref: ${refOrId}`,
			);
		}
		// Defense in depth: requireRef() throws on malformed refs.
		requireRef(refOrId);
		return parsed.id;
	}
	// Bare id path. Validate against the S01 id alphabet; the
	// id generator already enforces this, but accept an id-shaped
	// string for the (rare) ref-less call site.
	if (!/^[a-z0-9_-]{8,128}$/.test(refOrId)) {
		throw new ToolResultAccessError(
			`resolveIdForProject: id must match [a-z0-9_-]{8,128} (got ${refOrId})`,
		);
	}
	return refOrId;
}

function loadAndVerifyMetadata(
	path: string,
	projectId: string,
	id: string,
): ToolResultMetadata {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (err) {
		throw new ToolResultAccessError(
			`cannot read tool-result metadata ${id} for project ${projectId}: ${(err as Error).message}`,
		);
	}
	let envelope: IntegrityEnvelope<unknown>;
	try {
		envelope = JSON.parse(raw) as IntegrityEnvelope<unknown>;
	} catch (err) {
		throw new ToolResultAccessError(
			`tool-result metadata ${id} is not valid JSON: ${(err as Error).message}`,
		);
	}
	if (envelope.schema_version !== TOOL_RESULT_METADATA_SCHEMA_VERSION) {
		throw new ToolResultAccessError(
			`tool-result metadata ${id} has unsupported schema_version ${envelope.schema_version} (expected ${TOOL_RESULT_METADATA_SCHEMA_VERSION})`,
		);
	}
	let content: ToolResultMetadata;
	try {
		content = verify(envelope) as ToolResultMetadata;
	} catch (err) {
		throw new ToolResultAccessError(
			`tool-result metadata ${id} failed integrity check: ${(err as Error).message}`,
		);
	}
	// Run the pure validator as well; this catches structural
	// drift (e.g. an old format with a missing field).
	validateToolResultMetadata(content);
	if (content.tool_result_id !== id) {
		throw new ToolResultAccessError(
			`tool-result id mismatch: file ${id} but content says ${content.tool_result_id}`,
		);
	}
	if (content.project_id !== projectId) {
		throw new ToolResultAccessError(
			`tool-result project_id mismatch: ${content.project_id} vs ${projectId}`,
		);
	}
	return content;
}

function canDecodeUtf8(bytes: Uint8Array): boolean {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

function tryCleanDir(dir: string): void {
	try {
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
		}
	} catch {
		// best-effort; the next call to the store will overwrite.
	}
}

/**
 * Re-scan the authoritative tool-result directories and rebuild
 * the derived index. The index is metadata only; the payloads
 * are never re-read for the index. Returns the number of entries
 * rebuilt.
 */
export function rebuildToolResultIndex(
	layout: StoreLayout,
	projectId: string,
): number {
	const root = join(layout.projectsRoot, projectId, "tool-results");
	if (!existsSync(root)) return 0;
	const dirs = readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);
	const summaries: ToolResultSummary[] = [];
	for (const id of dirs) {
		const metaPath = toolResultMetadataPath(layout, projectId, id);
		if (!existsSync(metaPath)) continue;
		let meta: ToolResultMetadata;
		try {
			meta = loadAndVerifyMetadata(metaPath, projectId, id);
		} catch {
			// Skip unreadable records; do not block rebuild.
			continue;
		}
		summaries.push({
			id: meta.tool_result_id,
			ref: meta.ref,
			tool_name: meta.tool_name,
			session_id: meta.session_id,
			created_at: meta.created_at,
			original_bytes: meta.original_bytes,
			stored_bytes: meta.stored_bytes,
			truncated_in_active_view: meta.truncated_in_active_view,
			content_hash: meta.content_hash,
			mime_type: meta.mime_type,
		});
	}
	// Sort deterministically.
	summaries.sort((a, b) => {
		if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
		return a.id < b.id ? -1 : 1;
	});
	// Build index entries in the canonical form.
	const entries: ToolResultIndexEntry[] = summaries.map((s) => ({
		ref: s.ref,
		id: s.id,
		tool_name: s.tool_name,
		session_id: s.session_id,
		created_at: s.created_at,
		original_bytes: s.original_bytes,
		stored_bytes: s.stored_bytes,
		truncated_in_active_view: s.truncated_in_active_view,
		content_hash: s.content_hash,
		mime_type: s.mime_type,
	}));
	rebuildIndex(layout, projectId, "tool-results", entries);
	return summaries.length;
}
