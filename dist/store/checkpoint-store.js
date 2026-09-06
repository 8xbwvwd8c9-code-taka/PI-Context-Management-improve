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
import { existsSync, readFileSync, } from "node:fs";
import { join } from "node:path";
import { CHECKPOINT_SCHEMA_VERSION, makeRef, validateCheckpoint, } from "../core/index.js";
import { atomicWriteFile, ensureDir } from "./atomic.js";
import { generateId } from "./ids.js";
import { canonicalJsonStringify, seal, verify, } from "./integrity.js";
import { checkpointPath } from "./paths.js";
import { appendIndexEntry, readIndex } from "./index-table.js";
export class CheckpointIntegrityError extends Error {
    constructor(message) {
        super(message);
        this.name = "CheckpointIntegrityError";
    }
}
export function createCheckpointStore(layout) {
    return new FsCheckpointStore(layout);
}
class FsCheckpointStore {
    layout;
    constructor(layout) {
        this.layout = layout;
    }
    write(input, opts) {
        // 1) validate FIRST. We refuse to write anything we cannot
        //    re-parse.
        const validated = validateCheckpoint(input);
        // 2) assign id + verify session_id matches if provided.
        const id = generateId();
        const sessionId = opts.sessionId ?? validated.session_id;
        if (opts.sessionId && opts.sessionId !== validated.session_id) {
            throw new Error(`checkpoint session_id ${validated.session_id} does not match supplied ${opts.sessionId}`);
        }
        const projectId = opts.projectId;
        if (validated.project_id !== projectId) {
            throw new Error(`checkpoint project_id ${validated.project_id} does not match supplied ${projectId}`);
        }
        const stamped = { ...validated, checkpoint_id: id, session_id: sessionId };
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
    read(ref, projectId) {
        const parsed = readCheckpointRef(ref);
        if (parsed.id === "" || parsed.id == null) {
            throw new Error(`invalid checkpoint ref: ${ref}`);
        }
        return this.readById(projectId, parsed.id);
    }
    readById(projectId, id) {
        const path = checkpointPath(this.layout, projectId, id);
        if (!existsSync(path)) {
            throw new Error(`checkpoint record not found: ${path}`);
        }
        return loadAndVerifyCheckpoint(path, projectId, id);
    }
    refFor(_projectId, id) {
        return makeRef("checkpoint", id);
    }
    list(projectId, filters = {}) {
        const entries = readIndex(this.layout, projectId, "checkpoints");
        const filtered = entries.filter((e) => {
            if (filters.workPackage && e.work_package !== filters.workPackage)
                return false;
            if (filters.status && e.status !== filters.status)
                return false;
            if (filters.since && e.created_at < filters.since)
                return false;
            if (filters.until && e.created_at > filters.until)
                return false;
            return true;
        });
        // Deterministic order: created_at desc, then id desc.
        filtered.sort((a, b) => {
            if (a.created_at !== b.created_at)
                return a.created_at < b.created_at ? 1 : -1;
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
    latest(projectId) {
        const summaries = this.list(projectId);
        if (summaries.length === 0)
            return null;
        const top = summaries[0];
        return this.readById(projectId, top.id);
    }
}
function readCheckpointRef(ref) {
    const trimmed = ref.replace(/^cmv3:\/\/checkpoint\//, "");
    const sep = trimmed.indexOf("/");
    if (sep < 0) {
        return { projectHint: "", id: trimmed };
    }
    return { projectHint: trimmed.slice(0, sep), id: trimmed.slice(sep + 1) };
}
function loadAndVerifyCheckpoint(path, projectId, id) {
    let raw;
    try {
        raw = readFileSync(path, "utf8");
    }
    catch (err) {
        throw new CheckpointIntegrityError(`cannot read checkpoint ${id} for project ${projectId}: ${err.message}`);
    }
    let envelope;
    try {
        envelope = JSON.parse(raw);
    }
    catch (err) {
        throw new CheckpointIntegrityError(`checkpoint ${id} is not valid JSON: ${err.message}`);
    }
    if (envelope.schema_version !== CHECKPOINT_SCHEMA_VERSION) {
        throw new CheckpointIntegrityError(`checkpoint ${id} has unsupported schema_version ${envelope.schema_version} (expected ${CHECKPOINT_SCHEMA_VERSION})`);
    }
    let content;
    try {
        content = verify(envelope);
    }
    catch (err) {
        throw new CheckpointIntegrityError(`checkpoint ${id} failed integrity check: ${err.message}`);
    }
    // Cross-check: id and project id must match the file location.
    if (content.checkpoint_id !== id) {
        throw new CheckpointIntegrityError(`checkpoint id mismatch: file ${id} but content says ${content.checkpoint_id}`);
    }
    if (content.project_id !== projectId) {
        throw new CheckpointIntegrityError(`checkpoint project_id mismatch: ${content.project_id} vs ${projectId}`);
    }
    return content;
}
//# sourceMappingURL=checkpoint-store.js.map