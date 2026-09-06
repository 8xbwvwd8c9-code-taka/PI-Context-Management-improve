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

export class RecoveryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RecoveryError";
	}
}

export function recoverLatestProjectState(
	projects: ProjectStore,
	checkpoints: CheckpointStore,
	handoffs: HandoffStore,
	sessions: SessionStore,
	projectId: string,
): ProjectRecovery {
	if (typeof projectId !== "string" || projectId.length === 0) {
		throw new RecoveryError("recover requires a non-empty projectId");
	}
	const errors: string[] = [];
	const metadata = safeReadMetadata(projects, projectId, errors);
	const latestCheckpoint = safeReadLatestCheckpoint(checkpoints, projectId, errors);
	const latestHandoff = safeReadLatestHandoff(handoffs, projectId, errors);
	const sessionSummaries = safeListSessions(sessions, projectId, errors);

	const hasHistory =
		metadata != null || latestCheckpoint != null || latestHandoff != null || sessionSummaries.length > 0;
	return {
		projectId,
		metadata,
		latestCheckpoint,
		latestHandoff,
		sessions: sessionSummaries,
		hasHistory,
		errors,
	};
}

function safeReadMetadata(
	projects: ProjectStore,
	projectId: string,
	errors: string[],
): ProjectMetadata | null {
	try {
		return projects.read(projectId);
	} catch (err) {
		errors.push(`metadata: ${(err as Error).message}`);
		return null;
	}
}

function safeReadLatestCheckpoint(
	checkpoints: CheckpointStore,
	projectId: string,
	errors: string[],
): Checkpoint | null {
	try {
		return checkpoints.latest(projectId);
	} catch (err) {
		errors.push(`latest checkpoint: ${(err as Error).message}`);
		return null;
	}
}

function safeReadLatestHandoff(
	handoffs: HandoffStore,
	projectId: string,
	errors: string[],
): MinimalHandoff | null {
	try {
		return handoffs.latest(projectId);
	} catch (err) {
		errors.push(`latest handoff: ${(err as Error).message}`);
		return null;
	}
}

function safeListSessions(
	sessions: SessionStore,
	projectId: string,
	errors: string[],
): SessionSummary[] {
	try {
		return sessions.list(projectId);
	} catch (err) {
		errors.push(`session list: ${(err as Error).message}`);
		return [];
	}
}
