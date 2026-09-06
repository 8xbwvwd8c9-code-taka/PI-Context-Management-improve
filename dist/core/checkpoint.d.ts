/**
 * Portable core — checkpoint contract.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §6.
 *
 * Schema-versioned durable project / session state. Not an LLM
 * narrative summary. Status distinguishes COMPLETE / IN_PROGRESS /
 * BLOCKED. Not every field must be populated; omission is a valid
 * value.
 *
 * S01: schema/types + pure validation. No persistence. No read/write.
 */
import type { RefKind } from "./refs.js";
export declare const CHECKPOINT_SCHEMA_VERSION: "1.0.0";
export type CheckpointStatus = "COMPLETE" | "IN_PROGRESS" | "BLOCKED";
export declare const CHECKPOINT_STATUSES: readonly CheckpointStatus[];
/**
 * Recovery reference attached to a checkpoint. Always opaque; no
 * payload in the id. The kind is required for kind-aware recovery.
 */
export interface HistoryRef {
    readonly kind: RefKind;
    readonly id: string;
    readonly uri: string;
}
/**
 * Git state captured at checkpoint time. Every field is nullable
 * because a project may not be a Git repository.
 */
export interface CheckpointGitState {
    readonly repository: string | null;
    readonly branch: string | null;
    readonly head: string | null;
    readonly dirty: boolean | null;
}
/**
 * Frozen checkpoint contract (R02 §6). S01 only validates; it does
 * not implement persistence.
 */
export interface Checkpoint {
    readonly schema_version: typeof CHECKPOINT_SCHEMA_VERSION;
    readonly checkpoint_id: string;
    readonly project_id: string;
    readonly session_id: string;
    readonly created_at: string;
    readonly goal: string;
    readonly work_package: string;
    readonly status: CheckpointStatus;
    readonly completed: readonly string[];
    readonly in_progress: readonly string[];
    readonly blockers: readonly string[];
    readonly decisions: readonly string[];
    readonly constraints: readonly string[];
    readonly files_read: readonly string[];
    readonly files_modified: readonly string[];
    readonly relevant_versions: readonly string[];
    readonly tests: readonly string[];
    readonly validation_results: readonly string[];
    readonly active_errors: readonly string[];
    readonly git_repository: string | null;
    readonly git_branch: string | null;
    readonly git_head: string | null;
    readonly git_dirty: boolean | null;
    readonly next_actions: readonly string[];
    readonly recovery_refs: readonly HistoryRef[];
    readonly handoff_summary: string;
}
/**
 * Pure checkpoint validation. Returns the input on success; throws
 * `Error` on the first violation. The check is exhaustive over the
 * R02 §6 contract.
 *
 * S01 does not implement persistence. The schema is the contract;
 * runtime writers (S02) are expected to call this before persisting.
 */
export declare function validateCheckpoint(input: unknown): Checkpoint;
//# sourceMappingURL=checkpoint.d.ts.map