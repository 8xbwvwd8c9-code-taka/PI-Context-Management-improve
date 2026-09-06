/**
 * Recovery helpers.
 *
 * `recoverLatestProjectState(projectId)` returns, in one call:
 *   - project metadata (if any)
 *   - latest valid checkpoint (if any)
 *   - latest valid minimal handoff (if any)
 *   - session linkage
 *
 * Recovery must fail safely:
 *   - no history -> explicit empty result, no throw
 *   - ref missing -> explicit error
 *   - record malformed -> explicit error
 *   - integrity mismatch -> explicit error
 *   - incompatible schema -> explicit error
 *   - project mismatch -> explicit error
 *
 * No LLM. No silent substitution of unrelated records.
 */
import type { Checkpoint } from "../core/checkpoint.js";
import type { MinimalHandoff } from "../core/handoff.js";
import type { SessionStore, SessionSummary } from "./session-store.js";
import type { ProjectMetadata } from "./records.js";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { HandoffStore } from "./handoff-store.js";
import type { ProjectStore } from "./project-store.js";
export interface ProjectRecovery {
    projectId: string;
    metadata: ProjectMetadata | null;
    latestCheckpoint: Checkpoint | null;
    latestHandoff: MinimalHandoff | null;
    sessions: SessionSummary[];
    hasHistory: boolean;
    errors: string[];
}
export declare class RecoveryError extends Error {
    constructor(message: string);
}
export declare function recoverLatestProjectState(projects: ProjectStore, checkpoints: CheckpointStore, handoffs: HandoffStore, sessions: SessionStore, projectId: string): ProjectRecovery;
//# sourceMappingURL=recovery.d.ts.map