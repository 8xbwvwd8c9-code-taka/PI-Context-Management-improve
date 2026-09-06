/**
 * Live tool-result virtualization.
 *
 * Authority: docs/LIVE_RUNTIME.md (S05), docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §9, §10.
 *
 * This module is the S05 live hook for the `tool_result` event. It
 * is the bridge between the S03 data plane and the S04 Pi
 * runtime. It is PURE: it takes an event, a project id, a
 * session id, the store, and a policy; it returns the
 * `ToolResultEventResult` that the runtime should use.
 *
 * Hard contract:
 *
 *   1. PERSIST BEFORE REPLACE. The full authoritative bytes are
 *      written to disk first. The ref is issued only after the
 *      metadata + payload integrity envelope verifies. If
 *      persistence fails, the original event content is returned
 *      UNCHANGED (fail-open for context delivery, fail-closed for
 *      recoverability claims).
 *
 *   2. Tool output is untrusted data. PICM does not interpret
 *      payload bytes. The store hashes and persists them
 *      mechanically. The active view is a head/tail window.
 *      Nothing in the payload becomes PICM control flow.
 *
 *   3. isError must be preserved. The virtualization MUST NOT
 *      turn an `isError=true` event into a success. The
 *      ToolResultEventResult may override `content` (the bounded
 *      active view) but MUST NOT override `isError` from `true`
 *      to `false`.
 *
 *   4. The active view is a single TextContent replacement that
 *      describes the virtualized result, carrying the recovery
 *      ref and a bounded excerpt. Image content in the original
 *      event is preserved in the returned `content` array so
 *      the user-facing TUI still sees images.
 *
 *   5. The mode gate is checked here. In `legacy` mode, the
 *      event is returned as-is (no content replacement). In
 *      `v3-observe` mode, the bytes are NOT persisted; the event
 *      is returned with a single diagnostic TextContent
 *      appended (so the agent can see observation occurred but
 *      no active-context replacement happens). In `v3` mode,
 *      full persistence + replacement happens.
 *
 *  The live hook never calls `ctx.newSession`, `ctx.compact`,
 *  or any other runtime-mutating API.
 */
/**
 * Public structural types for `tool_result` event content.
 *
 * `pi-coding-agent` re-exports its public ExtensionAPI surface
 * but does NOT re-export `TextContent` / `ImageContent` (those
 * live in the private `pi-ai` peer). To keep the portable
 * contract — "use public APIs of @earendil-works/pi-coding-agent"
 * — and to avoid reaching into private modules, we declare the
 * shape locally. The structural shape is the same shape the
 * runtime emits, so the tool_result handler typechecks cleanly
 * against `event.content` and the runtime accepts the same
 * shape back in the result.
 */
export interface PiTextContent {
    readonly type: "text";
    readonly text: string;
}
export interface PiImageContent {
    readonly type: "image";
    readonly data: string;
    readonly mimeType: string;
}
export type PiToolResultContent = PiTextContent | PiImageContent;
import { type ActiveViewPolicy } from "../core/tool-result.js";
import type { Cmv3Store } from "../store/store.js";
import type { ToolResultPersistenceError } from "../store/tool-result-store.js";
import type { CMV3Mode } from "../core/config.js";
/**
 * Minimal slice of the Pi `tool_result` event the hook depends
 * on. The extension maps the real event to this shape so the
 * function is testable in isolation.
 */
export interface LiveToolResultInput {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly content: readonly (PiTextContent | PiImageContent)[];
    readonly isError: boolean;
    readonly sessionId: string | null;
}
/**
 * Result shape mirroring `ToolResultEventResult` from the Pi
 * runtime. The extension forwards this directly to Pi. When
 * `content` is `undefined`, the runtime keeps the original
 * content. When `content` is an array, the runtime uses it as
 * the replacement.
 */
export interface LiveToolResultOutput {
    content?: (PiTextContent | PiImageContent)[];
    isError?: boolean;
    details?: Record<string, unknown>;
    observation?: {
        readonly original_bytes: number;
        readonly truncated: boolean;
        readonly ref: string;
        readonly persisted: boolean;
    };
}
/**
 * Per-call options.
 */
export interface LiveToolResultOptions {
    readonly projectId: string;
    readonly sessionId: string | null;
    readonly mode: CMV3Mode;
    readonly store: Cmv3Store;
    readonly policy?: ActiveViewPolicy;
    /** Wall-clock now (ISO-8601) for deterministic tests. */
    readonly now?: string;
}
/**
 * The exact name of the live hook module / function. Used by
 * the package's own diagnostic surface only.
 */
export declare const LIVE_TOOL_RESULT_HOOK_NAME = "picm-tool-result-live";
/**
 * Live virtualization for one `tool_result` event.
 *
 *   - `legacy`     → return `{}` (no content replacement)
 *   - `v3-observe` → return an observation-only diagnostic
 *                    (no persistence, no replacement)
 *   - `v3`         → persist full authoritative bytes, then
 *                    replace content with the bounded active
 *                    view; on persistence failure, fall back to
 *                    the original content (no fake ref)
 */
export declare function virtualizeToolResult(input: LiveToolResultInput, opts: LiveToolResultOptions): LiveToolResultOutput;
/**
 * Map a `ToolResultPersistenceError` to a fail-open output that
 * keeps the original event content unchanged and records a
 * bounded diagnostic.
 *
 * The diagnostic is metadata only; it does not fabricate a ref
 * and does not claim durability.
 */
export declare function failOpenForPersistenceError(input: LiveToolResultInput, err: ToolResultPersistenceError, policy?: ActiveViewPolicy): LiveToolResultOutput;
//# sourceMappingURL=tool-result-live.d.ts.map