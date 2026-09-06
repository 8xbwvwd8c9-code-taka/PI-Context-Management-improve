/**
 * Portable core — rollover pressure observer.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZEmd §5, §6, §9.
 *
 * This module is a pure decision function that maps a
 * `ContextUsage` + `ContextProfile` + `CMV3Mode` to a structured
 * `RolloverDecision`. The decision is consumed by:
 *
 *   - the S04 Pi event handler (agent_settled)
 *   - tests that want to exercise the deterministic mapping
 *
 * The observer NEVER calls `ctx.newSession()`. The observer NEVER
 * persists any state. The observer NEVER mutates the store. The
 * observer is deterministic: same input → same output.
 *
 * Operational rules:
 *
 *   mode == legacy        → never rollover
 *   mode == v3-observe    → may report would-rollover; never executes
 *   mode == v3            → may request preparation; the command
 *                           still owns actual session replacement
 *
 *   pressure == CHECKPOINT  → checkpoint refresh only (no NEW)
 *   pressure == ROLLOVER    → may request PRESSURE rollover
 *   pressure == EMERGENCY   → may request PRESSURE rollover (best
 *                             effort; native compaction remains
 *                             the fallback)
 *   pressure <= SWEEP       → no rollover
 *
 * The PressureState comes from `classifyPressure` (S01).
 */

import { classifyPressure, type ContextUsage, type PressureState } from "./pressure.js";
import type { ContextProfile } from "./profiles.js";
import type { CMV3Mode } from "./config.js";

export type RolloverPressureAction =
	| "none"
	| "checkpoint_refresh"
	| "request_pressure_rollover"
	| "request_emergency_rollover";

export interface RolloverDecision {
	readonly mode: CMV3Mode;
	readonly pressure: PressureState;
	readonly action: RolloverPressureAction;
	readonly reason: string;
	readonly would_rollover: boolean;
	readonly would_new_session: boolean;
}

export interface RolloverObserverInput {
	readonly usage: ContextUsage;
	readonly profile: ContextProfile;
	readonly mode: CMV3Mode;
	readonly agentSettled: boolean;
}

/**
 * Pure decision: should the observer request rollover preparation?
 * Idempotent. The actual preparation is a separate call against
 * the orchestrator.
 */
export function decideRollover(input: RolloverObserverInput): RolloverDecision {
	const { usage, profile, mode, agentSettled } = input;
	const pressure = classifyPressure(usage, profile);

	if (mode === "legacy") {
		return {
			mode,
			pressure,
			action: "none",
			reason: "mode=legacy: PICM never rolls over",
			would_rollover: false,
			would_new_session: false,
		};
	}

	if (!agentSettled) {
		// The observer is only allowed to fire at a settled lifecycle
		// point. During an active turn or streaming tool execution
		// the observer returns "none" so the runtime never
		// surprises the agent.
		return {
			mode,
			pressure,
			action: "none",
			reason: "agent not settled: observer waits for settled lifecycle",
			would_rollover: false,
			would_new_session: false,
		};
	}

	if (pressure === "NORMAL" || pressure === "TARGET_EXCEEDED" || pressure === "SWEEP") {
		// Below checkpoint threshold; observer does not request rollover.
		return {
			mode,
			pressure,
			action: "none",
			reason: `pressure=${pressure}: below CHECKPOINT threshold`,
			would_rollover: false,
			would_new_session: false,
		};
	}

	if (pressure === "CHECKPOINT") {
		return {
			mode,
			pressure,
			action: "checkpoint_refresh",
			reason: "pressure=CHECKPOINT: refresh current-state checkpoint, no NEW",
			would_rollover: false,
			would_new_session: false,
		};
	}

	if (pressure === "ROLLOVER") {
		return {
			mode,
			pressure,
			action: "request_pressure_rollover",
			reason: "pressure=ROLLOVER: request PRESSURE rollover preparation",
			would_rollover: true,
			would_new_session: mode === "v3",
		};
	}

	// EMERGENCY
	if (mode === "v3-observe") {
		return {
			mode,
			pressure,
			action: "request_emergency_rollover",
			reason:
				"pressure=EMERGENCY: v3-observe reports would-rollover only; native compaction owns the actual emergency",
			would_rollover: true,
			would_new_session: false,
		};
	}
	return {
		mode,
		pressure,
		action: "request_emergency_rollover",
		reason: "pressure=EMERGENCY: best-effort PRESSURE rollover before native compaction",
		would_rollover: true,
		would_new_session: mode === "v3",
	};
}
