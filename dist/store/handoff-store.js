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
import { makeRef, parseRef, projectHandoffFromCheckpoint, validateHandoff, } from "../core/index.js";
import { atomicWriteFile, ensureDir } from "./atomic.js";
import { generateId } from "./ids.js";
import { canonicalJsonStringify, seal, verify, } from "./integrity.js";
import { appendIndexEntry, readIndex } from "./index-table.js";
import { handoffPath } from "./paths.js";
export const HANDOFF_REF_KIND = "handoff";
export const HANDOFF_SCHEMA_VERSION = "1.0.0";
export class HandoffIntegrityError extends Error {
    constructor(message) {
        super(message);
        this.name = "HandoffIntegrityError";
    }
}
export function createHandoffStore(layout) {
    return new FsHandoffStore(layout);
}
class FsHandoffStore {
    layout;
    constructor(layout) {
        this.layout = layout;
    }
    fromCheckpoint(checkpoint, opts) {
        const handoff = projectHandoffFromCheckpoint(checkpoint);
        return this.persist(handoff, opts.projectId);
    }
    write(input, opts) {
        const validated = validateHandoff(input);
        return this.persist(validated, opts.projectId);
    }
    persist(handoff, projectId) {
        const id = generateId();
        const stamped = { ...handoff };
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
    read(ref, projectId) {
        const parsed = parseHandoffRef(ref);
        if (parsed.id === "" || parsed.id == null) {
            throw new Error(`invalid handoff ref: ${ref}`);
        }
        return this.readById(projectId, parsed.id);
    }
    readById(projectId, id) {
        const path = handoffPath(this.layout, projectId, id);
        if (!existsSync(path)) {
            throw new Error(`handoff record not found: ${path}`);
        }
        return loadAndVerifyHandoff(path, projectId, id);
    }
    refFor(id) {
        return makeRef(HANDOFF_REF_KIND, id);
    }
    list(projectId, filters = {}) {
        const entries = readIndex(this.layout, projectId, "handoffs");
        const filtered = entries.filter((e) => {
            if (filters.workPackage && e.work_package !== filters.workPackage)
                return false;
            if (filters.status && e.status !== filters.status)
                return false;
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
    latest(projectId) {
        const summaries = this.list(projectId);
        if (summaries.length === 0)
            return null;
        return this.readById(projectId, summaries[0].id);
    }
}
function parseHandoffRef(ref) {
    const parsed = parseRef(ref);
    if (parsed === null || parsed.kind !== HANDOFF_REF_KIND) {
        throw new Error(`ref is not a valid handoff ref: ${ref}`);
    }
    // S01 refs are opaque: id is the last path segment. We do not
    // embed project_hint in the URI; the caller passes projectId.
    return { projectHint: "", id: parsed.id };
}
function loadAndVerifyHandoff(path, _projectId, id) {
    let raw;
    try {
        raw = readFileSync(path, "utf8");
    }
    catch (err) {
        throw new HandoffIntegrityError(`cannot read handoff ${id}: ${err.message}`);
    }
    let envelope;
    try {
        envelope = JSON.parse(raw);
    }
    catch (err) {
        throw new HandoffIntegrityError(`handoff ${id} is not valid JSON: ${err.message}`);
    }
    if (envelope.schema_version !== HANDOFF_SCHEMA_VERSION) {
        throw new HandoffIntegrityError(`handoff ${id} has unsupported schema_version ${envelope.schema_version} (expected ${HANDOFF_SCHEMA_VERSION})`);
    }
    const content = verify(envelope);
    if (content.work_package == null) {
        throw new HandoffIntegrityError(`handoff ${id} missing work_package`);
    }
    return content;
}
//# sourceMappingURL=handoff-store.js.map