/**
 * Live recovery tool — `picm_recover`.
 *
 * Authority: docs/LIVE_RUNTIME.md (S05), docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §8, §9, §10.
 *
 * This module is the agent-callable recovery surface. The LLM
 * invokes the tool to load a specific tool-result by its opaque
 * `cmv3://tool/<id>` ref. The tool accepts:
 *
 *   - the ref (REQUIRED; opaque id only; no arbitrary path)
 *   - an optional byte range [start, end)
 *   - an optional `full` flag (subject to a safe default cap)
 *
 * The tool refuses:
 *
 *   - any input that is not a syntactically valid `cmv3://tool/<id>`
 *     ref or bare id matching the ref id alphabet
 *   - any input that is a filesystem path
 *   - any read for a project that does not own the ref
 *   - any "full" read beyond the safe default cap (the cap is
 *     intended to keep the recovery surface itself from
 *     re-introducing a multi-MB result into active context)
 *
 * The output is one bounded text payload. Image entries are NOT
 * produced by this tool — the tool returns text only.
 *
 * The tool is PURE: given inputs and the store, it returns the
 * bounded output. The extension wires it as `picm_recover` in
 * the `registerTool` call.
 */
import { validateActiveViewPolicy, } from "../core/tool-result.js";
import { parseRef } from "../core/refs.js";
import { ToolResultAccessError, } from "../store/tool-result-store.js";
/* -------------------------------------------------------------------- *
 * Public types                                                          *
 * -------------------------------------------------------------------- */
export const RECOVERY_TOOL_NAME = "picm_recover";
/**
 * Default active-output cap for the recovery tool. The cap is
 * independent of the tool-result store's `DEFAULT_ACTIVE_VIEW_POLICY`
 * — the recovery tool returns a slice of the authoritative
 * payload, NOT a bounded active view. The cap is a defense
 * against a caller asking for a giant full read.
 */
export const DEFAULT_RECOVERY_MAX_BYTES = 64 * 1024; // 64 KiB
export const MAX_RECOVERY_RANGE_BYTES = 1024 * 1024; // 1 MiB hard ceiling
/**
 * Execute the recovery tool. Pure with respect to the store.
 *
 * Throws `ToolResultAccessError` for any access problem (bad
 * ref, wrong project, missing record). The extension should
 * catch and return a textual error to the LLM.
 */
export function executePicmRecover(args, opts) {
    const input = normalizeInput(args);
    // Step 1: parse the ref. We only accept a cmv3://tool/<id> ref
    // or the bare id. No arbitrary paths.
    const refStr = input.ref;
    if (typeof refStr !== "string" || refStr.length === 0) {
        throw new ToolResultAccessError("picm_recover: ref is required");
    }
    const parsed = parseRef(refStr);
    if (parsed === null) {
        // Also accept a bare id (the same id alphabet).
        if (!/^[a-z0-9_-]{8,128}$/.test(refStr)) {
            throw new ToolResultAccessError(`picm_recover: ref must be a cmv3://tool/<id> URI or a bare opaque id (got ${JSON.stringify(refStr)})`);
        }
    }
    const canonicalRef = parsed === null ? `cmv3://tool/${refStr}` : parsed.uri;
    // Step 2: read metadata (this is the project-isolation check —
    // a wrong projectId throws here, not on the payload read).
    const meta = opts.store.toolResults.metadata(canonicalRef, opts.projectId);
    // Step 3: compute the slice. The recovery tool itself is
    // subject to a bounded active output. A `full` read is
    // bounded by the per-call cap. A range read is bounded by
    // MAX_RECOVERY_RANGE_BYTES.
    const range = computeRange(input, meta.original_bytes);
    // Step 4: read the slice from the store. The store verifies
    // the SHA-256 over the full payload before returning; the
    // slice is carved out of the verified bytes.
    let bytes;
    try {
        bytes = opts.store.toolResults.readRange(canonicalRef, opts.projectId, range.start, range.end);
    }
    catch (err) {
        if (err instanceof ToolResultAccessError)
            throw err;
        throw new ToolResultAccessError(`picm_recover: read failed (${err.message})`);
    }
    // Step 5: wrap as text. The recovery tool always returns
    // text; binary payloads are lossy-decoded into a safe
    // printable summary.
    const text = renderBytesAsText(bytes, meta.original_bytes, range, input.full === true);
    return {
        content: { type: "text", text },
        details: {
            picm: {
                ref: canonicalRef,
                project_id: opts.projectId,
                tool_name: meta.tool_name,
                original_bytes: meta.original_bytes,
                returned_bytes: bytes.byteLength,
                truncated: bytes.byteLength < meta.original_bytes,
                range: input.full === true ? null : { start: range.start, end: range.end },
                bounded_by_cap: range.bounded_by_cap,
            },
        },
    };
}
/* -------------------------------------------------------------------- *
 * Pure helpers                                                          *
 * -------------------------------------------------------------------- */
function normalizeInput(args) {
    if (args === null || typeof args !== "object") {
        throw new ToolResultAccessError("picm_recover: args must be an object");
    }
    const a = args;
    const out = {
        ref: typeof a["ref"] === "string" ? a["ref"] : "",
    };
    if (a["start"] !== undefined) {
        const s = a["start"];
        if (typeof s !== "number" || !Number.isInteger(s) || s < 0) {
            throw new ToolResultAccessError(`picm_recover: start must be a non-negative integer (got ${JSON.stringify(s)})`);
        }
        out.start = s;
    }
    if (a["end"] !== undefined) {
        const e = a["end"];
        if (typeof e !== "number" || !Number.isInteger(e) || e < 0) {
            throw new ToolResultAccessError(`picm_recover: end must be a non-negative integer (got ${JSON.stringify(e)})`);
        }
        out.end = e;
    }
    if (a["full"] !== undefined) {
        const f = a["full"];
        if (typeof f !== "boolean") {
            throw new ToolResultAccessError(`picm_recover: full must be a boolean (got ${JSON.stringify(f)})`);
        }
        out.full = f;
    }
    if (a["max_bytes"] !== undefined) {
        const m = a["max_bytes"];
        if (typeof m !== "number" || !Number.isInteger(m) || m <= 0) {
            throw new ToolResultAccessError(`picm_recover: max_bytes must be a positive integer (got ${JSON.stringify(m)})`);
        }
        // Hard ceiling — the recovery tool cannot be made to
        // return more than 1 MiB even if the caller asks.
        out.max_bytes = Math.min(m, MAX_RECOVERY_RANGE_BYTES);
    }
    return out;
}
function computeRange(input, originalBytes) {
    if (input.full === true) {
        const cap = input.max_bytes ?? DEFAULT_RECOVERY_MAX_BYTES;
        const end = Math.min(originalBytes, cap);
        return { start: 0, end, bounded_by_cap: end === cap && cap < originalBytes };
    }
    const start = input.start ?? 0;
    const end = input.end ??
        Math.min(originalBytes, input.max_bytes ?? DEFAULT_RECOVERY_MAX_BYTES);
    if (start > originalBytes) {
        throw new RangeError(`picm_recover: start (${start}) escapes artifact length (${originalBytes})`);
    }
    if (end > originalBytes) {
        throw new RangeError(`picm_recover: end (${end}) escapes artifact length (${originalBytes})`);
    }
    if (end < start) {
        throw new RangeError(`picm_recover: end (${end}) must be >= start (${start})`);
    }
    return { start, end, bounded_by_cap: false };
}
function renderBytesAsText(bytes, originalBytes, range, full) {
    // Try UTF-8 decode first.
    const decoded = tryDecodeUtf8(bytes);
    const head = [
        "PICM TOOL RESULT (recovered)",
        `original_bytes: ${originalBytes}`,
        `returned_bytes: ${bytes.byteLength}`,
    ];
    if (full) {
        head.push(`mode: full (bounded by recovery cap)`);
    }
    else {
        head.push(`range: [${range.start}, ${range.end})`);
    }
    if (range.bounded_by_cap) {
        head.push(`(end was clamped by the recovery cap; pass a range for more)`);
    }
    head.push("");
    const body = decoded === null ? lossyPrintable(bytes) : decoded;
    return head.join("\n") + body;
}
function tryDecodeUtf8(bytes) {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        return null;
    }
}
function lossyPrintable(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i];
        if (c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0x7e)) {
            out += String.fromCharCode(c);
        }
        else {
            out += ".";
        }
    }
    return out;
}
// validateActiveViewPolicy is re-exported for callers that want
// to construct a strict policy.
export { validateActiveViewPolicy };
//# sourceMappingURL=recovery-tool.js.map