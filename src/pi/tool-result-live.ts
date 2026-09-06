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

import {
	buildFailureActiveView,
	DEFAULT_ACTIVE_VIEW_POLICY,
	type ActiveViewPolicy,
	type ToolResultActiveView,
} from "../core/tool-result.js";
import type { Cmv3Store } from "../store/store.js";
import type { ToolResultPersistenceError } from "../store/tool-result-store.js";
import type { CMV3Mode } from "../core/config.js";

/* -------------------------------------------------------------------- *
 * Public types                                                          *
 * -------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------- *
 * Constants                                                             *
 * -------------------------------------------------------------------- */

/**
 * The exact name of the live hook module / function. Used by
 * the package's own diagnostic surface only.
 */
export const LIVE_TOOL_RESULT_HOOK_NAME = "picm-tool-result-live";

/* -------------------------------------------------------------------- *
 * Public function                                                       *
 * -------------------------------------------------------------------- */

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
export function virtualizeToolResult(
	input: LiveToolResultInput,
	opts: LiveToolResultOptions,
): LiveToolResultOutput {
	if (opts.mode === "legacy") {
		return {};
	}

	if (opts.mode === "v3-observe") {
		// Observation only. Do NOT persist. Do NOT replace. The
		// observation mark is metadata that future operator
		// tooling can read from the per-event `details` slot.
		return {
			details: {
				picm: {
					hook: LIVE_TOOL_RESULT_HOOK_NAME,
					mode: "v3-observe",
					tool_name: input.toolName,
					tool_call_id: input.toolCallId,
					original_bytes: textByteLength(input.content),
					observed: true,
					persisted: false,
				},
			},
		};
	}

	// v3 — full live persistence + replacement.
	const policy = opts.policy ?? DEFAULT_ACTIVE_VIEW_POLICY;
	const bytes = serializeContentToBytes(input.content);
	const result = opts.store.toolResults.write(
		bytes,
		{
			project_id: opts.projectId,
			tool_name: input.toolName,
			tool_call_id: input.toolCallId,
			session_id: opts.sessionId,
			result_kind: inferResultKind(input.content),
			success: input.isError ? false : true,
			// isError is preserved on the metadata; we also keep
			// the original `isError` value on the event-result so
			// Pi does not reclassify the tool call.
			created_at: opts.now,
			mime_type: null,
		},
		{ policy },
	);

	const originalBytes = bytes.byteLength;
	const activeView = result.active_view;
	const boundedText = renderActiveViewAsText(input, activeView, originalBytes);

	// Build the new content. Image entries from the original
	// event are preserved (so the TUI still renders them);
	// TextContent entries are replaced by the single bounded
	// text.
	const preservedImages: PiImageContent[] = [];
	for (const c of input.content) {
		if (c.type === "image") preservedImages.push(c);
	}
	const replacementContent: (PiTextContent | PiImageContent)[] = [
		{ type: "text", text: boundedText },
		...preservedImages,
	];

	return {
		content: replacementContent,
		isError: input.isError, // MUST preserve; never downgrade
		details: {
			picm: {
				hook: LIVE_TOOL_RESULT_HOOK_NAME,
				mode: "v3",
				tool_name: input.toolName,
				tool_call_id: input.toolCallId,
				original_bytes: originalBytes,
				truncated: activeView.truncated,
				ref: activeView.ref,
				persisted: true,
			},
		},
		observation: {
			original_bytes: originalBytes,
			truncated: activeView.truncated,
			ref: activeView.ref,
			persisted: true,
		},
	};
}

/**
 * Map a `ToolResultPersistenceError` to a fail-open output that
 * keeps the original event content unchanged and records a
 * bounded diagnostic.
 *
 * The diagnostic is metadata only; it does not fabricate a ref
 * and does not claim durability.
 */
export function failOpenForPersistenceError(
	input: LiveToolResultInput,
	err: ToolResultPersistenceError,
	policy: ActiveViewPolicy = DEFAULT_ACTIVE_VIEW_POLICY,
): LiveToolResultOutput {
	const bytes = serializeContentToBytes(input.content);
	const failureView = buildFailureActiveView(bytes, policy, {
		tool_name: input.toolName,
		reason: `persistence_failed:${err.stage}`,
	});
	const diag = [
		`PICM persistence failed (stage=${err.stage}); returning original tool result unchanged.`,
		`tool: ${input.toolName}`,
		`isError: ${input.isError ? "true" : "false"}`,
		`original_bytes: ${failureView.original_bytes}`,
		`non_recoverable: true`,
	].join("\n");
	return {
		// No content override; the original event content flows
		// through to the LLM unchanged. The diagnostic is
		// attached to the per-event `details` slot so it is
		// visible to operator tooling without being smuggled
		// into the agent's active context as a fake ref.
		isError: input.isError,
		details: {
			picm: {
				hook: LIVE_TOOL_RESULT_HOOK_NAME,
				mode: "v3",
				tool_name: input.toolName,
				tool_call_id: input.toolCallId,
				persisted: false,
				persistence_error: err.message,
				stage: err.stage,
				non_recoverable: true,
			},
			diagnostic: diag,
		},
	};
}

/* -------------------------------------------------------------------- *
 * Pure helpers                                                          *
 * -------------------------------------------------------------------- */

function textByteLength(
	content: readonly (PiTextContent | PiImageContent)[],
): number {
	let n = 0;
	for (const c of content) {
		if (c.type === "text") {
			n += Buffer.byteLength(c.text, "utf8");
		} else if (c.type === "image") {
			// Images do not contribute to the textual byte
			// count; the bounded view is text-only.
			n += 0;
		}
	}
	return n;
}

function serializeContentToBytes(
	content: readonly (PiTextContent | PiImageContent)[],
): Uint8Array {
	// TextContent → text joined with newlines. ImageContent is
	// represented by a stable marker so the payload round-trips
	// losslessly for the textual body; the image bytes are not
	// flattened into the tool-result payload (the active view is
	// text-only by policy).
	const parts: string[] = [];
	for (const c of content) {
		if (c.type === "text") {
			parts.push(c.text);
		} else if (c.type === "image") {
			parts.push(
				`[image:${c.mimeType ?? "unknown"}:${Buffer.byteLength(c.data, "base64")}b]`,
			);
		}
	}
	return new TextEncoder().encode(parts.join("\n"));
}

function inferResultKind(
	content: readonly (PiTextContent | PiImageContent)[],
): string {
	if (content.length === 0) return "empty";
	let hasImage = false;
	let hasText = false;
	for (const c of content) {
		if (c.type === "image") hasImage = true;
		if (c.type === "text") hasText = true;
	}
	if (hasImage && hasText) return "mixed";
	if (hasImage) return "image";
	return "text";
}

/**
 * Render the bounded active view as a single TextContent payload
 * the LLM can read. Deterministic. The exact shape is
 * documented in `docs/LIVE_RUNTIME.md`.
 */
function renderActiveViewAsText(
	input: LiveToolResultInput,
	view: ToolResultActiveView,
	originalBytes: number,
): string {
	const status = input.isError ? "error" : "success";
	const head: string[] = [
		"PICM TOOL RESULT",
		`tool: ${view.tool_name}`,
		`status: ${status}`,
		`original_bytes: ${originalBytes}`,
		`ref: ${view.ref}`,
		"",
	];
	if (view.truncated) {
		head.push(
			`[active view bounded to ${view.active_excerpt_bytes} bytes; full result recoverable via ref]`,
		);
	} else {
		head.push("[active view contains the full result]");
	}
	head.push("");
	return head.join("\n") + view.excerpt;
}
