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
export class RecoveryError extends Error {
    constructor(message) {
        super(message);
        this.name = "RecoveryError";
    }
}
export function recoverLatestProjectState(projects, checkpoints, handoffs, sessions, projectId) {
    if (typeof projectId !== "string" || projectId.length === 0) {
        throw new RecoveryError("recover requires a non-empty projectId");
    }
    const errors = [];
    const metadata = safeReadMetadata(projects, projectId, errors);
    const latestCheckpoint = safeReadLatestCheckpoint(checkpoints, projectId, errors);
    const latestHandoff = safeReadLatestHandoff(handoffs, projectId, errors);
    const sessionSummaries = safeListSessions(sessions, projectId, errors);
    const hasHistory = metadata != null || latestCheckpoint != null || latestHandoff != null || sessionSummaries.length > 0;
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
function safeReadMetadata(projects, projectId, errors) {
    try {
        return projects.read(projectId);
    }
    catch (err) {
        errors.push(`metadata: ${err.message}`);
        return null;
    }
}
function safeReadLatestCheckpoint(checkpoints, projectId, errors) {
    try {
        return checkpoints.latest(projectId);
    }
    catch (err) {
        errors.push(`latest checkpoint: ${err.message}`);
        return null;
    }
}
function safeReadLatestHandoff(handoffs, projectId, errors) {
    try {
        return handoffs.latest(projectId);
    }
    catch (err) {
        errors.push(`latest handoff: ${err.message}`);
        return null;
    }
}
function safeListSessions(sessions, projectId, errors) {
    try {
        return sessions.list(projectId);
    }
    catch (err) {
        errors.push(`session list: ${err.message}`);
        return [];
    }
}
//# sourceMappingURL=recovery.js.map