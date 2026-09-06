/**
 * Pi runtime extension — S05 live runtime integration.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §9, §10.
 *            docs/LIVE_RUNTIME.md (S05).
 *
 * S05 contract (additive over S04):
 *   - registers one live `tool_result` hook (v3 mode only;
 *     legacy / v3-observe are pass-through or observe-only)
 *   - persists full authoritative tool result before replacing
 *     active content (PERSIST BEFORE REPLACE)
 *   - returns the bounded active view to the LLM; full result
 *     remains recoverable via the `cmv3://tool/<id>` ref
 *   - registers one agent-callable recovery tool
 *     (`picm_recover`); the tool accepts the opaque ref and
 *     bounded range args; it refuses arbitrary filesystem paths
 *   - on `agent_settled`, computes pressure from the live
 *     `ctx.getContextUsage()` (cap-driven profile selection;
 *     does NOT hardcode 32K)
 *   - never calls `ctx.newSession()` from the tool_result hook
 *     or the recovery tool; only the S04 command does
 *   - never calls the native compact entrypoint on the runtime
 *     context; never modifies native Pi compaction
 *   - never captures a stale `pi` or command `ctx` after
 *     `await ctx.newSession()`; post-replacement work is done
 *     through `withSession(freshCtx)` and the fresh context only
 *
 * The extension is the only S05 surface. S04's surface is
 * preserved bit-for-bit:
 *   - one `picm_prepare_rollover` tool
 *   - one `/picm-rollover-execute` command
 *   - one `session_start` event observer
 *   - one `agent_settled` event observer
 *   - one `tool_result` event observer (NEW in S05)
 *   - one `picm_recover` tool (NEW in S05)
 *
 * `package:check` and the S04 acceptance matrix in
 * `tests/rollover.test.ts` must remain green.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RECOVERY_TOOL_NAME } from "./recovery-tool.js";
import { type LiveToolResultInput } from "./tool-result-live.js";
/** Package identity. Mirrored from package.json for runtime introspection. */
export declare const PACKAGE_NAME = "pi-context-management-improve";
export declare const PACKAGE_VERSION = "1.0.1";
export declare const PACKAGE_PHASE = "P02-CROSS-PROJECT-PORTABILITY-V1";
/**
 * The slash command that owns the `ctx.newSession` call. The
 * command receives only an opaque rollover request id; the rest
 * of the rollover state is loaded from the durable store by the
 * orchestrator.
 */
export declare const ROLLOVER_COMMAND_NAME = "picm-rollover-execute";
/**
 * The custom tool that prepares a rollover. The tool is callable
 * by the LLM; the tool NEVER calls `ctx.newSession()`. It only
 * persists state and returns the opaque request id.
 */
export declare const ROLLOVER_TOOL_NAME = "picm_prepare_rollover";
/**
 * The custom tool that recovers a tool result. The tool is
 * callable by the LLM; the tool NEVER calls newSession, the
 * native compact entrypoint, or any other session-mutating API.
 * The tool accepts ONLY a `cmv3://tool/<id>` ref (or bare id)
 * and bounded range args; it refuses arbitrary paths.
 */
export { RECOVERY_TOOL_NAME };
/**
 * Default export. Wired as a Pi extension entrypoint per
 * `pi.extensions` in package.json.
 */
export default function cmv3Extension(pi: ExtensionAPI): void;
export { RECOVERY_TOOL_NAME as PICM_RECOVER_TOOL_NAME } from "./recovery-tool.js";
export { LIVE_TOOL_RESULT_HOOK_NAME } from "./tool-result-live.js";
export type { ContextProfile } from "../core/profiles.js";
export type { ResolvedCMV3Config } from "../core/config.js";
export type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
export { PICM_PRESSURE_CUSTOM_TYPE, FIXED_TRUSTED_PICM_DIRECTIVE, PRESSURE_ROLLOVER_OPTIONS, PRESSURE_DIRECTIVE_DENY_SUBSTRINGS, PressureTriggerMachine, buildPressureRolloverMessage, buildPressureRolloverCall, shouldTriggerPressureRollover, classifyPrepareOutcome, } from "./pressure-trigger.js";
export type { PressureRolloverDetails, PressureRolloverMessage, PressureRolloverOptions, PressureRolloverCall, ShouldTriggerInput, ShouldTriggerOutput, PressureTriggerState, PrepareOutcome, } from "./pressure-trigger.js";
/**
 * Local structural type matching the runtime's
 * `PicmToolResultEventResult` interface. The public
 * `@earendil-works/pi-coding-agent` API does NOT re-export
 * `PicmToolResultEventResult` (it lives in the private `pi-ai`
 * peer). The shape is small and well-known: we declare it
 * here so the extension code is fully typed without
 * importing private modules. We use the public
 * `AgentToolResult<unknown>` shape so the type aligns with
 * what `registerTool(...).execute` actually returns.
 */
export type PicmToolResultEventResult = {
    content?: LiveToolResultInput["content"][number][];
    details?: unknown;
    isError?: boolean;
};
//# sourceMappingURL=extension.d.ts.map