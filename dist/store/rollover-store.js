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
import { makeRef, requireRef, } from "../core/index.js";
import { isAllowedRolloverTransition, ROLLOVER_SCHEMA_VERSION, validateRolloverRequest, } from "../core/rollover.js";
import { atomicWriteFile, ensureDir } from "./atomic.js";
import { generateId } from "./ids.js";
import { canonicalJsonStringify, seal, verify, } from "./integrity.js";
import { appendIndexEntry, clearIndex, readIndex, rebuildIndex, } from "./index-table.js";
import { rolloverRequestPath, } from "./paths.js";
export const ROLLOVER_REF_KIND = "rollover";
export class RolloverIntegrityError extends Error {
    constructor(message) {
        super(message);
        this.name = "RolloverIntegrityError";
    }
}
export class RolloverTransitionError extends Error {
    from;
    to;
    constructor(message, from, to) {
        super(message);
        this.from = from;
        this.to = to;
        this.name = "RolloverTransitionError";
    }
}
export class RolloverIdentityError extends Error {
    constructor(message) {
        super(message);
        this.name = "RolloverIdentityError";
    }
}
export function createRolloverStore(layout) {
    return new FsRolloverStore(layout);
}
class FsRolloverStore {
    layout;
    constructor(layout) {
        this.layout = layout;
    }
    write(input, opts) {
        const validated = validateRolloverRequest(input);
        if (validated.project_id !== opts.projectId) {
            throw new RolloverIdentityError(`rollover project_id ${validated.project_id} does not match supplied ${opts.projectId}`);
        }
        if (validated.old_session_id !== opts.oldSessionId) {
            throw new RolloverIdentityError(`rollover old_session_id ${validated.old_session_id} does not match supplied ${opts.oldSessionId}`);
        }
        if (validated.state !== "PREPARING" && validated.state !== "READY") {
            throw new Error(`rollover write: initial state must be PREPARING or READY (got ${validated.state})`);
        }
        if (validated.new_session_id !== null) {
            throw new Error("rollover write: new_session_id must be null at PREPARING/READY");
        }
        if (validated.failure_code !== null) {
            throw new Error("rollover write: failure_code must be null at PREPARING/READY");
        }
        // The store always assigns a fresh id on the initial
        // write. The caller's `rollover_request_id` field is
        // ignored (the orchestrator passes a placeholder for
        // structural validation). For tests that want a stable
        // id, the test may supply a non-placeholder id matching
        // the opaque-id alphabet.
        const id = validated.rollover_request_id && validated.rollover_request_id !== "_pending_"
            ? validated.rollover_request_id
            : generateId();
        const stamped = { ...validated, rollover_request_id: id };
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
    transition(opts) {
        const current = this.read(opts.ref, opts.projectId);
        if (!isAllowedRolloverTransition(current.state, opts.to)) {
            throw new RolloverTransitionError(`rollover transition ${current.state} -> ${opts.to} is not allowed`, current.state, opts.to);
        }
        let newSessionId = current.new_session_id;
        let failureCode = current.failure_code;
        let failureDetail = current.failure_detail;
        if (opts.to === "COMPLETE") {
            if (opts.newSessionId == null || opts.newSessionId.length === 0) {
                throw new Error("rollover transition to COMPLETE requires newSessionId");
            }
            newSessionId = opts.newSessionId;
            failureCode = null;
            failureDetail = null;
        }
        else if (opts.to === "FAILED") {
            failureCode = opts.failureCode ?? "unknown";
            failureDetail = opts.failureDetail ?? null;
        }
        else if (opts.to === "EXECUTING") {
            // Entering EXECUTING clears any prior transient failure
            // markers only if the source was FAILED (retry path).
            if (current.state === "FAILED") {
                failureCode = null;
                failureDetail = null;
            }
        }
        const updated = {
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
        const finalPath = rolloverRequestPath(this.layout, opts.projectId, validated.rollover_request_id);
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
    read(ref, projectId) {
        const parsed = requireRef(ref);
        if (parsed.kind !== ROLLOVER_REF_KIND) {
            throw new Error(`ref kind is ${parsed.kind}, expected ${ROLLOVER_REF_KIND}`);
        }
        return this.readById(projectId, parsed.id);
    }
    readById(projectId, id) {
        if (!projectId) {
            throw new Error("readById requires projectId");
        }
        const path = rolloverRequestPath(this.layout, projectId, id);
        if (!existsSync(path)) {
            throw new Error(`rollover record not found: ${path}`);
        }
        return loadAndVerifyRollover(path, projectId, id);
    }
    refFor(id) {
        return makeRef(ROLLOVER_REF_KIND, id);
    }
    list(projectId, filters = {}) {
        const entries = readIndex(this.layout, projectId, "rollovers");
        // Keep only the latest per id (last appended = latest state).
        const latestById = new Map();
        for (const e of entries)
            latestById.set(e.id, e);
        const out = [];
        for (const e of latestById.values()) {
            let rec = null;
            try {
                rec = this.readById(projectId, e.id);
            }
            catch {
                continue;
            }
            if (filters.reason && rec.reason !== filters.reason)
                continue;
            if (filters.state && rec.state !== filters.state)
                continue;
            if (filters.since && rec.created_at < filters.since)
                continue;
            if (filters.until && rec.created_at > filters.until)
                continue;
            if (filters.oldSessionId && rec.old_session_id !== filters.oldSessionId)
                continue;
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
    latest(projectId) {
        const summaries = this.list(projectId);
        if (summaries.length === 0)
            return null;
        return this.readById(projectId, summaries[0].id);
    }
}
function loadAndVerifyRollover(path, projectId, id) {
    let raw;
    try {
        raw = readFileSync(path, "utf8");
    }
    catch (err) {
        throw new RolloverIntegrityError(`cannot read rollover ${id}: ${err.message}`);
    }
    let envelope;
    try {
        envelope = JSON.parse(raw);
    }
    catch (err) {
        throw new RolloverIntegrityError(`rollover ${id} is not valid JSON: ${err.message}`);
    }
    if (envelope.schema_version !== ROLLOVER_SCHEMA_VERSION) {
        throw new RolloverIntegrityError(`rollover ${id} has unsupported schema_version ${envelope.schema_version} (expected ${ROLLOVER_SCHEMA_VERSION})`);
    }
    const content = verify(envelope);
    if (content.rollover_request_id !== id) {
        throw new RolloverIntegrityError(`rollover id mismatch: file ${id} but content says ${content.rollover_request_id}`);
    }
    if (content.project_id !== projectId) {
        throw new RolloverIntegrityError(`rollover project_id mismatch: ${content.project_id} vs ${projectId}`);
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
export function rebuildRolloverIndex(layout, projectId) {
    const dir = join(layout.projectsRoot, projectId, "rollovers");
    if (!existsSync(dir)) {
        clearIndex(layout, projectId, "rollovers");
        return;
    }
    const ids = [];
    for (const entry of readdirSync(dir)) {
        const p = rolloverRequestPath(layout, projectId, entry);
        if (existsSync(p))
            ids.push(entry);
    }
    const entries = [];
    for (const id of ids) {
        try {
            const rec = loadAndVerifyRollover(rolloverRequestPath(layout, projectId, id), projectId, id);
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
        }
        catch {
            // Skip unreadable records; the index is rebuildable.
        }
    }
    // rebuildIndex sorts by ref+id, so a stable order is guaranteed.
    rebuildIndex(layout, projectId, "rollovers", entries);
}
//# sourceMappingURL=rollover-store.js.map