/**
 * Live session start.
 *
 * Authority: docs/LIVE_RUNTIME.md (S05), docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §11.
 *
 * This module is the S05 session_start hook surface. It is
 * PURE: the extension reads the runtime's session_start event
 * (and, when available, the model's physical context window
 * from `ctx.getContextUsage().contextWindow` after session
 * start), passes the values in, and gets a
 * `ResolvedLiveRuntime` back. The extension uses the result to
 * initialize its lightweight in-process state.
 *
 * The module does NOT inject any historical state into the
 * new session. Only S04's fresh-session rollover (via
 * `/picm-rollover-execute`) hydrates a `MinimalHandoff`. A
 * manually-started unrelated session receives nothing.
 *
 * Project identity is derived from the cwd's opaque hash. The
 * cwd is NEVER written to disk; only its hash is recorded.
 */
import { resolveConfig, } from "../core/config.js";
import { selectProfile } from "../core/profiles.js";
import { projectIdFromSeed } from "../store/ids.js";
export const LIVE_SESSION_START_HOOK_NAME = "picm-session-start";
/* -------------------------------------------------------------------- *
 * Pure function                                                         *
 * -------------------------------------------------------------------- */
/**
 * Resolve the live runtime for a session_start event. PURE.
 * Does NOT touch disk; the caller passes an already-opened
 * store (S04's `getStore()` is fine).
 */
export function resolveLiveRuntime(input, store) {
    const envMode = process.env["CMV3_MODE"];
    const configInput = {
        ...(input.configInput ?? {}),
        ...(typeof envMode === "string" && envMode.length > 0
            ? { mode: envMode }
            : {}),
    };
    const config = resolveConfig(configInput);
    const profile = typeof input.contextWindow === "number" &&
        Number.isFinite(input.contextWindow) &&
        input.contextWindow > 0
        ? selectProfile(input.contextWindow)
        : selectProfile(32768); // local_32k default
    const projectId = projectIdFromSeed(input.cwd);
    const oldSessionId = input.previousSessionFile ?? "current";
    return {
        config,
        profile,
        projectId,
        oldSessionId,
        store,
        knownContextWindow: typeof input.contextWindow === "number" &&
            Number.isFinite(input.contextWindow) &&
            input.contextWindow > 0,
    };
}
//# sourceMappingURL=session-init.js.map