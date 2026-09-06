/**
 * Portable core — hydration text + payload discriminator.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §7, §10.
 *
 * The new session receives ONLY a deterministic hydration text
 * derived from the MinimalHandoff. The text is trusted PICM
 * continuation state. It MUST NOT contain:
 *
 *   - the full Checkpoint
 *   - the old transcript
 *   - raw ToolResult payload
 *   - old file contents
 *   - old test output
 *   - raw historical diagnostics
 *
 * Errors / tool evidence appear ONLY as `recovery_refs`. The new
 * session can `picm_recover <ref>` to load a ref on demand.
 *
 * This module is pure: it takes a validated MinimalHandoff and
 * returns a deterministic text + a `recovery_refs` array. It
 * never imports Pi, never imports the store, never reads files.
 */
import type { MinimalHandoff } from "./handoff.js";
import type { HistoryRef } from "./checkpoint.js";
export interface HydrationPayload {
    readonly text: string;
    readonly recovery_refs: readonly HistoryRef[];
}
/**
 * Build a hydration text from a MinimalHandoff. The structure is
 * stable; the order of fields is fixed. The text begins with a
 * marker that the new session can grep for to confirm it received
 * the structured continuation rather than a transcript.
 */
export declare function buildHydrationPayload(handoff: MinimalHandoff): HydrationPayload;
/**
 * Detect a payload that contains raw transcript-like text. The
 * orchestrator uses this to reject hand-crafted handoffs that
 * try to smuggle a transcript into the hydration. The check is
 * heuristic: it scans for the typical Pi system-prompt / user
 * turn markers.
 */
export declare function looksLikeTranscriptPayload(text: string): boolean;
//# sourceMappingURL=hydration.d.ts.map