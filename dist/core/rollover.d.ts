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
import type { CheckpointStatus } from "./checkpoint.js";
import { type HistoryRef } from "./checkpoint.js";
export declare const ROLLOVER_SCHEMA_VERSION: "1.0.0";
/**
 * Rollover reason. Frozen in S04:
 *
 *   - NATURAL  — work package is complete; the next session
 *                continues the next work package.
 *   - PRESSURE — work package is unfinished; the next session
 *                continues the same work package.
 */
export type RolloverReason = "NATURAL" | "PRESSURE";
export declare const ROLLOVER_REASONS: readonly RolloverReason[];
/**
 * Rollover state machine. State transitions are explicit and
 * idempotent where appropriate. See `transitionRolloverState` in
 * the store for the allowed edges.
 *
 *   IDLE      → PREPARING
 *   PREPARING → READY
 *   PREPARING → FAILED
 *   READY     → EXECUTING
 *   READY     → CANCELLED
 *   EXECUTING → COMPLETE
 *   EXECUTING → FAILED
 *   FAILED    → (terminal; may transition only to PREPARING
 *                for a fresh retry with a new request id)
 *   COMPLETE  → (terminal)
 *   CANCELLED → (terminal)
 *
 * The persistence layer is responsible for rejecting any
 * non-allowed transition.
 */
export type RolloverState = "IDLE" | "PREPARING" | "READY" | "EXECUTING" | "COMPLETE" | "FAILED" | "CANCELLED";
export declare const ROLLOVER_STATES: readonly RolloverState[];
/**
 * Failure code. Frozen enum; an implementation MAY attach a more
 * specific reason through a free-form `failure_detail` field that
 * the orchestrator does not interpret.
 */
export type RolloverFailureCode = "checkpoint_missing" | "checkpoint_corrupt" | "handoff_missing" | "handoff_corrupt" | "project_mismatch" | "session_mismatch" | "duplicate_executing" | "not_in_v3_mode" | "lock_held" | "pre_new_gate_failed" | "new_session_failed" | "hydration_failed" | "cancelled_by_extension" | "unknown";
export declare const ROLLOVER_FAILURE_CODES: readonly RolloverFailureCode[];
/**
 * RolloverRequest is the durable record that the command
 * consumes. It is the only input the command parses; it MUST
 * contain:
 *   - the request id
 *   - the project id
 *   - the old session id
 *   - the reason
 *   - the checkpoint ref
 *   - the handoff ref
 *   - the current state
 *
 * It MUST NOT contain:
 *   - checkpoint body
 *   - handoff body
 *   - file contents
 *   - tool output
 *   - secrets
 *
 * `checkpoint_ref` and `handoff_ref` are the only "see-also"
 * pieces; the orchestrator looks them up at execute time.
 */
export interface RolloverRequest {
    readonly schema_version: typeof ROLLOVER_SCHEMA_VERSION;
    readonly rollover_request_id: string;
    readonly project_id: string;
    readonly old_session_id: string;
    readonly reason: RolloverReason;
    readonly checkpoint_ref: string;
    readonly handoff_ref: string;
    readonly checkpoint_status: CheckpointStatus;
    readonly state: RolloverState;
    readonly created_at: string;
    readonly updated_at: string;
    /** Optional: the new session id, set when state == COMPLETE. */
    readonly new_session_id: string | null;
    /** Optional: failure code, set when state == FAILED. */
    readonly failure_code: RolloverFailureCode | null;
    /** Optional: implementation-specific failure detail. */
    readonly failure_detail: string | null;
    /**
     * Optional recovery_refs the orchestrator may attach so the
     * next session can resume from the same evidence surface.
     * These are the SAME refs the handoff carried; the orchestrator
     * does not extract them from raw tool payload.
     */
    readonly recovery_refs: readonly HistoryRef[];
}
/**
 * Pure structural validation. Throws on the first violation.
 */
export declare function validateRolloverRequest(input: unknown): RolloverRequest;
/**
 * Pure: returns true if `from -> to` is an allowed transition.
 */
export declare function isAllowedRolloverTransition(from: RolloverState, to: RolloverState): boolean;
/**
 * Pure: returns the set of allowed next states from `from`.
 */
export declare function allowedRolloverTransitions(from: RolloverState): readonly RolloverState[];
//# sourceMappingURL=rollover.d.ts.map