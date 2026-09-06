/**
 * Portable core — checkpoint contract.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §6.
 *
 * Schema-versioned durable project / session state. Not an LLM
 * narrative summary. Status distinguishes COMPLETE / IN_PROGRESS /
 * BLOCKED. Not every field must be populated; omission is a valid
 * value.
 *
 * S01: schema/types + pure validation. No persistence. No read/write.
 */
export const CHECKPOINT_SCHEMA_VERSION = "1.0.0";
export const CHECKPOINT_STATUSES = Object.freeze([
    "COMPLETE",
    "IN_PROGRESS",
    "BLOCKED",
]);
/**
 * Pure checkpoint validation. Returns the input on success; throws
 * `Error` on the first violation. The check is exhaustive over the
 * R02 §6 contract.
 *
 * S01 does not implement persistence. The schema is the contract;
 * runtime writers (S02) are expected to call this before persisting.
 */
export function validateCheckpoint(input) {
    if (typeof input !== "object" || input === null) {
        throw new Error("validateCheckpoint: input must be an object");
    }
    const c = input;
    requireString(c, "schema_version", "checkpoint");
    if (c.schema_version !== CHECKPOINT_SCHEMA_VERSION) {
        throw new Error(`validateCheckpoint: schema_version must be ${CHECKPOINT_SCHEMA_VERSION} (got ${String(c.schema_version)})`);
    }
    requireString(c, "checkpoint_id", "checkpoint");
    requireString(c, "project_id", "checkpoint");
    requireString(c, "session_id", "checkpoint");
    requireString(c, "created_at", "checkpoint");
    requireString(c, "goal", "checkpoint");
    requireString(c, "work_package", "checkpoint");
    requireStatus(c, "status", "checkpoint");
    requireStringArray(c, "completed", "checkpoint");
    requireStringArray(c, "in_progress", "checkpoint");
    requireStringArray(c, "blockers", "checkpoint");
    requireStringArray(c, "decisions", "checkpoint");
    requireStringArray(c, "constraints", "checkpoint");
    requireStringArray(c, "files_read", "checkpoint");
    requireStringArray(c, "files_modified", "checkpoint");
    requireStringArray(c, "relevant_versions", "checkpoint");
    requireStringArray(c, "tests", "checkpoint");
    requireStringArray(c, "validation_results", "checkpoint");
    requireStringArray(c, "active_errors", "checkpoint");
    requireNullableString(c, "git_repository", "checkpoint");
    requireNullableString(c, "git_branch", "checkpoint");
    requireNullableString(c, "git_head", "checkpoint");
    requireNullableBoolean(c, "git_dirty", "checkpoint");
    requireStringArray(c, "next_actions", "checkpoint");
    requireHistoryRefs(c, "recovery_refs", "checkpoint");
    // handoff_summary is an explicit, human-authored short summary.
    // Per R02 §6 it MUST be present, but the field is permitted
    // to be empty (e.g. for a checkpoint with no narrative value).
    requireOptionalString(c, "handoff_summary", "checkpoint");
    return c;
}
function requireString(o, key, owner) {
    if (typeof o[key] !== "string" || o[key].length === 0) {
        throw new Error(`validate${cap(owner)}: ${key} must be a non-empty string`);
    }
}
function requireOptionalString(o, key, owner) {
    if (o[key] === undefined) {
        throw new Error(`validate${cap(owner)}: ${key} must be present (may be empty)`);
    }
    if (typeof o[key] !== "string") {
        throw new Error(`validate${cap(owner)}: ${key} must be a string`);
    }
}
function requireNullableString(o, key, owner) {
    if (o[key] !== null && typeof o[key] !== "string") {
        throw new Error(`validate${cap(owner)}: ${key} must be a string or null (got ${typeof o[key]})`);
    }
}
function requireNullableBoolean(o, key, owner) {
    if (o[key] !== null && typeof o[key] !== "boolean") {
        throw new Error(`validate${cap(owner)}: ${key} must be a boolean or null (got ${typeof o[key]})`);
    }
}
function requireStatus(o, key, owner) {
    const v = o[key];
    if (typeof v !== "string" || !CHECKPOINT_STATUSES.includes(v)) {
        throw new Error(`validate${cap(owner)}: ${key} must be one of ${CHECKPOINT_STATUSES.join(" | ")} (got ${String(v)})`);
    }
}
function requireStringArray(o, key, owner) {
    const v = o[key];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
        throw new Error(`validate${cap(owner)}: ${key} must be an array of strings`);
    }
}
function requireHistoryRefs(o, key, owner) {
    const v = o[key];
    if (!Array.isArray(v)) {
        throw new Error(`validate${cap(owner)}: ${key} must be an array of HistoryRef`);
    }
    for (const item of v) {
        if (typeof item !== "object" ||
            item === null ||
            typeof item.kind !== "string" ||
            typeof item.id !== "string" ||
            typeof item.uri !== "string") {
            throw new Error(`validate${cap(owner)}: ${key}[] must have { kind, id, uri } strings`);
        }
    }
}
function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
//# sourceMappingURL=checkpoint.js.map