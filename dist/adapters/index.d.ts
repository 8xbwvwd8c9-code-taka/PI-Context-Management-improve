/**
 * Project adapters — generic discovery.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §2.D, §11.
 *
 * A `ProjectAdapter` returns a frozen `ProjectInfo` snapshot. It is
 * not a destructive Git wrapper. It does not execute writes. A
 * non-Git project is fully representable.
 *
 * S01: contracts only. No destructive operations. No Git mandatory.
 */
import type { ResolvedCMV3Config } from "../core/config.js";
/**
 * Frozen project info returned by every adapter. None of these
 * fields are required to be populated; consumers must tolerate
 * `null` / empty lists.
 */
export interface ProjectInfo {
    /** Stable id for the project (e.g. sha256 of root). */
    readonly project_id: string;
    /** Absolute filesystem root of the project. */
    readonly root: string;
    /** Repository URL (Git only; null for non-Git projects). */
    readonly repository: string | null;
    /** Current branch (Git only; null for non-Git / detached). */
    readonly branch: string | null;
    /** Current HEAD commit (Git only; null otherwise). */
    readonly head: string | null;
    /** Dirty state (Git only; null otherwise). */
    readonly dirty: boolean | null;
    /** Detected project instructions file(s) (e.g. AGENTS.md). */
    readonly instructions: readonly string[];
    /** Detected test commands. Empty list when none. */
    readonly test_commands: readonly string[];
    /** Important paths the agent should be aware of. */
    readonly important_paths: readonly string[];
    /** Optional WP / task metadata. Host-specific adapters may populate. */
    readonly task_metadata: Readonly<Record<string, unknown>>;
}
/**
 * Project adapter contract. Pure, side-effect free, returns a
 * `ProjectInfo` snapshot. No `cwd` mutation. No Git writes.
 */
export interface ProjectAdapter {
    /** Stable id; e.g. "generic" or "git". */
    readonly id: string;
    /**
     * Discover project info. The optional `config` is the resolved
     * CMV3 config; adapters MAY consult it but MUST NOT mutate it.
     */
    discover(config?: ResolvedCMV3Config): Promise<ProjectInfo>;
}
//# sourceMappingURL=index.d.ts.map