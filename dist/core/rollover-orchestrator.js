/**
 * Portable core — fresh-session rollover orchestrator (data plane).
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §6, §7, §9, §10.
 *
 * The orchestrator is the single authority for the S04 lifecycle:
 *
 *   validate state
 *   → persist Checkpoint
 *   → project + persist Handoff
 *   → persist RolloverRequest (state: PREPARING → READY)
 *   → return the rollover ref for the command to consume
 *
 * The orchestrator:
 *   - validates the structured state at every step
 *   - throws a typed error if persistence fails
 *   - returns a single, opaque rollover ref on success
 *   - never calls `ctx.newSession()` itself
 *   - never reads from raw tool payload; only from structured state
 *   - never embeds checkpoint / handoff / file / tool body in its
 *     command surface
 *
 * The command / runtime layer (S04) consumes the returned ref via
 * `/picm-rollover-execute <opaque-id>`. That command is the
 * only place that calls `ctx.newSession`.
 *
 * This module is pure data + pure functions, with the S02 store
 * injected as a constructor argument. It does not import Pi, does
 * not import node:process, and is fully testable in isolation.
 */
import { parseRef, requireRef, projectHandoffFromCheckpoint, validateCheckpoint, validateHandoff, } from "../core/index.js";
import { ROLLOVER_SCHEMA_VERSION, } from "../core/rollover.js";
/* -------------------------------------------------------------------- *
 * Orchestrator implementation                                           *
 * -------------------------------------------------------------------- */
export class RolloverOrchestratorError extends Error {
    failure_code;
    constructor(message, failure_code) {
        super(message);
        this.failure_code = failure_code;
        this.name = "RolloverOrchestratorError";
    }
}
/**
 * In-process lock table. The store is local-first and one process
 * opens it; an in-process lock is sufficient for the S04 contract.
 * A future multi-process deployment would add a flock-based lock
 * here; the lock surface is the same.
 */
class RolloverLock {
    holders = new Map(); // key = project+session, value = holder id
    acquire(key, holder) {
        const current = this.holders.get(key);
        if (current !== undefined && current !== holder)
            return false;
        this.holders.set(key, holder);
        return true;
    }
    release(key, holder) {
        const current = this.holders.get(key);
        if (current === holder)
            this.holders.delete(key);
    }
    holder(key) {
        return this.holders.get(key);
    }
}
export function createRolloverOrchestrator(store) {
    const lock = new RolloverLock();
    return {
        async prepare(opts) {
            const { projectId, oldSessionId, checkpoint, reason, handoff, recovery_refs, now, lockHolder } = opts;
            const lockKey = `${projectId}::${oldSessionId}`;
            const holder = lockHolder ?? `auto-${oldSessionId}`;
            if (!lock.acquire(lockKey, holder)) {
                throw new RolloverOrchestratorError(`rollover lock already held for ${lockKey}`, "lock_held");
            }
            try {
                // 1) validate checkpoint
                const cp = validateCheckpoint(checkpoint);
                if (cp.project_id !== projectId) {
                    throw new RolloverOrchestratorError(`checkpoint project_id ${cp.project_id} does not match ${projectId}`, "project_mismatch");
                }
                if (cp.session_id !== oldSessionId) {
                    throw new RolloverOrchestratorError(`checkpoint session_id ${cp.session_id} does not match ${oldSessionId}`, "session_mismatch");
                }
                // 2) project or validate the handoff
                let ho;
                if (handoff === undefined) {
                    ho = projectHandoffFromCheckpoint(cp);
                }
                else {
                    ho = validateHandoff(handoff);
                }
                if (ho.work_package !== cp.work_package) {
                    throw new RolloverOrchestratorError(`handoff work_package ${ho.work_package} does not match checkpoint ${cp.work_package}`, "checkpoint_corrupt");
                }
                // 3) persist checkpoint
                const cpWrite = store.checkpoints.write(cp, {
                    projectId,
                    sessionId: oldSessionId,
                });
                // 4) persist handoff
                const hoWrite = store.handoffs.fromCheckpoint(cpWrite.checkpoint, { projectId });
                // 5) persist RolloverRequest in state READY.
                // The store assigns the rollover_request_id; the
                // validator only requires it to be a non-empty
                // string. We seed it with a placeholder so the
                // draft is structurally valid; the store replaces
                // it with a generated id.
                const refArr = recovery_refs ?? ho.recovery_refs;
                const ts = now ?? new Date().toISOString();
                const draft = {
                    schema_version: ROLLOVER_SCHEMA_VERSION,
                    rollover_request_id: "_pending_", // store assigns
                    project_id: projectId,
                    old_session_id: oldSessionId,
                    reason,
                    checkpoint_ref: cpWrite.ref,
                    handoff_ref: hoWrite.ref,
                    checkpoint_status: cpWrite.checkpoint.status,
                    state: "PREPARING",
                    created_at: ts,
                    updated_at: ts,
                    new_session_id: null,
                    failure_code: null,
                    failure_detail: null,
                    recovery_refs: refArr,
                };
                const prepared = store.rollovers.write(draft, { projectId, oldSessionId });
                // Move to READY in a single transition.
                const ready = store.rollovers.transition({
                    projectId,
                    ref: prepared.ref,
                    to: "READY",
                    now: ts,
                });
                return { ref: prepared.ref, id: prepared.id, request: ready };
            }
            catch (err) {
                // On any failure, release the lock and re-throw. A
                // failed prepare must not block subsequent retries
                // from a fresh request id.
                lock.release(lockKey, holder);
                throw err;
            }
        },
        preNewGate(input) {
            const { request, checkpoint, handoff, mode, projectId, oldSessionId, now } = input;
            if (mode !== "v3") {
                return {
                    ok: false,
                    reason: "BLOCKED",
                    failure_code: "not_in_v3_mode",
                    detail: `mode=${mode} forbids newSession`,
                };
            }
            if (request.project_id !== projectId) {
                return {
                    ok: false,
                    reason: "BLOCKED",
                    failure_code: "project_mismatch",
                    detail: "rollover project_id does not match supplied projectId",
                };
            }
            if (request.old_session_id !== oldSessionId) {
                return {
                    ok: false,
                    reason: "BLOCKED",
                    failure_code: "session_mismatch",
                    detail: "rollover old_session_id does not match supplied oldSessionId",
                };
            }
            if (request.state !== "READY") {
                return {
                    ok: false,
                    reason: "BLOCKED",
                    failure_code: "pre_new_gate_failed",
                    detail: `rollover state is ${request.state}, expected READY`,
                };
            }
            if (checkpoint === null || checkpoint === undefined) {
                return {
                    ok: false,
                    reason: "BLOCKED",
                    failure_code: "checkpoint_missing",
                    detail: "checkpoint not loaded",
                };
            }
            if (handoff === null || handoff === undefined) {
                return {
                    ok: false,
                    reason: "BLOCKED",
                    failure_code: "handoff_missing",
                    detail: "handoff not loaded",
                };
            }
            if (checkpoint.project_id !== projectId) {
                return {
                    ok: false,
                    reason: "BLOCKED",
                    failure_code: "project_mismatch",
                    detail: "checkpoint project_id mismatch",
                };
            }
            if (checkpoint.session_id !== oldSessionId) {
                return {
                    ok: false,
                    reason: "BLOCKED",
                    failure_code: "session_mismatch",
                    detail: "checkpoint session_id mismatch",
                };
            }
            if (handoff.work_package !== checkpoint.work_package) {
                return {
                    ok: false,
                    reason: "BLOCKED",
                    failure_code: "pre_new_gate_failed",
                    detail: "handoff work_package does not match checkpoint work_package",
                };
            }
            // lastSeen == now hint to silence unused warnings; tests
            // may use it.
            void now;
            return { ok: true, reason: "READY" };
        },
        buildHydrationText(handoff) {
            const refList = handoff.recovery_refs
                .map((r) => `- ${r.kind}: ${r.uri}`)
                .join("\n");
            const fileList = handoff.current_files.length === 0
                ? "(none)"
                : handoff.current_files.map((f) => `- ${f}`).join("\n");
            const decisionList = handoff.important_decisions.length === 0
                ? "(none)"
                : handoff.important_decisions.map((d) => `- ${d}`).join("\n");
            const constraintList = handoff.hard_constraints.length === 0
                ? "(none)"
                : handoff.hard_constraints.map((c) => `- ${c}`).join("\n");
            const blockerList = handoff.blockers.length === 0
                ? "(none)"
                : handoff.blockers.map((b) => `- ${b}`).join("\n");
            const errorList = handoff.active_errors.length === 0
                ? "(none)"
                : handoff.active_errors.map((e) => `- ${e}`).join("\n");
            const nextActionList = handoff.next_actions.length === 0
                ? "(none)"
                : handoff.next_actions.map((n) => `- ${n}`).join("\n");
            const gitLine = handoff.git_state.repository
                ? `Repository: ${handoff.git_state.repository}\nBranch: ${handoff.git_state.branch ?? "(detached)"}\nHEAD: ${handoff.git_state.head ?? "(none)"}\nDirty: ${handoff.git_state.dirty === null ? "(unknown)" : handoff.git_state.dirty ? "yes" : "no"}`
                : "(non-Git project)";
            const text = [
                "# PICM durable continuation state",
                "",
                "This is the MinimalHandoff projection persisted before",
                "session replacement. It is the only carry-over from the",
                "previous session. Older detail is recoverable on demand via",
                "the recovery_refs at the end of this document.",
                "",
                "## Goal",
                handoff.goal,
                "",
                "## Work package",
                handoff.work_package,
                "",
                "## Status",
                handoff.status,
                "",
                "## Important decisions",
                decisionList,
                "",
                "## Hard constraints",
                constraintList,
                "",
                "## Current files",
                fileList,
                "",
                "## Blockers",
                blockerList,
                "",
                "## Active errors",
                errorList,
                "",
                "## Git state",
                gitLine,
                "",
                "## Next actions",
                nextActionList,
                "",
                "## Recovery references",
                refList,
                "",
                "---",
                "Do not paste prior transcripts or raw tool output into",
                "this continuation. Use `picm_recover <ref>` to load any",
                "older detail on demand.",
            ].join("\n");
            return { text, recovery_refs: handoff.recovery_refs };
        },
    };
}
/* -------------------------------------------------------------------- *
 * Pure helpers                                                          *
 * -------------------------------------------------------------------- */
function makeRolloverRef(id, _store) {
    // In S04 the ref is opaque; we re-use the S01 makeRef directly
    // to keep the surface uniform across the durable store and
    // the orchestrator. Reserved for callers that need a ref
    // from a bare id; the orchestrator now returns the ref the
    // store issued directly.
    return `cmv3://rollover/${id}`;
} /**
 * Public helper: parse a ref-like input into a RolloverRequest
 * without exposing internal store details. Used by the runtime
 * command to validate the user's input.
 */
export function parseRolloverRef(uri) {
    const parsed = parseRef(uri);
    if (parsed === null)
        return null;
    if (parsed.kind !== "rollover")
        return null;
    return { id: parsed.id };
}
/**
 * Public helper: like parseRolloverRef, but throws. Used by the
 * command when an invalid ref is a hard error.
 */
export function requireRolloverRef(uri) {
    const parsed = parseRef(uri);
    if (parsed === null) {
        throw new Error(`requireRolloverRef: invalid ref URI: ${uri}`);
    }
    if (parsed.kind !== "rollover") {
        throw new Error(`requireRolloverRef: ref is not a rollover ref: ${uri}`);
    }
    return { id: parsed.id };
}
// silence the type import to ensure it's not dropped by tree-shake.
void requireRef;
void makeRolloverRef;
//# sourceMappingURL=rollover-orchestrator.js.map