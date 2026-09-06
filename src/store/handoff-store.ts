/**
 * Minimal handoff store.
 *
 * Per R02 §7, a handoff is a strict projection of a checkpoint with
 * a smaller semantic scope. The handoff store:
 *   - refuses to mutate a persisted handoff in place
 *   - derives the content via the canonical projection from S01
 *   - validates the result before writing
 *   - returns an opaque cmv3://handoff/<id> ref on success
 *
 * S02 introduces the dedicated handoff ref family because:
 *   - handoffs are independently recoverable durable records, not
 *     a sub-record of a checkpoint
 *   - mixing the ref under the checkpoint family would lose the
 *     distinction and prevent separate retention / indexing
 *   - the S01 ref module already reserves the alphabet and we
 *     extend it with one new family, versioned via the R02
 *     change-control rule
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	makeRef,
	parseRef,
	projectHandoffFromCheckpoint,
	validateHandoff,
	type Checkpoint,
	type MinimalHandoff,
} from "../core/index.js";

import { atomicWriteFile, ensureDir } from "./atomic.js";
import { generateId } from "./ids.js";
import {
	canonicalJsonStringify,
	seal,
	verify,
	type IntegrityEnvelope,
} from "./integrity.js";
import { appendIndexEntry, readIndex, type IndexEntry } from "./index-table.js";
import { handoffPath, type StoreLayout } from "./paths.js";

export const HANDOFF_REF_KIND = "handoff" as const;
export const HANDOFF_SCHEMA_VERSION = "1.0.0" as const;

export interface HandoffStore {
	fromCheckpoint(checkpoint: Checkpoint, opts: { projectId: string }): {
		ref: string;
		id: string;
		handoff: MinimalHandoff;
	};
	write(input: unknown, opts: { projectId: string }): {
		ref: string;
		id: string;
		handoff: MinimalHandoff;
	};
	read(ref: string, projectId: string): MinimalHandoff;
	readById(projectId: string, id: string): MinimalHandoff;
	list(projectId: string, filters?: HandoffListFilters): HandoffSummary[];
	latest(projectId: string): MinimalHandoff | null;
	refFor(id: string): string;
}

export interface HandoffListFilters {
	workPackage?: string;
	status?: MinimalHandoff["status"];
}

export interface HandoffSummary {
	id: string;
	ref: string;
	work_package: string;
	status: MinimalHandoff["status"];
}

export class HandoffIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HandoffIntegrityError";
	}
}

export function createHandoffStore(layout: StoreLayout): HandoffStore {
	return new FsHandoffStore(layout);
}

class FsHandoffStore implements HandoffStore {
	constructor(private readonly layout: StoreLayout) {}

	fromCheckpoint(
		checkpoint: Checkpoint,
		opts: { projectId: string },
	): { ref: string; id: string; handoff: MinimalHandoff } {
		const handoff = projectHandoffFromCheckpoint(checkpoint);
		return this.persist(handoff, opts.projectId);
	}

	write(
		input: unknown,
		opts: { projectId: string },
	): { ref: string; id: string; handoff: MinimalHandoff } {
		const validated = validateHandoff(input);
		return this.persist(validated, opts.projectId);
	}

	private persist(
		handoff: MinimalHandoff,
		projectId: string,
	): { ref: string; id: string; handoff: MinimalHandoff } {
		const id = generateId();
		const stamped: MinimalHandoff = { ...handoff };

		const envelope = seal(stamped, HANDOFF_SCHEMA_VERSION);
		const body = canonicalJsonStringify(envelope);

		const finalPath = handoffPath(this.layout, projectId, id);
		ensureDir(join(this.layout.projectsRoot, projectId, "handoffs"));
		atomicWriteFile(finalPath, body);

		const ref = makeRef(HANDOFF_REF_KIND, id);
		appendIndexEntry(this.layout, projectId, "handoffs", {
			ref,
			id,
			work_package: stamped.work_package,
			status: stamped.status,
		});

		return { ref, id, handoff: stamped };
	}

	read(ref: string, projectId: string): MinimalHandoff {
		const parsed = parseHandoffRef(ref);
		if (parsed.id === "" || parsed.id == null) {
			throw new Error(`invalid handoff ref: ${ref}`);
		}
		return this.readById(projectId, parsed.id);
	}

	readById(projectId: string, id: string): MinimalHandoff {
		const path = handoffPath(this.layout, projectId, id);
		if (!existsSync(path)) {
			throw new Error(`handoff record not found: ${path}`);
		}
		return loadAndVerifyHandoff(path, projectId, id);
	}

	refFor(id: string): string {
		return makeRef(HANDOFF_REF_KIND, id);
	}

	list(projectId: string, filters: HandoffListFilters = {}): HandoffSummary[] {
		const entries = readIndex<HandoffIndexEntry>(this.layout, projectId, "handoffs");
		const filtered = entries.filter((e) => {
			if (filters.workPackage && e.work_package !== filters.workPackage) return false;
			if (filters.status && e.status !== filters.status) return false;
			return true;
		});
		// Deterministic order: id descending (latest is the most
		// recent id minted).
		filtered.sort((a, b) => (a.id < b.id ? 1 : -1));
		return filtered.map((e) => ({
			id: e.id,
			ref: e.ref,
			work_package: e.work_package,
			status: e.status,
		}));
	}

	latest(projectId: string): MinimalHandoff | null {
		const summaries = this.list(projectId);
		if (summaries.length === 0) return null;
		return this.readById(projectId, summaries[0].id);
	}
}

interface HandoffIndexEntry extends IndexEntry {
	work_package: string;
	status: MinimalHandoff["status"];
}

function parseHandoffRef(ref: string): { projectHint: string; id: string } {
	const parsed = parseRef(ref);
	if (parsed === null || parsed.kind !== HANDOFF_REF_KIND) {
		throw new Error(`ref is not a valid handoff ref: ${ref}`);
	}
	// S01 refs are opaque: id is the last path segment. We do not
	// embed project_hint in the URI; the caller passes projectId.
	return { projectHint: "", id: parsed.id };
}

function loadAndVerifyHandoff(
	path: string,
	_projectId: string,
	id: string,
): MinimalHandoff {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (err) {
		throw new HandoffIntegrityError(
			`cannot read handoff ${id}: ${(err as Error).message}`,
		);
	}
	let envelope: IntegrityEnvelope<unknown>;
	try {
		envelope = JSON.parse(raw) as IntegrityEnvelope<unknown>;
	} catch (err) {
		throw new HandoffIntegrityError(
			`handoff ${id} is not valid JSON: ${(err as Error).message}`,
		);
	}
	if (envelope.schema_version !== HANDOFF_SCHEMA_VERSION) {
		throw new HandoffIntegrityError(
			`handoff ${id} has unsupported schema_version ${envelope.schema_version} (expected ${HANDOFF_SCHEMA_VERSION})`,
		);
	}
	const content = verify(envelope) as MinimalHandoff;
	if (content.work_package == null) {
		throw new HandoffIntegrityError(`handoff ${id} missing work_package`);
	}
	return content;
}
