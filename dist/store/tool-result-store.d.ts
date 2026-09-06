/**
 * Tool-result durability store.
 *
 * S03 implements the data-plane mechanics for tool-result
 * virtualization. R02 §9, §10, §15 are the binding contract.
 *
 *   full tool result
 *   → durable persistence
 *   → integrity verification / reference
 *   → bounded active representation
 *   → recover on demand
 *
 * Hard invariant: the FULL authoritative bytes are persisted FIRST.
 * A `cmv3://tool/<id>` ref is issued ONLY after:
 *
 *   1. the payload artifact is on disk (binary-safe, atomic)
 *   2. the metadata artifact is on disk (atomic, JSON with the
 *      SHA-256 of the authoritative bytes)
 *   3. the metadata integrity envelope verifies cleanly
 *
 * If any step fails, NO ref is issued, the partial directory
 * MAY be cleaned up (best-effort), and the caller receives a
 * `ToolResultPersistenceError` plus a non-recoverable active view.
 *
 * Project isolation: a ref does NOT embed the project id. The
 * caller is required to pass `projectId` at lookup time. Cross-
 * project ref lookups are rejected with `ToolResultAccessError`.
 *
 * Tool output is UNTRUSTED DATA. This store NEVER interprets the
 * payload bytes. It does not parse them, summarize them, or
 * extract commands. The bytes go through a SHA-256 hash and to
 * disk; the active view is a mechanical head/tail window.
 *
 * Generic contract: no tool-specific strings appear in paths,
 * filenames, or the active view marker. The store works for any
 * byte payload: shell output, test logs, build output, JSON,
 * binary blobs, anything.
 */
import { buildFailureActiveView, type ActiveViewPolicy, type ToolResultActiveView, type ToolResultMetadata } from "../core/tool-result.js";
import { type StoreLayout } from "./paths.js";
export interface ToolResultStore {
    /**
     * Persist a tool result. Returns the authoritative record
     * (metadata + ref) ONLY after both artifacts are on disk and
     * the integrity envelope verifies. Throws on any failure; the
     * caller MUST treat the exception as "no durable copy".
     */
    write(bytes: Uint8Array, input: ToolResultWriteInput, opts?: {
        policy?: ActiveViewPolicy;
    }): ToolResultWriteOutput;
    /**
     * Read the authoritative metadata for a tool result. The
     * payload is NOT loaded.
     */
    metadata(refOrId: string, projectId: string): ToolResultMetadata;
    /**
     * Read the full authoritative bytes for a tool result.
     * Verifies the SHA-256 over the bytes before returning.
     */
    read(refOrId: string, projectId: string): Uint8Array;
    /**
     * Read a byte-range slice of the authoritative bytes. The
     * range is [start, end) (byte offsets, 0-based). The bytes
     * are read from disk and the SHA-256 is verified against the
     * metadata; the slice is then carved out of the verified
     * bytes. The slice itself is NOT separately hashed.
     *
     * Range checks (negative start, end > length, start >= length,
     * end < start) throw `RangeError` synchronously before any
     * I/O.
     */
    readRange(refOrId: string, projectId: string, start: number, end: number): Uint8Array;
    /**
     * Build the bounded active view for a tool result. The full
     * bytes are NOT loaded; the view is constructed from the
     * metadata's stored count + the recorded head/tail window
     * alone when the payload is not in memory. When the caller
     * already has the bytes (e.g. right after a write), use
     * `buildActiveViewForBytes`.
     */
    buildActiveView(refOrId: string, projectId: string, policy: ActiveViewPolicy): ToolResultActiveView;
    /**
     * Build the bounded active view directly from in-memory bytes
     * (no I/O). Used right after a successful write.
     */
    buildActiveViewForBytes(bytes: Uint8Array, metadata: ToolResultMetadata, policy: ActiveViewPolicy): ToolResultActiveView;
    /**
     * Build the failure-mode active view (no ref, non_recoverable).
     * Used by callers when persistence fails; the view does NOT
     * claim durability and does NOT fabricate a cmv3://tool ref.
     */
    buildFailureView(bytes: Uint8Array, toolName: string, reason: string, policy?: ActiveViewPolicy): ReturnType<typeof buildFailureActiveView>;
    /**
     * List tool results for a project, optionally filtered.
     */
    list(projectId: string, filters?: ToolResultListFilters): ToolResultSummary[];
    /**
     * Build the canonical ref for an id (caller-side).
     */
    refFor(id: string): string;
}
export interface ToolResultWriteInput {
    project_id: string;
    tool_name: string;
    session_id?: string | null;
    tool_call_id?: string | null;
    result_kind?: string;
    exit_code?: number | null;
    success?: boolean | null;
    mime_type?: string | null;
    created_at?: string;
}
export interface ToolResultWriteOutput {
    ref: string;
    id: string;
    metadata: ToolResultMetadata;
    active_view: ToolResultActiveView;
}
export interface ToolResultListFilters {
    toolName?: string;
    sessionId?: string;
    since?: string;
    until?: string;
    truncatedOnly?: boolean;
}
export interface ToolResultSummary {
    id: string;
    ref: string;
    tool_name: string;
    session_id: string | null;
    created_at: string;
    original_bytes: number;
    stored_bytes: number;
    truncated_in_active_view: boolean;
    content_hash: string;
    mime_type: string | null;
}
/**
 * Thrown by the store when persistence fails. Callers MUST treat
 * this as "no durable copy, no valid ref".
 */
export declare class ToolResultPersistenceError extends Error {
    readonly stage: "payload" | "metadata" | "finalize" | "unknown";
    readonly cause?: unknown | undefined;
    constructor(message: string, stage: "payload" | "metadata" | "finalize" | "unknown", cause?: unknown | undefined);
}
/**
 * Thrown when a ref cannot be resolved, or when the lookup is
 * for the wrong project. The store does NOT silently return a
 * different project's record.
 */
export declare class ToolResultAccessError extends Error {
    constructor(message: string);
}
export declare function createToolResultStore(layout: StoreLayout): ToolResultStore;
/**
 * Re-scan the authoritative tool-result directories and rebuild
 * the derived index. The index is metadata only; the payloads
 * are never re-read for the index. Returns the number of entries
 * rebuilt.
 */
export declare function rebuildToolResultIndex(layout: StoreLayout, projectId: string): number;
//# sourceMappingURL=tool-result-store.d.ts.map