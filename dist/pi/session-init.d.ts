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
import { type CMV3Config, type ResolvedCMV3Config } from "../core/config.js";
import { type ContextProfile } from "../core/profiles.js";
import type { Cmv3Store } from "../store/store.js";
export interface ResolveLiveRuntimeInput {
    readonly cwd: string;
    /**
     * The physical context window of the active model, as
     * reported by Pi's `ctx.getContextUsage().contextWindow`.
     * Optional: when omitted, the profile defaults to
     * `local_32k` (the first-class S01 profile).
     */
    readonly contextWindow?: number;
    /**
     * Optional: the previous session file, when Pi reports one
     * for the session_start event. Used as the initial
     * `oldSessionId` until rollover replaces it.
     */
    readonly previousSessionFile?: string;
    /**
     * Optional: explicit config input. When omitted, the
     * resolver falls back to env (`CMV3_MODE`).
     */
    readonly configInput?: Partial<CMV3Config>;
}
export interface ResolvedLiveRuntime {
    readonly config: ResolvedCMV3Config;
    readonly profile: ContextProfile;
    readonly projectId: string;
    readonly oldSessionId: string;
    readonly store: Cmv3Store;
    readonly knownContextWindow: boolean;
}
export declare const LIVE_SESSION_START_HOOK_NAME = "picm-session-start";
/**
 * Resolve the live runtime for a session_start event. PURE.
 * Does NOT touch disk; the caller passes an already-opened
 * store (S04's `getStore()` is fine).
 */
export declare function resolveLiveRuntime(input: ResolveLiveRuntimeInput, store: Cmv3Store): ResolvedLiveRuntime;
//# sourceMappingURL=session-init.d.ts.map