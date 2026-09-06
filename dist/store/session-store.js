/**
 * Session record store.
 *
 * Per S02 spec:
 *   - minimal session record with enough information to establish
 *     continuity
 *   - opaque session id
 *   - no coupling to one Pi session implementation
 *   - S02 does not create the next Pi session; S04 may fill
 *     `next_session_ref`
 *
 * The session record is small and self-contained. The store does
 * not perform any rollover; it merely persists the linkage that
 * later WPs and the recovery layer consume.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeRef, parseRef, requireRef, } from "../core/index.js";
import { atomicWriteFile, ensureDir } from "./atomic.js";
import { generateId } from "./ids.js";
import { canonicalJsonStringify, seal, verify, } from "./integrity.js";
import { appendIndexEntry, readIndex } from "./index-table.js";
import { sessionPath } from "./paths.js";
export const SESSION_REF_KIND = "session";
export class SessionIntegrityError extends Error {
    constructor(message) {
        super(message);
        this.name = "SessionIntegrityError";
    }
}
export function createSessionStore(layout) {
    return new FsSessionStore(layout);
}
class FsSessionStore {
    layout;
    constructor(layout) {
        this.layout = layout;
    }
    write(input, opts) {
        const validated = validateSessionRecord(input);
        if (validated.project_id !== opts.projectId) {
            throw new Error(`session project_id ${validated.project_id} does not match supplied ${opts.projectId}`);
        }
        const id = validated.session_id || generateId();
        const stamped = { ...validated, session_id: id };
        const envelope = seal(stamped, stamped.schema_version);
        const body = canonicalJsonStringify(envelope);
        const finalPath = sessionPath(this.layout, opts.projectId, id);
        ensureDir(join(this.layout.projectsRoot, opts.projectId, "sessions"));
        atomicWriteFile(finalPath, body);
        const ref = makeRef(SESSION_REF_KIND, id);
        appendIndexEntry(this.layout, opts.projectId, "sessions", {
            ref,
            id,
        });
        return { ref, id, record: stamped };
    }
    read(ref, projectId) {
        const parsed = requireRef(ref);
        if (parsed.kind !== SESSION_REF_KIND) {
            throw new Error(`ref kind is ${parsed.kind}, expected ${SESSION_REF_KIND}`);
        }
        return this.readById(projectId, parsed.id);
    }
    readById(projectId, id) {
        // We require the caller to provide projectId; for ref-only
        // resolution across a known set of projects, the caller
        // must supply a hint (or iterate). The S02 contract keeps
        // refs project-anchored.
        if (!projectId) {
            throw new Error("readById requires projectId");
        }
        const path = sessionPath(this.layout, projectId, id);
        if (!existsSync(path)) {
            throw new Error(`session record not found: ${path}`);
        }
        return loadAndVerifySession(path, projectId, id);
    }
    list(projectId) {
        const entries = readIndex(this.layout, projectId, "sessions");
        const out = [];
        for (const e of entries) {
            try {
                const rec = this.readById(projectId, e.id);
                out.push({
                    id: e.id,
                    ref: e.ref,
                    status: rec.status,
                    started_at: rec.started_at,
                    ended_at: rec.ended_at,
                });
            }
            catch {
                // Skip unreadable records; the index is rebuildable.
            }
        }
        // Deterministic order: started_at ascending.
        out.sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
        return out;
    }
}
function validateSessionRecord(input) {
    if (typeof input !== "object" || input === null) {
        throw new Error("session record must be an object");
    }
    const r = input;
    if (typeof r.schema_version !== "string")
        throw new Error("session: missing schema_version");
    if (r.schema_version !== "1.0.0") {
        throw new Error(`session: unsupported schema_version ${r.schema_version}`);
    }
    if (typeof r.project_id !== "string" || r.project_id.length === 0) {
        throw new Error("session: missing project_id");
    }
    if (typeof r.started_at !== "string" || r.started_at.length === 0) {
        throw new Error("session: missing started_at");
    }
    if (typeof r.status !== "string") {
        throw new Error("session: missing status");
    }
    if (!["OPEN", "CLOSED", "ORPHANED"].includes(r.status)) {
        throw new Error(`session: invalid status ${r.status}`);
    }
    for (const k of ["checkpoint_refs", "handoff_refs"]) {
        const v = r[k];
        if (v == null) {
            r[k] = [];
        }
        else if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
            throw new Error(`session: ${k} must be a string[]`);
        }
    }
    for (const k of ["previous_session_ref", "next_session_ref"]) {
        const v = r[k];
        if (v == null)
            continue;
        if (typeof v !== "string") {
            throw new Error(`session: ${k} must be a string or null`);
        }
        // Reuse the S01 ref module to validate format.
        const parsed = parseRef(v);
        if (parsed === null) {
            throw new Error(`session: ${k} is not a valid cmv3 ref: ${v}`);
        }
    }
    if (r.ended_at != null && typeof r.ended_at !== "string") {
        throw new Error("session: ended_at must be a string");
    }
    const out = {
        schema_version: r.schema_version,
        session_id: typeof r.session_id === "string" ? r.session_id : "",
        project_id: r.project_id,
        started_at: r.started_at,
        ended_at: r.ended_at,
        status: r.status,
        checkpoint_refs: r.checkpoint_refs,
        handoff_refs: r.handoff_refs,
        previous_session_ref: r.previous_session_ref,
        next_session_ref: r.next_session_ref,
    };
    return out;
}
function loadAndVerifySession(path, projectId, id) {
    let raw;
    try {
        raw = readFileSync(path, "utf8");
    }
    catch (err) {
        throw new SessionIntegrityError(`cannot read session ${id}: ${err.message}`);
    }
    let envelope;
    try {
        envelope = JSON.parse(raw);
    }
    catch (err) {
        throw new SessionIntegrityError(`session ${id} is not valid JSON: ${err.message}`);
    }
    if (envelope.schema_version !== "1.0.0") {
        throw new SessionIntegrityError(`session ${id} has unsupported schema_version ${envelope.schema_version}`);
    }
    const content = verify(envelope);
    if (content.session_id !== id) {
        throw new SessionIntegrityError(`session id mismatch: file ${id} but content says ${content.session_id}`);
    }
    if (content.project_id !== projectId) {
        throw new SessionIntegrityError(`session project_id mismatch: ${content.project_id} vs ${projectId}`);
    }
    return content;
}
//# sourceMappingURL=session-store.js.map