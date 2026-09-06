/**
 * Portable core — minimal handoff contract.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §7.
 *
 * Intentionally smaller than a Checkpoint. Old solved diagnostics,
 * full transcripts, entire test logs, and the entire checkpoint
 * automatically are explicitly out. Only the projection needed by
 * the next session is carried forward.
 *
 * S01: schema/types + pure validation. No generation orchestration.
 */
import type { CheckpointStatus, HistoryRef } from "./checkpoint.js";
/**
 * Git state carried in a handoff. Same nullable semantics as in the
 * Checkpoint contract.
 */
export interface HandoffGitState {
    readonly repository: string | null;
    readonly branch: string | null;
    readonly head: string | null;
    readonly dirty: boolean | null;
}
/**
 * Frozen minimal handoff contract. R02 §7.
 *
 *   goal
 *   work_package
 *   status
 *   important_decisions
 *   hard_constraints
 *   current_files
 *   blockers
 *   active_errors
 *   git_state
 *   next_actions
 *   recovery_refs
 */
export interface MinimalHandoff {
    readonly goal: string;
    readonly work_package: string;
    readonly status: CheckpointStatus;
    readonly important_decisions: readonly string[];
    readonly hard_constraints: readonly string[];
    readonly current_files: readonly string[];
    readonly blockers: readonly string[];
    readonly active_errors: readonly string[];
    readonly git_state: HandoffGitState;
    readonly next_actions: readonly string[];
    readonly recovery_refs: readonly HistoryRef[];
}
/**
 * Pure handoff validation. Returns the input on success; throws on
 * the first violation.
 *
 * Crucially, `MinimalHandoff` does NOT require:
 *   - full transcript
 *   - entire test logs
 *   - full checkpoint contents
 *   - solved diagnostics
 *
 * This is the size discipline: the handoff is a projection, not a copy.
 */
export declare function validateHandoff(input: unknown): MinimalHandoff;
/**
 * Build a handoff from a Checkpoint by *projection* — not by copy.
 *
 * The handoff discards:
 *   - files_read (kept only as a count below, not as full paths)
 *   - tests / validation_results / active_errors (only blockers remain)
 *   - schema_version, checkpoint_id, project_id, session_id, created_at
 *   - completed / in_progress (collapsed into handoff summary fields)
 *   - handoff_summary (already a summary; not duplicated)
 *
 * The handoff keeps only the named R02 §7 fields. Anything else is
 * recoverable on demand via `recovery_refs`.
 */
export declare function projectHandoffFromCheckpoint(checkpoint: unknown): MinimalHandoff;
//# sourceMappingURL=handoff.d.ts.map