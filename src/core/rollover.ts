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

export const ROLLOVER_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Rollover reason. Frozen in S04:
 *
 *   - NATURAL  — work package is complete; the next session
 *                continues the next work package.
 *   - PRESSURE — work package is unfinished; the next session
 *                continues the same work package.
 */
export type RolloverReason = "NATURAL" | "PRESSURE";

export const ROLLOVER_REASONS: readonly RolloverReason[] = Object.freeze([
	"NATURAL",
	"PRESSURE",
]);

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
export type RolloverState =
	| "IDLE"
	| "PREPARING"
	| "READY"
	| "EXECUTING"
	| "COMPLETE"
	| "FAILED"
	| "CANCELLED";

export const ROLLOVER_STATES: readonly RolloverState[] = Object.freeze([
	"IDLE",
	"PREPARING",
	"READY",
	"EXECUTING",
	"COMPLETE",
	"FAILED",
	"CANCELLED",
]);

/**
 * Failure code. Frozen enum; an implementation MAY attach a more
 * specific reason through a free-form `failure_detail` field that
 * the orchestrator does not interpret.
 */
export type RolloverFailureCode =
	| "checkpoint_missing"
	| "checkpoint_corrupt"
	| "handoff_missing"
	| "handoff_corrupt"
	| "project_mismatch"
	| "session_mismatch"
	| "duplicate_executing"
	| "not_in_v3_mode"
	| "lock_held"
	| "pre_new_gate_failed"
	| "new_session_failed"
	| "hydration_failed"
	| "cancelled_by_extension"
	| "unknown";

export const ROLLOVER_FAILURE_CODES: readonly RolloverFailureCode[] = Object.freeze([
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
export function validateRolloverRequest(input: unknown): RolloverRequest {
	if (typeof input !== "object" || input === null) {
		throw new Error("validateRolloverRequest: input must be an object");
	}
	const r = input as Record<string, unknown>;

	requireString(r, "schema_version", "rollover");
	if (r.schema_version !== ROLLOVER_SCHEMA_VERSION) {
		throw new Error(
			`validateRolloverRequest: schema_version must be ${ROLLOVER_SCHEMA_VERSION} (got ${String(r.schema_version)})`,
		);
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
		throw new Error(
			`validateRolloverRequest: failure_code is not a known code (${String(r.failure_code)})`,
		);
	}
	requireNullableString(r, "failure_detail", "rollover");
	requireHistoryRefs(r, "recovery_refs", "rollover");

	return r as unknown as RolloverRequest;
}

/**
 * Allowed state transitions. The state machine is intentionally
 * narrow: only the documented edges are permitted. The persistence
 * layer enforces this on every write.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<RolloverState, readonly RolloverState[]>> =
	Object.freeze({
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
export function isAllowedRolloverTransition(
	from: RolloverState,
	to: RolloverState,
): boolean {
	if (!isRolloverState(from) || !isRolloverState(to)) return false;
	return (ALLOWED_TRANSITIONS[from] as readonly RolloverState[]).includes(to);
}

/**
 * Pure: returns the set of allowed next states from `from`.
 */
export function allowedRolloverTransitions(from: RolloverState): readonly RolloverState[] {
	return ALLOWED_TRANSITIONS[from];
}

/* -------------------------------------------------------------------- *
 * Type guards + validation helpers                                      *
 * -------------------------------------------------------------------- */

function isRolloverState(v: unknown): v is RolloverState {
	return (
		typeof v === "string" && (ROLLOVER_STATES as readonly string[]).includes(v)
	);
}

function isFailureCode(v: unknown): v is RolloverFailureCode {
	return (
		typeof v === "string" &&
		(ROLLOVER_FAILURE_CODES as readonly string[]).includes(v)
	);
}

function requireString(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	if (typeof o[key] !== "string" || (o[key] as string).length === 0) {
		throw new Error(`validate${cap(owner)}: ${key} must be a non-empty string`);
	}
}

function requireNullableString(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	if (o[key] !== null && typeof o[key] !== "string") {
		throw new Error(
			`validate${cap(owner)}: ${key} must be a string or null (got ${typeof o[key]})`,
		);
	}
}

function requireReason(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	const v = o[key];
	if (typeof v !== "string" || !(ROLLOVER_REASONS as readonly string[]).includes(v)) {
		throw new Error(
			`validate${cap(owner)}: ${key} must be one of ${ROLLOVER_REASONS.join(" | ")} (got ${String(v)})`,
		);
	}
}

function requireStatus(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	const v = o[key];
	if (
		typeof v !== "string" ||
		!(["COMPLETE", "IN_PROGRESS", "BLOCKED"] as const).includes(
			v as "COMPLETE" | "IN_PROGRESS" | "BLOCKED",
		)
	) {
		throw new Error(
			`validate${cap(owner)}: ${key} must be one of COMPLETE | IN_PROGRESS | BLOCKED (got ${String(v)})`,
		);
	}
}

function requireState(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	const v = o[key];
	if (!isRolloverState(v)) {
		throw new Error(
			`validate${cap(owner)}: ${key} must be one of ${ROLLOVER_STATES.join(" | ")} (got ${String(v)})`,
		);
	}
}

function requireHistoryRefs(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	const v = o[key];
	if (!Array.isArray(v)) {
		throw new Error(`validate${cap(owner)}: ${key} must be an array of HistoryRef`);
	}
	for (const item of v) {
		if (
			typeof item !== "object" ||
			item === null ||
			typeof (item as HistoryRef).kind !== "string" ||
			typeof (item as HistoryRef).id !== "string" ||
			typeof (item as HistoryRef).uri !== "string"
		) {
			throw new Error(
				`validate${cap(owner)}: ${key}[] must have { kind, id, uri } strings`,
			);
		}
	}
}

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
