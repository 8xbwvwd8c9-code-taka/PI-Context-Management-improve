/**
 * RolloverRequest store.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §9, §10.
 *
 * The rollover store is a thin I/O layer that:
 *   - validates before persistence
 *   - writes the request.json atomically inside a per-id directory
 *   - enforces the S04 state machine on every write
 *   - enforces project + session identity invariants
 *   - returns an opaque cmv3://rollover/<id> ref only on success
 *   - never mutates an existing record in place from the caller's
 *     point of view: state changes are explicit transitions that
 *     re-seal the same record file
 *
 * The store does NOT call `ctx.newSession()`. It is the data plane
 * the orchestrator consumes. The orchestrator is the only surface
 * allowed to call newSession, and only through the supported
 * ExtensionCommandContext.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
	makeRef,
	requireRef,
	type ParsedRef,
	type RolloverFailureCode,
	type RolloverRequest,
	type RolloverState,
} from "../core/index.js";
import {
	isAllowedRolloverTransition,
	ROLLOVER_SCHEMA_VERSION,
	validateRolloverRequest,
} from "../core/rollover.js";

import { atomicWriteFile, ensureDir } from "./atomic.js";
import { generateId } from "./ids.js";
import {
	canonicalJsonStringify,
	seal,
	verify,
	type IntegrityEnvelope,
} from "./integrity.js";
import {
	appendIndexEntry,
	clearIndex,
	readIndex,
	rebuildIndex,
	type IndexEntry,
} from "./index-table.js";
import {
	rolloverRequestPath,
	type StoreLayout,
} from "./paths.js";

export const ROLLOVER_REF_KIND = "rollover" as const;

export interface RolloverStore {
	/** Persist a freshly-prepared request (state must be PREPARING or READY). */
	write(
		input: unknown,
		opts: { projectId: string; oldSessionId: string },
	): { ref: string; id: string; request: RolloverRequest };

	/**
	 * Append-only state transition. Validates the existing record,
	 * checks the transition is allowed, persists the new state, and
	 * returns the new record. Throws on disallowed transitions.
	 */
	transition(
		opts: {
			projectId: string;
			ref: string;
			to: RolloverState;
			now?: string;
			newSessionId?: string | null;
			failureCode?: RolloverFailureCode | null;
			failureDetail?: string | null;
		},
	): RolloverRequest;

	read(ref: string, projectId: string): RolloverRequest;
	readById(projectId: string, id: string): RolloverRequest;
	list(projectId: string, filters?: RolloverListFilters): RolloverSummary[];
	latest(projectId: string): RolloverRequest | null;
	refFor(id: string): string;
}

export interface RolloverListFilters {
	reason?: RolloverRequest["reason"];
	state?: RolloverState;
	since?: string;
	until?: string;
	oldSessionId?: string;
}

export interface RolloverSummary {
	id: string;
	ref: string;
	reason: RolloverRequest["reason"];
	state: RolloverState;
	created_at: string;
	updated_at: string;
	old_session_id: string;
	new_session_id: string | null;
	checkpoint_ref: string;
	handoff_ref: string;
}

export class RolloverIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RolloverIntegrityError";
	}
}

export class RolloverTransitionError extends Error {
	constructor(
		message: string,
		readonly from: RolloverState,
		readonly to: RolloverState,
	) {
		super(message);
		this.name = "RolloverTransitionError";
	}
}

export class RolloverIdentityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RolloverIdentityError";
	}
}

export function createRolloverStore(layout: StoreLayout): RolloverStore {
	return new FsRolloverStore(layout);
}

class FsRolloverStore implements RolloverStore {
	constructor(private readonly layout: StoreLayout) {}

	write(
		input: unknown,
		opts: { projectId: string; oldSessionId: string },
	): { ref: string; id: string; request: RolloverRequest } {
		const validated = validateRolloverRequest(input);

		if (validated.project_id !== opts.projectId) {
			throw new RolloverIdentityError(
				`rollover project_id ${validated.project_id} does not match supplied ${opts.projectId}`,
			);
		}
		if (validated.old_session_id !== opts.oldSessionId) {
			throw new RolloverIdentityError(
				`rollover old_session_id ${validated.old_session_id} does not match supplied ${opts.oldSessionId}`,
			);
		}
		if (validated.state !== "PREPARING" && validated.state !== "READY") {
			throw new Error(
				`rollover write: initial state must be PREPARING or READY (got ${validated.state})`,
			);
		}
		if (validated.new_session_id !== null) {
			throw new Error(
				"rollover write: new_session_id must be null at PREPARING/READY",
			);
		}
		if (validated.failure_code !== null) {
			throw new Error(
				"rollover write: failure_code must be null at PREPARING/READY",
			);
		}

		// The store always assigns a fresh id on the initial
		// write. The caller's `rollover_request_id` field is
		// ignored (the orchestrator passes a placeholder for
		// structural validation). For tests that want a stable
		// id, the test may supply a non-placeholder id matching
		// the opaque-id alphabet.
		const id =
			validated.rollover_request_id && validated.rollover_request_id !== "_pending_"
				? validated.rollover_request_id
				: generateId();
		const stamped: RolloverRequest = { ...validated, rollover_request_id: id };

		const envelope = seal(stamped, ROLLOVER_SCHEMA_VERSION);
		const body = canonicalJsonStringify(envelope);

		const finalPath = rolloverRequestPath(this.layout, opts.projectId, id);
		ensureDir(join(this.layout.projectsRoot, opts.projectId, "rollovers", id));
		atomicWriteFile(finalPath, body);

		const ref = makeRef(ROLLOVER_REF_KIND, id);
		appendIndexEntry(this.layout, opts.projectId, "rollovers", {
			ref,
			id,
			reason: stamped.reason,
			state: stamped.state,
			created_at: stamped.created_at,
			updated_at: stamped.updated_at,
			old_session_id: stamped.old_session_id,
			new_session_id: stamped.new_session_id,
			checkpoint_ref: stamped.checkpoint_ref,
			handoff_ref: stamped.handoff_ref,
		});

		return { ref, id, request: stamped };
	}

	transition(opts: {
		projectId: string;
		ref: string;
		to: RolloverState;
		now?: string;
		newSessionId?: string | null;
		failureCode?: RolloverFailureCode | null;
		failureDetail?: string | null;
	}): RolloverRequest {
		const current = this.read(opts.ref, opts.projectId);
		if (!isAllowedRolloverTransition(current.state, opts.to)) {
			throw new RolloverTransitionError(
				`rollover transition ${current.state} -> ${opts.to} is not allowed`,
				current.state,
				opts.to,
			);
		}
		let newSessionId = current.new_session_id;
		let failureCode: RolloverFailureCode | null = current.failure_code;
		let failureDetail: string | null = current.failure_detail;
		if (opts.to === "COMPLETE") {
			if (opts.newSessionId == null || opts.newSessionId.length === 0) {
				throw new Error(
					"rollover transition to COMPLETE requires newSessionId",
				);
			}
			newSessionId = opts.newSessionId;
			failureCode = null;
			failureDetail = null;
		} else if (opts.to === "FAILED") {
			failureCode = opts.failureCode ?? "unknown";
			failureDetail = opts.failureDetail ?? null;
		} else if (opts.to === "EXECUTING") {
			// Entering EXECUTING clears any prior transient failure
			// markers only if the source was FAILED (retry path).
			if (current.state === "FAILED") {
				failureCode = null;
				failureDetail = null;
			}
		}

		const updated: RolloverRequest = {
			...current,
			state: opts.to,
			updated_at: opts.now ?? new Date().toISOString(),
			new_session_id: newSessionId,
			failure_code: failureCode,
			failure_detail: failureDetail,
		};
		const validated = validateRolloverRequest(updated);

		const envelope = seal(validated, ROLLOVER_SCHEMA_VERSION);
		const body = canonicalJsonStringify(envelope);
		const finalPath = rolloverRequestPath(
			this.layout,
			opts.projectId,
			validated.rollover_request_id,
		);
		atomicWriteFile(finalPath, body);

		// The per-id line in the index is updated by appending a
		// fresh line. The list() reader dedupes by id and keeps the
		// latest entry per id, so list output reflects the current
		// state. rebuildRolloverIndex re-derives a clean per-id
		// view from the authoritative record.
		appendIndexEntry(this.layout, opts.projectId, "rollovers", {
			ref: opts.ref,
			id: validated.rollover_request_id,
			reason: validated.reason,
			state: validated.state,
			created_at: validated.created_at,
			updated_at: validated.updated_at,
			old_session_id: validated.old_session_id,
			new_session_id: validated.new_session_id,
			checkpoint_ref: validated.checkpoint_ref,
			handoff_ref: validated.handoff_ref,
		});

		return validated;
	}

	read(ref: string, projectId: string): RolloverRequest {
		const parsed: ParsedRef = requireRef(ref);
		if (parsed.kind !== ROLLOVER_REF_KIND) {
			throw new Error(`ref kind is ${parsed.kind}, expected ${ROLLOVER_REF_KIND}`);
		}
		return this.readById(projectId, parsed.id);
	}

	readById(projectId: string, id: string): RolloverRequest {
		if (!projectId) {
			throw new Error("readById requires projectId");
		}
		const path = rolloverRequestPath(this.layout, projectId, id);
		if (!existsSync(path)) {
			throw new Error(`rollover record not found: ${path}`);
		}
		return loadAndVerifyRollover(path, projectId, id);
	}

	refFor(id: string): string {
		return makeRef(ROLLOVER_REF_KIND, id);
	}

	list(projectId: string, filters: RolloverListFilters = {}): RolloverSummary[] {
		const entries = readIndex<RolloverIndexEntry>(this.layout, projectId, "rollovers");
		// Keep only the latest per id (last appended = latest state).
		const latestById = new Map<string, RolloverIndexEntry>();
		for (const e of entries) latestById.set(e.id, e);

		const out: RolloverSummary[] = [];
		for (const e of latestById.values()) {
			let rec: RolloverRequest | null = null;
			try {
				rec = this.readById(projectId, e.id);
			} catch {
				continue;
			}
			if (filters.reason && rec.reason !== filters.reason) continue;
			if (filters.state && rec.state !== filters.state) continue;
			if (filters.since && rec.created_at < filters.since) continue;
			if (filters.until && rec.created_at > filters.until) continue;
			if (filters.oldSessionId && rec.old_session_id !== filters.oldSessionId) continue;
			out.push({
				id: rec.rollover_request_id,
				ref: this.refFor(rec.rollover_request_id),
				reason: rec.reason,
				state: rec.state,
				created_at: rec.created_at,
				updated_at: rec.updated_at,
				old_session_id: rec.old_session_id,
				new_session_id: rec.new_session_id,
				checkpoint_ref: rec.checkpoint_ref,
				handoff_ref: rec.handoff_ref,
			});
		}
		out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
		return out;
	}

	latest(projectId: string): RolloverRequest | null {
		const summaries = this.list(projectId);
		if (summaries.length === 0) return null;
		return this.readById(projectId, summaries[0].id);
	}
}

interface RolloverIndexEntry extends IndexEntry {
	reason: RolloverRequest["reason"];
	state: RolloverState;
	created_at: string;
	updated_at: string;
	old_session_id: string;
	new_session_id: string | null;
	checkpoint_ref: string;
	handoff_ref: string;
}

function loadAndVerifyRollover(
	path: string,
	projectId: string,
	id: string,
): RolloverRequest {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (err) {
		throw new RolloverIntegrityError(
			`cannot read rollover ${id}: ${(err as Error).message}`,
		);
	}
	let envelope: IntegrityEnvelope<unknown>;
	try {
		envelope = JSON.parse(raw) as IntegrityEnvelope<unknown>;
	} catch (err) {
		throw new RolloverIntegrityError(
			`rollover ${id} is not valid JSON: ${(err as Error).message}`,
		);
	}
	if (envelope.schema_version !== ROLLOVER_SCHEMA_VERSION) {
		throw new RolloverIntegrityError(
			`rollover ${id} has unsupported schema_version ${envelope.schema_version} (expected ${ROLLOVER_SCHEMA_VERSION})`,
		);
	}
	const content = verify(envelope) as RolloverRequest;
	if (content.rollover_request_id !== id) {
		throw new RolloverIntegrityError(
			`rollover id mismatch: file ${id} but content says ${content.rollover_request_id}`,
		);
	}
	if (content.project_id !== projectId) {
		throw new RolloverIntegrityError(
			`rollover project_id mismatch: ${content.project_id} vs ${projectId}`,
		);
	}
	return content;
}

/**
 * Re-scan authoritative rollover directories and rebuild the
 * rollover index. Used by `rebuildAll` and by the recovery path.
 *
 * This is a synchronous walk; the durable directory layout is
 * `rollovers/<id>/request.json`.
 */
export function rebuildRolloverIndex(layout: StoreLayout, projectId: string): void {
	const dir = join(layout.projectsRoot, projectId, "rollovers");
	if (!existsSync(dir)) {
		clearIndex(layout, projectId, "rollovers");
		return;
	}
	const ids: string[] = [];
	for (const entry of readdirSync(dir)) {
		const p = rolloverRequestPath(layout, projectId, entry);
		if (existsSync(p)) ids.push(entry);
	}
	const entries: RolloverIndexEntry[] = [];
	for (const id of ids) {
		try {
			const rec = loadAndVerifyRollover(
				rolloverRequestPath(layout, projectId, id),
				projectId,
				id,
			);
			entries.push({
				ref: makeRef(ROLLOVER_REF_KIND, id),
				id,
				reason: rec.reason,
				state: rec.state,
				created_at: rec.created_at,
				updated_at: rec.updated_at,
				old_session_id: rec.old_session_id,
				new_session_id: rec.new_session_id,
				checkpoint_ref: rec.checkpoint_ref,
				handoff_ref: rec.handoff_ref,
			});
		} catch {
			// Skip unreadable records; the index is rebuildable.
		}
	}
	// rebuildIndex sorts by ref+id, so a stable order is guaranteed.
	rebuildIndex(layout, projectId, "rollovers", entries);
}
