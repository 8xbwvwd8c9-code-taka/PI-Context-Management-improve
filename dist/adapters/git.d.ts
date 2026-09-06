/**
 * Git adapter — read-only discovery.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §2.D.
 *
 * S01 provides a *pure discovery helper* that parses a `.git`
 * directory layout without spawning a subprocess and without
 * executing any destructive operations. The interface is identical
 * to `GenericProjectAdapter` so consumers can swap adapters
 * without changing the rest of the pipeline.
 *
 * This adapter NEVER:
 *   - runs `git checkout`, `git reset`, `git clean`, `git stash`
 *   - mutates the working tree
 *   - touches `.git/index` or `.git/HEAD` other than reading
 *
 * It only inspects:
 *   - .git/HEAD (current branch / detached SHA)
 *   - .git/config (origin URL, best-effort)
 *   - .git/index presence (dirty check is structural, not porcelain)
 *
 * Dirty detection is intentionally conservative: it returns
 * `null` when a more accurate answer would require a full
 * porcelain comparison. The downstream agent can call a richer tool
 * when exact dirty state matters.
 */
import type { ProjectAdapter, ProjectInfo } from "./index.js";
/**
 * Pure Git discovery from a project root. Returns the same shape
 * as `discoverGenericProject` plus the Git fields populated
 * best-effort.
 */
export declare function discoverGitProject(root: string): ProjectInfo;
/**
 * `ProjectAdapter` implementation for the Git case. Wraps
 * `discoverGitProject` in the same async shape as
 * `GenericProjectAdapter`.
 */
export declare class GitProjectAdapter implements ProjectAdapter {
    readonly id = "git";
    private readonly root;
    constructor(root: string);
    discover(): Promise<ProjectInfo>;
}
/**
 * Resolve the right adapter for a root, preferring Git when a
 * `.git` directory is present. Always falls back to the generic
 * adapter — non-Git projects are first-class.
 */
export declare function discoverProject(root: string): Promise<ProjectInfo>;
//# sourceMappingURL=git.d.ts.map