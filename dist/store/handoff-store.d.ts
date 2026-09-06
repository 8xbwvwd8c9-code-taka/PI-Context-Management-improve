/**
 * Minimal handoff store.
 *
 * Per R02 §7, a handoff is a strict projection of a checkpoint with
 * a smaller semantic scope. The handoff store:
 *   - refuses to mutate a persisted handoff in place
 *   - derives the content via the canonical projection from S01
 *   - validates the result before writing
 *   - returns an opaque cmv3://handoff/<id> ref on success
 *
 * S02 introduces the dedicated handoff ref family because:
 *   - handoffs are independently recoverable durable records, not
 *     a sub-record of a checkpoint
 *   - mixing the ref under the checkpoint family would lose the
 *     distinction and prevent separate retention / indexing
 *   - the S01 ref module already reserves the alphabet and we
 *     extend it with one new family, versioned via the R02
 *     change-control rule
 */
import { type Checkpoint, type MinimalHandoff } from "../core/index.js";
import { type StoreLayout } from "./paths.js";
export declare const HANDOFF_REF_KIND: "handoff";
export declare const HANDOFF_SCHEMA_VERSION: "1.0.0";
export interface HandoffStore {
    fromCheckpoint(checkpoint: Checkpoint, opts: {
        projectId: string;
    }): {
        ref: string;
        id: string;
        handoff: MinimalHandoff;
    };
    write(input: unknown, opts: {
        projectId: string;
    }): {
        ref: string;
        id: string;
        handoff: MinimalHandoff;
    };
    read(ref: string, projectId: string): MinimalHandoff;
    readById(projectId: string, id: string): MinimalHandoff;
    list(projectId: string, filters?: HandoffListFilters): HandoffSummary[];
    latest(projectId: string): MinimalHandoff | null;
    refFor(id: string): string;
}
export interface HandoffListFilters {
    workPackage?: string;
    status?: MinimalHandoff["status"];
}
export interface HandoffSummary {
    id: string;
    ref: string;
    work_package: string;
    status: MinimalHandoff["status"];
}
export declare class HandoffIntegrityError extends Error {
    constructor(message: string);
}
export declare function createHandoffStore(layout: StoreLayout): HandoffStore;
//# sourceMappingURL=handoff-store.d.ts.map