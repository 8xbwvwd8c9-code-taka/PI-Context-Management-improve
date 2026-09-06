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
import { type ContextUsage, type PressureState } from "./pressure.js";
import type { ContextProfile } from "./profiles.js";
import type { CMV3Mode } from "./config.js";
export type RolloverPressureAction = "none" | "checkpoint_refresh" | "request_pressure_rollover" | "request_emergency_rollover";
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
export declare function decideRollover(input: RolloverObserverInput): RolloverDecision;
//# sourceMappingURL=rollover-pressure.d.ts.map