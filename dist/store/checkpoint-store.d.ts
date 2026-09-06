/**
 * Checkpoint store.
 *
 * Responsibilities (R02 §6, §8, §10):
 *   - validate before persistence
 *   - persist schema_version
 *   - atomic authoritative write
 *   - return opaque checkpoint ref ONLY after success
 *   - deterministic latest selection
 *   - safe rejection of malformed / corrupted / wrong-schema records
 *   - no LLM
 */
import { type Checkpoint } from "../core/index.js";
import { type StoreLayout } from "./paths.js";
import type { ProjectMetadata, SessionRecord } from "./records.js";
export interface CheckpointStore {
    write(input: unknown, opts: {
        projectId: string;
        sessionId?: string;
    }): {
        ref: string;
        id: string;
        checkpoint: Checkpoint;
    };
    read(ref: string, projectId: string): Checkpoint;
    readById(projectId: string, id: string): Checkpoint;
    list(projectId: string, filters?: CheckpointListFilters): CheckpointSummary[];
    latest(projectId: string): Checkpoint | null;
    refFor(projectId: string, id: string): string;
}
export interface CheckpointListFilters {
    workPackage?: string;
    status?: Checkpoint["status"];
    since?: string;
    until?: string;
}
export interface CheckpointSummary {
    id: string;
    ref: string;
    work_package: string;
    status: Checkpoint["status"];
    created_at: string;
    session_id: string;
}
export declare class CheckpointIntegrityError extends Error {
    constructor(message: string);
}
export declare function createCheckpointStore(layout: StoreLayout): CheckpointStore;
export type { ProjectMetadata, SessionRecord };
//# sourceMappingURL=checkpoint-store.d.ts.map