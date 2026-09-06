/**
 * Append-only JSONL index for the CMV3 store.
 *
 * Per R02 §10 / S02:
 *   - the index is derived data
 *   - the authoritative records (the .json files) are the source
 *     of truth
 *   - the index is rebuildable from the authoritative files
 *
 * A failure to append to the index does NOT delete the
 * authoritative record. On the next read the index is rebuilt
 * if it is missing / corrupted.
 */
import { type StoreLayout } from "./paths.js";
export interface IndexEntry {
    ref: string;
    id: string;
}
export declare function appendIndexEntry<T extends IndexEntry>(layout: StoreLayout, projectId: string, kind: "checkpoints" | "handoffs" | "sessions" | "tool-results" | "rollovers", entry: T): void;
export declare function readIndex<T extends IndexEntry>(layout: StoreLayout, projectId: string, kind: "checkpoints" | "handoffs" | "sessions" | "tool-results" | "rollovers"): T[];
export declare function rebuildIndex<T extends IndexEntry>(layout: StoreLayout, projectId: string, kind: "checkpoints" | "handoffs" | "sessions" | "tool-results" | "rollovers", entries: T[]): void;
export declare function clearIndex(layout: StoreLayout, projectId: string, kind: "checkpoints" | "handoffs" | "sessions" | "tool-results" | "rollovers"): void;
//# sourceMappingURL=index-table.d.ts.map