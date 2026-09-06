/**
 * Portable core — rollover request contract.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §6, §7, §9, §10.
 *
 * S04 implements a deterministic, persist-before-NEW fresh-session
 * rollover lifecycle:
 *
 *   work
 *   → durable Checkpoint
 *   → durable Minimal Handoff
 *   → durable RolloverRequest  (state: PREPARED)
 *   → /picm-rollover-execute <opaque-request-id>  (state: EXECUTING)
 *   → ctx.newSession({ setup, withSession })
 *   → withSession(freshCtx): persist new session, link records,
 *                           hydrate only MinimalHandoff
 *   → state: COMPLETE
 *
 * Hard invariants:
 *   - Persistence of Checkpoint AND Handoff AND RolloverRequest
 *     MUST succeed BEFORE `ctx.newSession()` is called. If any
 *     persistence step fails, no rollover is initiated.
 *   - The command receives only an opaque rollover_request_id.
 *     The command does NOT receive checkpoint body, handoff
 *     body, file contents, tool output, or secrets.
 *   - Once EXECUTING, a duplicate `/picm-rollover-execute` for
 *     the same rollover_request_id is idempotent. A duplicate
 *     call does NOT create a second new session.
 *   - A complete or failed request cannot be re-executed.
 *   - The rollover orchestrator is the only surface that calls
 *     `ctx.newSession`. Tool handlers, event handlers, and
 *     pressure observers MUST NOT.
 *
 * This module is pure: pure contract types, pure validation, and
 * a pure state machine. No I/O, no Pi, no host project.
 */
export const ROLLOVER_SCHEMA_VERSION = "1.0.0";
export const ROLLOVER_REASONS = Object.freeze([
    "NATURAL",
    "PRESSURE",
]);
export const ROLLOVER_STATES = Object.freeze([
    "IDLE",
    "PREPARING",
    "READY",
    "EXECUTING",
    "COMPLETE",
    "FAILED",
    "CANCELLED",
]);
export const ROLLOVER_FAILURE_CODES = Object.freeze([
    "checkpoint_missing",
    "checkpoint_corrupt",
    "handoff_missing",
    "handoff_corrupt",
    "project_mismatch",
    "session_mismatch",
    "duplicate_executing",
    "not_in_v3_mode",
    "lock_held",
    "pre_new_gate_failed",
    "new_session_failed",
    "hydration_failed",
    "cancelled_by_extension",
    "unknown",
]);
/**
 * Pure structural validation. Throws on the first violation.
 */
export function validateRolloverRequest(input) {
    if (typeof input !== "object" || input === null) {
        throw new Error("validateRolloverRequest: input must be an object");
    }
    const r = input;
    requireString(r, "schema_version", "rollover");
    if (r.schema_version !== ROLLOVER_SCHEMA_VERSION) {
        throw new Error(`validateRolloverRequest: schema_version must be ${ROLLOVER_SCHEMA_VERSION} (got ${String(r.schema_version)})`);
    }
    requireString(r, "rollover_request_id", "rollover");
    requireString(r, "project_id", "rollover");
    requireString(r, "old_session_id", "rollover");
    requireReason(r, "reason", "rollover");
    requireString(r, "checkpoint_ref", "rollover");
    requireString(r, "handoff_ref", "rollover");
    requireStatus(r, "checkpoint_status", "rollover");
    requireState(r, "state", "rollover");
    requireString(r, "created_at", "rollover");
    requireString(r, "updated_at", "rollover");
    requireNullableString(r, "new_session_id", "rollover");
    requireNullableString(r, "failure_code", "rollover");
    if (r.failure_code !== null && !isFailureCode(r.failure_code)) {
        throw new Error(`validateRolloverRequest: failure_code is not a known code (${String(r.failure_code)})`);
    }
    requireNullableString(r, "failure_detail", "rollover");
    requireHistoryRefs(r, "recovery_refs", "rollover");
    return r;
}
/**
 * Allowed state transitions. The state machine is intentionally
 * narrow: only the documented edges are permitted. The persistence
 * layer enforces this on every write.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
    IDLE: ["PREPARING"],
    PREPARING: ["READY", "FAILED"],
    READY: ["EXECUTING", "CANCELLED"],
    EXECUTING: ["COMPLETE", "FAILED"],
    COMPLETE: [],
    FAILED: ["PREPARING"], // explicit retry policy
    CANCELLED: [],
});
/**
 * Pure: returns true if `from -> to` is an allowed transition.
 */
export function isAllowedRolloverTransition(from, to) {
    if (!isRolloverState(from) || !isRolloverState(to))
        return false;
    return ALLOWED_TRANSITIONS[from].includes(to);
}
/**
 * Pure: returns the set of allowed next states from `from`.
 */
export function allowedRolloverTransitions(from) {
    return ALLOWED_TRANSITIONS[from];
}
/* -------------------------------------------------------------------- *
 * Type guards + validation helpers                                      *
 * -------------------------------------------------------------------- */
function isRolloverState(v) {
    return (typeof v === "string" && ROLLOVER_STATES.includes(v));
}
function isFailureCode(v) {
    return (typeof v === "string" &&
        ROLLOVER_FAILURE_CODES.includes(v));
}
function requireString(o, key, owner) {
    if (typeof o[key] !== "string" || o[key].length === 0) {
        throw new Error(`validate${cap(owner)}: ${key} must be a non-empty string`);
    }
}
function requireNullableString(o, key, owner) {
    if (o[key] !== null && typeof o[key] !== "string") {
        throw new Error(`validate${cap(owner)}: ${key} must be a string or null (got ${typeof o[key]})`);
    }
}
function requireReason(o, key, owner) {
    const v = o[key];
    if (typeof v !== "string" || !ROLLOVER_REASONS.includes(v)) {
        throw new Error(`validate${cap(owner)}: ${key} must be one of ${ROLLOVER_REASONS.join(" | ")} (got ${String(v)})`);
    }
}
function requireStatus(o, key, owner) {
    const v = o[key];
    if (typeof v !== "string" ||
        !["COMPLETE", "IN_PROGRESS", "BLOCKED"].includes(v)) {
        throw new Error(`validate${cap(owner)}: ${key} must be one of COMPLETE | IN_PROGRESS | BLOCKED (got ${String(v)})`);
    }
}
function requireState(o, key, owner) {
    const v = o[key];
    if (!isRolloverState(v)) {
        throw new Error(`validate${cap(owner)}: ${key} must be one of ${ROLLOVER_STATES.join(" | ")} (got ${String(v)})`);
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
//# sourceMappingURL=rollover.js.map