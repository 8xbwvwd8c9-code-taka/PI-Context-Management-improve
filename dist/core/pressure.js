/**
 * Portable core — pressure states + deterministic classifier.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §5.
 *
 * Pure classification. No LLM call. Boundary semantics are explicit.
 */
export const PRESSURE_STATES = Object.freeze([
    "NORMAL",
    "TARGET_EXCEEDED",
    "SWEEP",
    "CHECKPOINT",
    "ROLLOVER",
    "EMERGENCY",
]);
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
export function classifyPressure(usage, profile) {
    if (!Number.isFinite(usage.tokens) || usage.tokens < 0) {
        throw new Error(`classifyPressure: tokens must be a finite number >= 0 (got ${usage.tokens})`);
    }
    if (usage.tokens >= profile.max_context) {
        return "EMERGENCY";
    }
    if (usage.tokens >= profile.emergency) {
        return "EMERGENCY";
    }
    if (usage.tokens >= profile.rollover) {
        return "ROLLOVER";
    }
    if (usage.tokens >= profile.checkpoint) {
        return "CHECKPOINT";
    }
    if (usage.tokens >= profile.sweep) {
        return "SWEEP";
    }
    if (usage.tokens >= profile.target) {
        return "TARGET_EXCEEDED";
    }
    return "NORMAL";
}
/**
 * Operational budget remaining before `target`. Negative when target
 * has been exceeded. Pure function; no side effects.
 */
export function headroomToTarget(usage, profile) {
    return profile.target - usage.tokens;
}
/**
 * Operational budget remaining before `emergency`. Negative when
 * emergency has been reached.
 */
export function headroomToEmergency(usage, profile) {
    return profile.emergency - usage.tokens;
}
//# sourceMappingURL=pressure.js.map