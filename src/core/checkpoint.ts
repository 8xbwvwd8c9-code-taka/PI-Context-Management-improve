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

export const CHECKPOINT_SCHEMA_VERSION = "1.0.0" as const;

export type CheckpointStatus = "COMPLETE" | "IN_PROGRESS" | "BLOCKED";

export const CHECKPOINT_STATUSES: readonly CheckpointStatus[] = Object.freeze([
	"COMPLETE",
	"IN_PROGRESS",
	"BLOCKED",
]);

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
export function validateCheckpoint(input: unknown): Checkpoint {
	if (typeof input !== "object" || input === null) {
		throw new Error("validateCheckpoint: input must be an object");
	}
	const c = input as Record<string, unknown>;

	requireString(c, "schema_version", "checkpoint");
	if (c.schema_version !== CHECKPOINT_SCHEMA_VERSION) {
		throw new Error(
			`validateCheckpoint: schema_version must be ${CHECKPOINT_SCHEMA_VERSION} (got ${String(c.schema_version)})`,
		);
	}
	requireString(c, "checkpoint_id", "checkpoint");
	requireString(c, "project_id", "checkpoint");
	requireString(c, "session_id", "checkpoint");
	requireString(c, "created_at", "checkpoint");

	requireString(c, "goal", "checkpoint");
	requireString(c, "work_package", "checkpoint");
	requireStatus(c, "status", "checkpoint");

	requireStringArray(c, "completed", "checkpoint");
	requireStringArray(c, "in_progress", "checkpoint");
	requireStringArray(c, "blockers", "checkpoint");

	requireStringArray(c, "decisions", "checkpoint");
	requireStringArray(c, "constraints", "checkpoint");

	requireStringArray(c, "files_read", "checkpoint");
	requireStringArray(c, "files_modified", "checkpoint");
	requireStringArray(c, "relevant_versions", "checkpoint");

	requireStringArray(c, "tests", "checkpoint");
	requireStringArray(c, "validation_results", "checkpoint");
	requireStringArray(c, "active_errors", "checkpoint");

	requireNullableString(c, "git_repository", "checkpoint");
	requireNullableString(c, "git_branch", "checkpoint");
	requireNullableString(c, "git_head", "checkpoint");
	requireNullableBoolean(c, "git_dirty", "checkpoint");

	requireStringArray(c, "next_actions", "checkpoint");

	requireHistoryRefs(c, "recovery_refs", "checkpoint");

	requireString(c, "handoff_summary", "checkpoint");

	return c as unknown as Checkpoint;
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

function requireNullableString(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	if (o[key] !== null && typeof o[key] !== "string") {
		throw new Error(
			`validate${cap(owner)}: ${key} must be a string or null (got ${typeof o[key]})`,
		);
	}
}

function requireNullableBoolean(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	if (o[key] !== null && typeof o[key] !== "boolean") {
		throw new Error(
			`validate${cap(owner)}: ${key} must be a boolean or null (got ${typeof o[key]})`,
		);
	}
}

function requireStatus(
	o: Record<string, unknown>,
	key: string,
	owner: string,
): void {
	const v = o[key];
	if (typeof v !== "string" || !(CHECKPOINT_STATUSES as readonly string[]).includes(v)) {
		throw new Error(
			`validate${cap(owner)}: ${key} must be one of ${CHECKPOINT_STATUSES.join(" | ")} (got ${String(v)})`,
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
