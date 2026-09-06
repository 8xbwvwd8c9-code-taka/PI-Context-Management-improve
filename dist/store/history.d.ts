/**
 * History query API.
 *
 * Per S02 spec:
 *   - list / get / find by project, type, work_package, status, time
 *   - exact ref resolution
 *   - deterministic ordering
 *   - no semantic / vector search
 *   - bounded, deterministic
 *
 * S03 extends the History with `kind=tool` support. Tool-result
 * entries are added to the index as METADATA ONLY — the raw
 * payload never enters the derived JSONL index. The payload is
 * always recovered from the authoritative artifact directory.
 *
 * The history module is a thin layer over the per-record stores.
 * It does NOT restore arbitrary records into active context; the
 * caller selects explicitly.
 */
import { type CheckpointStore } from "./checkpoint-store.js";
import { type HandoffStore } from "./handoff-store.js";
import { type SessionStore } from "./session-store.js";
import { type ToolResultStore } from "./tool-result-store.js";
import { type StoreLayout } from "./paths.js";
export type RecordKind = "checkpoint" | "handoff" | "session" | "tool";
export interface HistoryQuery {
    projectId: string;
    kinds?: RecordKind[];
    workPackage?: string;
    status?: string;
    since?: string;
    until?: string;
    toolName?: string;
    sessionId?: string;
    truncatedOnly?: boolean;
}
export interface HistoryEntry {
    kind: RecordKind;
    id: string;
    ref: string;
    work_package?: string;
    status?: string;
    created_at?: string;
    started_at?: string;
    tool_name?: string;
    session_id?: string;
    original_bytes?: number;
    stored_bytes?: number;
    truncated_in_active_view?: boolean;
    content_hash?: string;
    mime_type?: string | null;
}
export declare class History {
    private readonly stores;
    constructor(_layout: StoreLayout, stores: {
        checkpoints: CheckpointStore;
        handoffs: HandoffStore;
        sessions: SessionStore;
        toolResults?: ToolResultStore;
    });
    list(q: HistoryQuery): HistoryEntry[];
    get(ref: string): HistoryEntry | null;
    /**
     * Find by ref. Returns the parsed record (caller-side) by
     * dispatching to the typed store. The projectId is required
     * for ref -> record resolution because refs do not embed the
     * project id (R02 §8: opaque + no payload in id).
     */
    find(ref: string, projectId: string): HistoryEntry | null;
}
//# sourceMappingURL=history.d.ts.map