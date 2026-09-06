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
import { validateCheckpoint } from "./checkpoint.js";

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
export function validateHandoff(input: unknown): MinimalHandoff {
	if (typeof input !== "object" || input === null) {
		throw new Error("validateHandoff: input must be an object");
	}
	const h = input as Record<string, unknown>;

	requireString(h, "goal", "handoff");
	requireString(h, "work_package", "handoff");
	requireStatus(h, "status", "handoff");

	requireStringArray(h, "important_decisions", "handoff");
	requireStringArray(h, "hard_constraints", "handoff");
	requireStringArray(h, "current_files", "handoff");
	requireStringArray(h, "blockers", "handoff");
	requireStringArray(h, "active_errors", "handoff");

	requireGitState(h, "git_state", "handoff");

	requireStringArray(h, "next_actions", "handoff");

	requireHistoryRefs(h, "recovery_refs", "handoff");

	return h as unknown as MinimalHandoff;
}

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
export function projectHandoffFromCheckpoint(
	checkpoint: unknown,
): MinimalHandoff {
	const c = validateCheckpoint(checkpoint);

	const git_state: HandoffGitState = {
		repository: c.git_repository,
		branch: c.git_branch,
		head: c.git_head,
		dirty: c.git_dirty,
	};

	return {
		goal: c.goal,
		work_package: c.work_package,
		status: c.status,

		important_decisions: c.decisions,
		hard_constraints: c.constraints,

		current_files: c.files_modified,
		blockers: c.blockers,
		active_errors: c.active_errors,

		git_state,

		next_actions: c.next_actions,

		recovery_refs: c.recovery_refs,
	};
}

function requireString(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	if (typeof o[key] !== "string" || (o[key] as string).length === 0) {
		throw new Error(`validate${cap(owner)}: ${key} must be a non-empty string`);
	}
}

function requireStatus(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	const v = o[key];
	if (typeof v !== "string") {
		throw new Error(`validate${cap(owner)}: ${key} must be a status string`);
	}
	if (
		v !== "COMPLETE" &&
		v !== "IN_PROGRESS" &&
		v !== "BLOCKED"
	) {
		throw new Error(
			`validate${cap(owner)}: ${key} must be one of COMPLETE | IN_PROGRESS | BLOCKED (got ${v})`,
		);
	}
}

function requireStringArray(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	const v = o[key];
	if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
		throw new Error(`validate${cap(owner)}: ${key} must be an array of strings`);
	}
}

function requireGitState(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	const v = o[key];
	if (typeof v !== "object" || v === null) {
		throw new Error(`validate${cap(owner)}: ${key} must be an object`);
	}
	const g = v as Record<string, unknown>;
	if (g.repository !== null && typeof g.repository !== "string") {
		throw new Error(`validate${cap(owner)}: git_state.repository must be string|null`);
	}
	if (g.branch !== null && typeof g.branch !== "string") {
		throw new Error(`validate${cap(owner)}: git_state.branch must be string|null`);
	}
	if (g.head !== null && typeof g.head !== "string") {
		throw new Error(`validate${cap(owner)}: git_state.head must be string|null`);
	}
	if (g.dirty !== null && typeof g.dirty !== "boolean") {
		throw new Error(`validate${cap(owner)}: git_state.dirty must be boolean|null`);
	}
}

function requireHistoryRefs(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	const v = o[key];
	if (!Array.isArray(v)) {
		throw new Error(`validate${cap(owner)}: ${key} must be an array of HistoryRef`);
	}
	for (const item of v) {
		if (
			typeof item !== "object" ||
			item === null ||
			typeof (item as HistoryRef).kind !== "string" ||
			typeof (item as HistoryRef).id !== "string" ||
			typeof (item as HistoryRef).uri !== "string"
		) {
			throw new Error(
				`validate${cap(owner)}: ${key}[] must have { kind, id, uri } strings`,
			);
		}
	}
}

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
