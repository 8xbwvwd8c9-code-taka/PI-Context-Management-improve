/**
 * Generic project adapter.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §2.D.
 *
 * Returns a minimal `ProjectInfo` from a root path with no Git
 * dependency. The generic adapter is the zero-config default; a
 * Git repository, a Mercurial repository, or any other VCS layout
 * is representable as long as the root is readable.
 *
 * No destructive operations. No subprocess execution. Pure I/O via
 * `node:fs`/`node:path`/`node:crypto`.
 */
import type { ProjectAdapter, ProjectInfo } from "./index.js";
/**
 * Build a generic project info from a root path. `root` MUST be an
 * absolute path that exists and is a directory.
 */
export declare function discoverGenericProject(root: string): ProjectInfo;
/**
 * Default `ProjectAdapter` for the generic case. `discover()` is a
 * thin wrapper around `discoverGenericProject`.
 */
export declare class GenericProjectAdapter implements ProjectAdapter {
    readonly id = "generic";
    private readonly root;
    constructor(root: string);
    discover(): Promise<ProjectInfo>;
    /** Inspect the agent instructions file (first match wins). */
    static readInstructions(info: ProjectInfo): string | null;
}
//# sourceMappingURL=generic.d.ts.map