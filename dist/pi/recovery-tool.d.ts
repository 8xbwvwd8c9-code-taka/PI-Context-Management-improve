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
import { validateActiveViewPolicy, type ActiveViewPolicy } from "../core/tool-result.js";
import type { Cmv3Store } from "../store/store.js";
import { type ToolResultPersistenceError } from "../store/tool-result-store.js";
import type { PiTextContent } from "./tool-result-live.js";
export declare const RECOVERY_TOOL_NAME = "picm_recover";
/**
 * Default active-output cap for the recovery tool. The cap is
 * independent of the tool-result store's `DEFAULT_ACTIVE_VIEW_POLICY`
 * — the recovery tool returns a slice of the authoritative
 * payload, NOT a bounded active view. The cap is a defense
 * against a caller asking for a giant full read.
 */
export declare const DEFAULT_RECOVERY_MAX_BYTES: number;
export declare const MAX_RECOVERY_RANGE_BYTES: number;
export interface RecoveryToolInput {
    /** Opaque PICM ref or bare id. REQUIRED. */
    readonly ref: string;
    /** Optional 0-based start byte. Negative is rejected. */
    readonly start?: number;
    /** Optional 0-based exclusive end byte. Negative is rejected. */
    readonly end?: number;
    /**
     * Optional: return up to DEFAULT_RECOVERY_MAX_BYTES from the
     * start of the payload, ignoring start/end. Useful when the
     * caller just wants "the head of the result". Bounded by the
     * same default cap regardless of the underlying size.
     */
    readonly full?: boolean;
    /** Optional override of the default recovery cap. */
    readonly max_bytes?: number;
    /** Wall-clock now (ISO-8601) for deterministic tests. */
    readonly now?: string;
}
export interface RecoveryToolOutput {
    readonly content: PiTextContent;
    readonly details: {
        readonly picm: {
            readonly ref: string;
            readonly project_id: string;
            readonly tool_name: string;
            readonly original_bytes: number;
            readonly returned_bytes: number;
            readonly truncated: boolean;
            readonly range: {
                start: number;
                end: number;
            } | null;
            readonly bounded_by_cap: boolean;
        };
    };
}
export interface ExecuteRecoveryOptions {
    readonly projectId: string;
    readonly store: Cmv3Store;
    readonly policy?: ActiveViewPolicy;
    readonly now?: string;
}
/**
 * Execute the recovery tool. Pure with respect to the store.
 *
 * Throws `ToolResultAccessError` for any access problem (bad
 * ref, wrong project, missing record). The extension should
 * catch and return a textual error to the LLM.
 */
export declare function executePicmRecover(args: unknown, opts: ExecuteRecoveryOptions): RecoveryToolOutput;
export { validateActiveViewPolicy };
export type { ToolResultPersistenceError };
//# sourceMappingURL=recovery-tool.d.ts.map