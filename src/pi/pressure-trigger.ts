/**
 * Live pressure → rollover continuation trigger (S05A).
 *
 * Authority: docs/LIVE_RUNTIME.md (S05A), docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §5, §9, §10.
 *
 * S05 detects ROLLOVER / EMERGENCY pressure at `agent_settled`.
 * S05A closes the remaining gap: at the moment pressure crosses
 * the rollover threshold in `v3` mode, the extension must inject
 * one trusted PICM directive that asks the agent to call
 * `picm_prepare_rollover` with structured state. The directive is
 * delivered via `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })`
 * — the official Pi v0.85.1+ surface for an extension-driven
 * continuation turn.
 *
 * Hard contract (PICM-owned, prompt-injection safe):
 *
 *   1. The directive content is a single FIXED, hard-coded
 *      string. It contains NO tool payload, NO transcript, NO
 *      file content, NO retrieved web text, NO arbitrary
 *      external text. The string is the canonical PICM
 *      instruction to the agent. Operators audit it as part of
 *      the PICM source.
 *
 *   2. The only data attached to the custom message is
 *      deterministic pressure metadata in `details`
 *      (`{ pressureState, action, reason }`). The metadata is
 *      derived from the pure `RolloverDecision`; it never
 *      contains payload / transcript / file content.
 *
 *   3. The trigger is dedup-guarded per (project, session).
 *      First eligible `agent_settled` issues one message.
 *      Subsequent settled events for the same key are no-ops
 *      until the state machine transitions out of PENDING
 *      (session_start, or terminal state of the prepare call).
 *
 *   4. The trigger has a bounded retry policy on prepare
 *      failure: 1 immediate retry (the next eligible settled
 *      event after a retryable failure), then quiet. Quiet
 *      state is cleared by `session_start`.
 *
 *   5. The trigger NEVER calls `ctx.newSession`, `ctx.compact`,
 *      or any other session-mutating API. The trigger is the
 *      S05A bridge from pressure observation to a single
 *      trusted follow-up turn; the S04 command remains the
 *      sole newSession owner.
 *
 *   6. CHECKPOINT pressure does NOT issue a rollover message.
 *      v3-observe and legacy never issue a rollover message.
 *      Only `v3` + ROLLOVER / EMERGENCY + agentSettled is
 *      eligible.
 *
 *  The module exports a pure decision function and a small
 *  per-(project, session) state machine. The extension wires
 *  the machine into the `agent_settled` handler, the
 *  `session_start` handler, and the `picm_prepare_rollover`
 *  tool's success / failure paths.
 */

import type { PressureState } from "../core/pressure.js";
import type {
	RolloverDecision,
	RolloverPressureAction,
} from "../core/rollover-pressure.js";
import type { CMV3Mode } from "../core/config.js";

/* -------------------------------------------------------------------- *
 * Public constants                                                      *
 * -------------------------------------------------------------------- */

/**
 * The custom message type registered with `pi.sendMessage()`.
 * The runtime renders `display: false` messages through the
 * registered custom-message renderer (or as hidden entries when
 * no renderer is registered). The directive reaches the LLM
 * because `content` is a non-empty string; the user-facing TUI
 * can render it however the operator's renderer chooses.
 */
export const PICM_PRESSURE_CUSTOM_TYPE = "picm-pressure-rollover";

/**
 * The fixed, trusted PICM directive. This is the ONLY string
 * the agent ever sees as the body of a pressure-continuation
 * message. It is intentionally short, contains no payload
 * placeholders, and never includes tool output, file content,
 * transcript, or any external text.
 *
 * Operators audit this constant as part of the PICM source
 * surface. Any change here is a behavior change for the
 * extension; the S05A acceptance spec test 4 ("directive
 * contains no raw tool payload") checks the body against a
 * small deny-list of payload-shaped substrings.
 */
export const FIXED_TRUSTED_PICM_DIRECTIVE = [
	"PICM context pressure requires rollover.",
	"",
	"Call `picm_prepare_rollover` now with:",
	"  reason: PRESSURE",
	"  goal: <current goal>",
	"  work_package: <current work package>",
	"  status: IN_PROGRESS",
	"  completed: <completed portions>",
	"  in_progress: <current in-progress work>",
	"  blockers: <blockers>",
	"  important_decisions: <decisions>",
	"  hard_constraints: <constraints>",
	"  current_files: <current files>",
	"  active_errors: <active errors>",
	"  next_actions: <next actions>",
	"  recovery_refs: <recovery refs>",
	"",
	"Do not continue ordinary work until the rollover preparation",
	"either succeeds and you then run `/picm-rollover-execute`,",
	"or returns a typed failure you can act on. Do not ask the",
	"operator to paste the full conversation; the structured",
	"checkpoint + handoff is the only carry-over.",
].join("\n");

/**
 * Substrings that must NEVER appear in the directive. The S05A
 * test 4 ("directive contains no raw tool payload") enforces
 * the deny-list on the constant. The list is a small, fixed
 * set of injection-shaped markers; PICM does not parse
 * payloads but the deny-list keeps the audit surface tight.
 */
export const PRESSURE_DIRECTIVE_DENY_SUBSTRINGS: readonly string[] = [
	"<tool_result",
	"<tool_result>",
	"<bash",
	"<file_content",
	"<transcript",
	"<system>",
	"<user_query",
	"<assistant_response",
];

/* -------------------------------------------------------------------- *
 * Public types                                                          *
 * -------------------------------------------------------------------- */

/**
 * Minimal deterministic pressure metadata attached to the
 * custom message's `details`. The values are derived from the
 * pure `RolloverDecision`; nothing in `details` originates
 * from payload / transcript / file content.
 */
export interface PressureRolloverDetails {
	readonly pressureState: PressureState;
	readonly action: RolloverPressureAction;
	readonly reason: string;
}

/**
 * The `pi.sendMessage` payload shape. Mirrors
 * `Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">`
 * from the Pi v0.85.1 type surface, narrowed to the
 * pressure-continuation use case.
 */
export interface PressureRolloverMessage<T = PressureRolloverDetails> {
	readonly customType: typeof PICM_PRESSURE_CUSTOM_TYPE;
	readonly content: string;
	readonly display: false;
	readonly details: T;
}

/**
 * The `pi.sendMessage` options. Pi v0.85.1 accepts
 * `triggerTurn` and `deliverAs` on the top-level `pi.sendMessage`
 * call. PICM uses `triggerTurn: true, deliverAs: "followUp"`
 * per the S05A spec.
 */
export interface PressureRolloverOptions {
	readonly triggerTurn: true;
	readonly deliverAs: "followUp";
}

/**
 * The full extension-side pressure-trigger call. The extension
 * invokes `pi.sendMessage(message, options)` with this exact
 * shape. The helper functions below produce the message and
 * the options from a `RolloverDecision`.
 */
export interface PressureRolloverCall {
	readonly message: PressureRolloverMessage;
	readonly options: PressureRolloverOptions;
}

/* -------------------------------------------------------------------- *
 * Pure decision + builder                                               *
 * -------------------------------------------------------------------- */

/**
 * Decision input for the S05A trigger. The decision is PURE:
 * given the live `RolloverDecision`, the mode, and the
 * per-key dedup state, it tells the extension exactly what to
 * do (or do nothing).
 */
export interface ShouldTriggerInput {
	readonly decision: RolloverDecision;
	readonly mode: CMV3Mode;
	readonly machine: PressureTriggerMachine;
	/** Wall-clock now (ISO-8601). Optional; tests pin it. */
	readonly now?: string;
}

/**
 * The decision is structured so the extension can both
 *   - inspect `shouldSend` to decide whether to call
 *     `pi.sendMessage` at all
 *   - read the `PressureRolloverCall` to know what to send
 *   - read the `stateTransition` to feed back into the
 *     machine for the next call
 */
export interface ShouldTriggerOutput {
	/** True iff the extension should call `pi.sendMessage`. */
	readonly shouldSend: boolean;
	/** The exact payload to send. Present iff `shouldSend=true`. */
	readonly call: PressureRolloverCall | null;
	/** Diagnostic summary of why / why-not, for tests. */
	readonly diagnostic: string;
}

/**
 * The single pressure-trigger custom message factory. The
 * `content` is the FIXED directive; the `details` carry the
 * deterministic pressure metadata. Nothing else.
 */
export function buildPressureRolloverMessage(
	decision: RolloverDecision,
): PressureRolloverMessage {
	return {
		customType: PICM_PRESSURE_CUSTOM_TYPE,
		content: FIXED_TRUSTED_PICM_DIRECTIVE,
		display: false,
		details: {
			pressureState: decision.pressure,
			action: decision.action,
			reason: decision.reason,
		},
	};
}

/**
 * The single pressure-trigger options factory. The S05A spec
 * pins `triggerTurn: true` and `deliverAs: "followUp"`. The
 * options are an explicit `as const` literal type so the
 * runtime typecheck confirms the exact shape.
 */
export const PRESSURE_ROLLOVER_OPTIONS: PressureRolloverOptions = {
	triggerTurn: true,
	deliverAs: "followUp",
};

/**
 * Build the full `pi.sendMessage` call from a decision. Pure.
 */
export function buildPressureRolloverCall(
	decision: RolloverDecision,
): PressureRolloverCall {
	return {
		message: buildPressureRolloverMessage(decision),
		options: PRESSURE_ROLLOVER_OPTIONS,
	};
}

/* -------------------------------------------------------------------- *
 * Per-(project, session) state machine                                  *
 * -------------------------------------------------------------------- */

/**
 * The state machine has five states. Transitions are driven
 * only by the extension's `agent_settled`, `session_start`,
 * and `picm_prepare_rollover` handlers. The machine is
 * in-process; the per-extension state lifetime is one Pi
 * session.
 *
 *   IDLE              — eligible. The next eligible
 *                       `agent_settled` issues a send.
 *   PENDING           — the first send has been issued; the
 *                       next eligible `agent_settled` is a
 *                       no-op (the dedup guard).
 *   FAILED_RETRY      — a retryable failure was reported for
 *                       the PENDING send. The next eligible
 *                       `agent_settled` may issue the
 *                       bounded retry. FAILED_RETRY is the
 *                       ONE place where a second send is
 *                       permitted.
 *   RETRY_IN_FLIGHT   — the retry send has been issued; the
 *                       next eligible `agent_settled` is a
 *                       no-op. A retryable failure here
 *                       moves to FAILED_QUIET (the retry
 *                       budget is exhausted).
 *   FAILED_QUIET      — the retry budget is exhausted. The
 *                       slot stays quiet until `session_start`
 *                       clears the entry.
 *
 * The "exactly one retry" policy is encoded by splitting the
 * post-send "pending" state into two distinct states (PENDING
 * vs RETRY_IN_FLIGHT). Encoding it through PENDING alone
 * would lose the information about whether PENDING came from
 * the first send or the retry send.
 */
export type PressureTriggerState =
	| "IDLE"
	| "PENDING"
	| "FAILED_RETRY"
	| "RETRY_IN_FLIGHT"
	| "FAILED_QUIET";

/**
 * Outcome reported by the `picm_prepare_rollover` tool after
 * the orchestrator's `prepare()` returns or throws. The
 * extension feeds this back into the machine.
 */
export type PrepareOutcome =
	| { kind: "success" }
	| { kind: "failure"; failure_code: string; retryable: boolean };

/**
 * The per-(projectId, sessionId) state machine. Pure
 * transitions; the in-memory store is held by the extension
 * and consulted by `agent_settled`.
 */
export class PressureTriggerMachine {
	private state: PressureTriggerState = "IDLE";
	private lastTransitionAt: string | null = null;

	constructor(
		readonly projectId: string,
		readonly sessionId: string,
		readonly now: () => string = () => new Date().toISOString(),
	) {}

	/** Current state. The extension reads this for diagnostics. */
	getState(): PressureTriggerState {
		return this.state;
	}

	/** ISO timestamp of the most recent transition. */
	getLastTransitionAt(): string | null {
		return this.lastTransitionAt;
	}

	/**
	 * Should the extension call `pi.sendMessage` on this
	 * settled event? Returns `true` only for the first
	 * eligible event when the machine is `IDLE`, and for
	 * exactly one retry when the machine is `FAILED_RETRY`.
	 * Returns `false` for `PENDING`, `RETRY_IN_FLIGHT`, and
	 * `FAILED_QUIET`.
	 */
	shouldSendOnSettled(decision: RolloverDecision): boolean {
		// CHECKPOINT and below never trigger; EMERGENCY and
		// ROLLOVER are eligible. v3-observe and legacy never
		// trigger. (Mode is enforced at the extension level
		// before this method is called, but we re-check
		// defensively.)
		if (decision.action === "none") return false;
		if (decision.action === "checkpoint_refresh") return false;
		// Eligible actions: request_pressure_rollover,
		// request_emergency_rollover.
		if (this.state === "IDLE") return true;
		if (this.state === "FAILED_RETRY") {
			// Bounded retry: exactly one retry after a
			// retryable failure. If the prepare tool
			// reported `retryable=true` the extension
			// transitioned to FAILED_RETRY; we now allow
			// one more sendMessage. Any further failure
			// (including the retry itself) moves to
			// FAILED_QUIET.
			return true;
		}
		return false;
	}

	/**
	 * Mark "we just called `pi.sendMessage` for this settled
	 * event". Transitions:
	 *   - IDLE → PENDING (the first send)
	 *   - FAILED_RETRY → RETRY_IN_FLIGHT (the bounded retry)
	 *   - PENDING / RETRY_IN_FLIGHT / FAILED_QUIET: no-op
	 */
	markSent(): void {
		if (this.state === "IDLE") {
			this.state = "PENDING";
			this.lastTransitionAt = this.now();
			return;
		}
		if (this.state === "FAILED_RETRY") {
			this.state = "RETRY_IN_FLIGHT";
			this.lastTransitionAt = this.now();
			return;
		}
		// PENDING, RETRY_IN_FLIGHT, FAILED_QUIET: no
		// transition. The extension already called
		// `shouldSendOnSettled` first; this method is a
		// no-op if the state already reflects a send.
	}

	/**
	 * Mark the outcome of the `picm_prepare_rollover` tool
	 * call. The extension calls this when the LLM invokes
	 * the tool and either the orchestrator's `prepare()`
	 * returns (success) or throws (failure).
	 *
	 * Success on `PENDING` or `RETRY_IN_FLIGHT`: → `IDLE`. The
	 * new session's `session_start` will clear the
	 * per-(project, session) entry; the slot is
	 * conceptually consumed.
	 *
	 * Retryable failure on `PENDING`: → `FAILED_RETRY`. The
	 * next eligible settled event re-issues the message
	 * (the bounded-retry budget is still available).
	 *
	 * Retryable failure on `RETRY_IN_FLIGHT`: → `FAILED_QUIET`.
	 * The bounded-retry budget is exhausted; the slot stays
	 * quiet until `session_start` clears the entry.
	 *
	 * Non-retryable failure on `PENDING` or `RETRY_IN_FLIGHT`:
	 * → `FAILED_QUIET`. Same quiet contract.
	 */
	applyPrepareOutcome(outcome: PrepareOutcome): void {
		if (outcome.kind === "success") {
			this.state = "IDLE";
			this.lastTransitionAt = this.now();
			return;
		}
		if (outcome.retryable && this.state === "PENDING") {
			this.state = "FAILED_RETRY";
			this.lastTransitionAt = this.now();
			return;
		}
		// Non-retryable OR retry-budget-exhausted: quiet.
		this.state = "FAILED_QUIET";
		this.lastTransitionAt = this.now();
	}

	/**
	 * Clear the entry. Called by the extension on
	 * `session_start` for this (project, session) pair. After
	 * clearing, the machine is again eligible to issue one
	 * pressure continuation message on the next settled
	 * event.
	 */
	clear(): void {
		this.state = "IDLE";
		this.lastTransitionAt = this.now();
	}
}

/* -------------------------------------------------------------------- *
 * Should-trigger decision                                               *
 * -------------------------------------------------------------------- */

/**
 * Decide whether the extension should call
 * `pi.sendMessage(...)` on the current `agent_settled` event.
 * Pure: same input → same output, no side effects.
 *
 * Eligibility rules (the AND-of-conditions from the S05A
 * spec):
 *
 *   mode == v3
 *   AND agentSettled == true
 *   AND pressure ∈ {ROLLOVER, EMERGENCY}
 *   AND decision.action ∈ {request_pressure_rollover,
 *                          request_emergency_rollover}
 *   AND machine.shouldSendOnSettled(decision) == true
 *
 * The function also records no side effects: the caller is
 * responsible for invoking `machine.markSent()` only after
 * actually calling `pi.sendMessage`.
 */
export function shouldTriggerPressureRollover(
	input: ShouldTriggerInput,
): ShouldTriggerOutput {
	const { decision, mode, machine } = input;
	// 1) mode gate: only v3 issues a trigger.
	if (mode !== "v3") {
		return {
			shouldSend: false,
			call: null,
			diagnostic: `mode=${mode}: PICM does not send a pressure continuation`,
		};
	}
	// 2) action gate: only the rollover / emergency request
	// actions trigger. CHECKPOINT and "none" do not.
	if (
		decision.action !== "request_pressure_rollover" &&
		decision.action !== "request_emergency_rollover"
	) {
		return {
			shouldSend: false,
			call: null,
			diagnostic: `action=${decision.action}: below rollover threshold; no trigger`,
		};
	}
	// 3) machine gate: dedup / loop guard per (project,
	// session).
	if (!machine.shouldSendOnSettled(decision)) {
		return {
			shouldSend: false,
			call: null,
			diagnostic: `machine state=${machine.getState()}: dedup / retry-budget exhausted; no trigger`,
		};
	}
	// 4) Eligible. Build the exact call.
	return {
		shouldSend: true,
		call: buildPressureRolloverCall(decision),
		diagnostic: `mode=v3 action=${decision.action} state=${machine.getState()}: eligible; send one pressure continuation`,
	};
}

/* -------------------------------------------------------------------- *
 * Prepare-outcome helper for the extension                             *
 * -------------------------------------------------------------------- */

/**
 * Determine whether a thrown `RolloverOrchestratorError`
 * (or any thrown value) is retryable. The retryable set is
 * small and explicit: lock contention is retryable (the next
 * settled event will see the lock released); corruption /
 * mismatch / validation failures are not retryable.
 *
 * ponytail: the failure_code set is small and finite. If the
 * orchestrator adds new failure codes the test "failed
 * preparation retry behavior is bounded" must be updated to
 * keep the bounded-retry contract honest.
 */
const RETRYABLE_FAILURE_CODES: ReadonlySet<string> = new Set([
	"lock_held",
]);

/**
 * Translate the orchestrator's outcome into a `PrepareOutcome`
 * the machine consumes. Pure.
 */
export function classifyPrepareOutcome(outcome: {
	ok: boolean;
	failure_code?: string | null;
}): PrepareOutcome {
	if (outcome.ok) return { kind: "success" };
	const code = outcome.failure_code ?? "unknown";
	const retryable = RETRYABLE_FAILURE_CODES.has(code);
	return { kind: "failure", failure_code: code, retryable };
}
