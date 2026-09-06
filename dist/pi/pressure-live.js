/**
 * Live pressure integration.
 *
 * Authority: docs/LIVE_RUNTIME.md (S05), docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §5.
 *
 * This module maps the Pi runtime's `ctx.getContextUsage()`
 * value into PICM's deterministic pressure pipeline. The
 * integration is PURE: the extension reads the live usage on
 * the `agent_settled` event, passes the values in, and gets
 * a `RolloverDecision` back. The decision is consumed by the
 * existing S04 `decideRollover()` (or by a thin re-wrapping
 * call here for documentation completeness).
 *
 * Important: the live context window reported by Pi is the
 * physical cap of the active model. The local_32k profile is
 * first-class; we DO NOT hardcode 32K. If the model reports a
 * different physical cap, the profile is selected from that
 * cap (cap-driven selection per `selectProfile`).
 *
 * If `tokens` is `null` (Pi may report null right after
 * compaction), the integration is a no-op. PICM never guesses.
 */
import { classifyPressure, } from "../core/pressure.js";
import { selectProfile } from "../core/profiles.js";
import { decideRollover, } from "../core/rollover-pressure.js";
/* -------------------------------------------------------------------- *
 * Pure function                                                         *
 * -------------------------------------------------------------------- */
export const LIVE_PRESSURE_HOOK_NAME = "picm-pressure-live";
/**
 * Compute the live pressure decision for one `agent_settled`
 * event. The function is PURE: same input → same output. The
 * extension reads `ctx.getContextUsage()` and calls this.
 *
 * Returns `known=false` when Pi reports `tokens=null`. In that
 * case the decision is `action="none"` and the profile is still
 * selected from the physical cap so the rest of the pipeline
 * stays consistent.
 */
export function computeLivePressure(input) {
    const profile = input.profileOverride ?? selectProfile(input.live.contextWindow);
    if (input.live.tokens === null) {
        const decision = {
            mode: input.mode,
            pressure: "NORMAL",
            action: "none",
            reason: "live_tokens=null: PICM does not guess",
            would_rollover: false,
            would_new_session: false,
        };
        return {
            decision,
            profile,
            pressure: "NORMAL",
            used: { tokens: 0 },
            known: false,
        };
    }
    const usage = { tokens: input.live.tokens };
    const pressure = classifyPressure(usage, profile);
    const decision = decideRollover({
        usage,
        profile,
        mode: input.mode,
        agentSettled: input.agentSettled,
    });
    return {
        decision,
        profile,
        pressure,
        used: usage,
        known: true,
    };
}
//# sourceMappingURL=pressure-live.js.map