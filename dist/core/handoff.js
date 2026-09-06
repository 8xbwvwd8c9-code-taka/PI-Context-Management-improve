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
import { validateCheckpoint } from "./checkpoint.js";
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
export function validateHandoff(input) {
    if (typeof input !== "object" || input === null) {
        throw new Error("validateHandoff: input must be an object");
    }
    const h = input;
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
    return h;
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
export function projectHandoffFromCheckpoint(checkpoint) {
    const c = validateCheckpoint(checkpoint);
    const git_state = {
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
function requireString(o, key, owner) {
    if (typeof o[key] !== "string" || o[key].length === 0) {
        throw new Error(`validate${cap(owner)}: ${key} must be a non-empty string`);
    }
}
function requireStatus(o, key, owner) {
    const v = o[key];
    if (typeof v !== "string") {
        throw new Error(`validate${cap(owner)}: ${key} must be a status string`);
    }
    if (v !== "COMPLETE" &&
        v !== "IN_PROGRESS" &&
        v !== "BLOCKED") {
        throw new Error(`validate${cap(owner)}: ${key} must be one of COMPLETE | IN_PROGRESS | BLOCKED (got ${v})`);
    }
}
function requireStringArray(o, key, owner) {
    const v = o[key];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
        throw new Error(`validate${cap(owner)}: ${key} must be an array of strings`);
    }
}
function requireGitState(o, key, owner) {
    const v = o[key];
    if (typeof v !== "object" || v === null) {
        throw new Error(`validate${cap(owner)}: ${key} must be an object`);
    }
    const g = v;
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
function requireHistoryRefs(o, key, owner) {
    const v = o[key];
    if (!Array.isArray(v)) {
        throw new Error(`validate${cap(owner)}: ${key} must be an array of HistoryRef`);
    }
    for (const item of v) {
        if (typeof item !== "object" ||
            item === null ||
            typeof item.kind !== "string" ||
            typeof item.id !== "string" ||
            typeof item.uri !== "string") {
            throw new Error(`validate${cap(owner)}: ${key}[] must have { kind, id, uri } strings`);
        }
    }
}
function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
//# sourceMappingURL=handoff.js.map