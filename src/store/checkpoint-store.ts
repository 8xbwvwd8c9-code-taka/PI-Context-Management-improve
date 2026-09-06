/**
 * Checkpoint store.
 *
 * Responsibilities (R02 §6, §8, §10):
 *   - validate before persistence
 *   - persist schema_version
 *   - atomic authoritative write
 *   - return opaque checkpoint ref ONLY after success
 *   - deterministic latest selection
 *   - safe rejection of malformed / corrupted / wrong-schema records
 *   - no LLM
 */

import {
	existsSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";

import {
	CHECKPOINT_SCHEMA_VERSION,
	makeRef,
	validateCheckpoint,
	type Checkpoint,
} from "../core/index.js";

import { atomicWriteFile, ensureDir } from "./atomic.js";
import { generateId } from "./ids.js";
import {
	canonicalJsonStringify,
	seal,
	verify,
	type IntegrityEnvelope,
} from "./integrity.js";
import { checkpointPath, type StoreLayout } from "./paths.js";
import type { ProjectMetadata, SessionRecord } from "./records.js";
import { appendIndexEntry, readIndex, type IndexEntry } from "./index-table.js";

export interface CheckpointStore {
	write(input: unknown, opts: { projectId: string; sessionId?: string }): {
		ref: string;
		id: string;
		checkpoint: Checkpoint;
	};
	read(ref: string, projectId: string): Checkpoint;
	readById(projectId: string, id: string): Checkpoint;
	list(projectId: string, filters?: CheckpointListFilters): CheckpointSummary[];
	latest(projectId: string): Checkpoint | null;
	refFor(projectId: string, id: string): string;
}

export interface CheckpointListFilters {
	workPackage?: string;
	status?: Checkpoint["status"];
	since?: string;
	until?: string;
}

export interface CheckpointSummary {
	id: string;
	ref: string;
	work_package: string;
	status: Checkpoint["status"];
	created_at: string;
	session_id: string;
}

export class CheckpointIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CheckpointIntegrityError";
	}
}

export function createCheckpointStore(layout: StoreLayout): CheckpointStore {
	return new FsCheckpointStore(layout);
}

class FsCheckpointStore implements CheckpointStore {
	constructor(private readonly layout: StoreLayout) {}

	write(input: unknown, opts: { projectId: string; sessionId?: string }): {
		ref: string;
		id: string;
		checkpoint: Checkpoint;
	} {
		// 1) validate FIRST. We refuse to write anything we cannot
		//    re-parse.
		const validated = validateCheckpoint(input);

		// 2) assign id + verify session_id matches if provided.
		const id = generateId();
		const sessionId = opts.sessionId ?? validated.session_id;
		if (opts.sessionId && opts.sessionId !== validated.session_id) {
			throw new Error(
				`checkpoint session_id ${validated.session_id} does not match supplied ${opts.sessionId}`,
			);
		}
		const projectId = opts.projectId;
		if (validated.project_id !== projectId) {
			throw new Error(
				`checkpoint project_id ${validated.project_id} does not match supplied ${projectId}`,
			);
		}

		const stamped: Checkpoint = { ...validated, checkpoint_id: id, session_id: sessionId };

		// 3) seal with integrity envelope.
		const envelope = seal(stamped, CHECKPOINT_SCHEMA_VERSION);
		const body = canonicalJsonStringify(envelope);

		// 4) atomic write. If this throws, NO ref is issued.
		const finalPath = checkpointPath(this.layout, projectId, id);
		ensureDir(join(this.layout.projectsRoot, projectId, "checkpoints"));
		atomicWriteFile(finalPath, body);

		// 5) only now do we issue the ref and append to the index.
		const ref = makeRef("checkpoint", id);
		appendIndexEntry(this.layout, projectId, "checkpoints", {
			ref,
			id,
			work_package: stamped.work_package,
			status: stamped.status,
			created_at: stamped.created_at,
			session_id: stamped.session_id,
		});

		return { ref, id, checkpoint: stamped };
	}

	read(ref: string, projectId: string): Checkpoint {
		const parsed = readCheckpointRef(ref);
		if (parsed.id === "" || parsed.id == null) {
			throw new Error(`invalid checkpoint ref: ${ref}`);
		}
		return this.readById(projectId, parsed.id);
	}

	readById(projectId: string, id: string): Checkpoint {
		const path = checkpointPath(this.layout, projectId, id);
		if (!existsSync(path)) {
			throw new Error(`checkpoint record not found: ${path}`);
		}
		return loadAndVerifyCheckpoint(path, projectId, id);
	}

	refFor(_projectId: string, id: string): string {
		return makeRef("checkpoint", id);
	}

	list(projectId: string, filters: CheckpointListFilters = {}): CheckpointSummary[] {
		const entries = readIndex<CheckpointIndexEntry>(this.layout, projectId, "checkpoints");
		const filtered = entries.filter((e) => {
			if (filters.workPackage && e.work_package !== filters.workPackage) return false;
			if (filters.status && e.status !== filters.status) return false;
			if (filters.since && e.created_at < filters.since) return false;
			if (filters.until && e.created_at > filters.until) return false;
			return true;
		});
		// Deterministic order: created_at desc, then id desc.
		filtered.sort((a, b) => {
			if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
			return a.id < b.id ? 1 : -1;
		});
		return filtered.map((e) => ({
			id: e.id,
			ref: e.ref,
			work_package: e.work_package,
			status: e.status,
			created_at: e.created_at,
			session_id: e.session_id,
		}));
	}

	latest(projectId: string): Checkpoint | null {
		const summaries = this.list(projectId);
		if (summaries.length === 0) return null;
		const top = summaries[0];
		return this.readById(projectId, top.id);
	}
}

/* -------------------------------------------------------------------- *
 * Internal helpers                                                      *
 * -------------------------------------------------------------------- */

interface CheckpointIndexEntry extends IndexEntry {
	work_package: string;
	status: Checkpoint["status"];
	created_at: string;
	session_id: string;
}

function readCheckpointRef(ref: string): { projectHint: string; id: string } {
	const trimmed = ref.replace(/^cmv3:\/\/checkpoint\//, "");
	const sep = trimmed.indexOf("/");
	if (sep < 0) {
		return { projectHint: "", id: trimmed };
	}
	return { projectHint: trimmed.slice(0, sep), id: trimmed.slice(sep + 1) };
}

function loadAndVerifyCheckpoint(
	path: string,
	projectId: string,
	id: string,
): Checkpoint {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (err) {
		throw new CheckpointIntegrityError(
			`cannot read checkpoint ${id} for project ${projectId}: ${(err as Error).message}`,
		);
	}
	let envelope: IntegrityEnvelope<unknown>;
	try {
		envelope = JSON.parse(raw) as IntegrityEnvelope<unknown>;
	} catch (err) {
		throw new CheckpointIntegrityError(
			`checkpoint ${id} is not valid JSON: ${(err as Error).message}`,
		);
	}
	if (envelope.schema_version !== CHECKPOINT_SCHEMA_VERSION) {
		throw new CheckpointIntegrityError(
			`checkpoint ${id} has unsupported schema_version ${envelope.schema_version} (expected ${CHECKPOINT_SCHEMA_VERSION})`,
		);
	}
	let content: Checkpoint;
	try {
		content = verify(envelope) as Checkpoint;
	} catch (err) {
		throw new CheckpointIntegrityError(
			`checkpoint ${id} failed integrity check: ${(err as Error).message}`,
		);
	}
	// Cross-check: id and project id must match the file location.
	if (content.checkpoint_id !== id) {
		throw new CheckpointIntegrityError(
			`checkpoint id mismatch: file ${id} but content says ${content.checkpoint_id}`,
		);
	}
	if (content.project_id !== projectId) {
		throw new CheckpointIntegrityError(
			`checkpoint project_id mismatch: ${content.project_id} vs ${projectId}`,
		);
	}
	return content;
}

/* Re-exports for the top-level store. */

export type { ProjectMetadata, SessionRecord };
