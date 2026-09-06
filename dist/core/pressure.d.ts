/**
 * Portable core — pressure states + deterministic classifier.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §5.
 *
 * Pure classification. No LLM call. Boundary semantics are explicit.
 */
import type { ContextProfile } from "./profiles.js";
/**
 * Frozen semantic states, in order of escalation. R02 §5.
 */
export type PressureState = "NORMAL" | "TARGET_EXCEEDED" | "SWEEP" | "CHECKPOINT" | "ROLLOVER" | "EMERGENCY";
export declare const PRESSURE_STATES: readonly PressureState[];
/**
 * Usage input. Per R02 §5, only aggregate `tokens` is required.
 * Per-category breakdown is `NOT_AVAILABLE` in Pi and is intentionally
 * not modeled.
 */
export interface ContextUsage {
    readonly tokens: number;
}
/**
 * Classify context pressure. Deterministic, side-effect free.
 *
 * Boundary semantics (R02 §5):
 *   usage <  target              → NORMAL
 *   target <= usage < sweep      → TARGET_EXCEEDED
 *   sweep <= usage < checkpoint  → SWEEP
 *   checkpoint <= usage < rollover → CHECKPOINT
 *   rollover <= usage < emergency → ROLLOVER
 *   usage >= emergency           → EMERGENCY
 *
 * `usage >= max_context` is also EMERGENCY (defensive cap check).
 */
export declare function classifyPressure(usage: ContextUsage, profile: ContextProfile): PressureState;
/**
 * Operational budget remaining before `target`. Negative when target
 * has been exceeded. Pure function; no side effects.
 */
export declare function headroomToTarget(usage: ContextUsage, profile: ContextProfile): number;
/**
 * Operational budget remaining before `emergency`. Negative when
 * emergency has been reached.
 */
export declare function headroomToEmergency(usage: ContextUsage, profile: ContextProfile): number;
//# sourceMappingURL=pressure.d.ts.map