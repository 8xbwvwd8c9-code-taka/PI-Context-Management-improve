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
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const KNOWN_INSTRUCTIONS = [
    "AGENTS.md",
    "CLAUDE.md",
    "AGENT.md",
    "README.md",
];
/**
 * Build a generic project info from a root path. `root` MUST be an
 * absolute path that exists and is a directory.
 */
export function discoverGenericProject(root) {
    if (typeof root !== "string" || root.length === 0) {
        throw new Error("discoverGenericProject: root must be a non-empty string");
    }
    let stat;
    try {
        stat = statSync(root);
    }
    catch (err) {
        throw new Error(`discoverGenericProject: cannot stat root ${JSON.stringify(root)} (${err.message})`);
    }
    if (!stat.isDirectory()) {
        throw new Error(`discoverGenericProject: root is not a directory: ${JSON.stringify(root)}`);
    }
    const project_id = sha256Of(root);
    const instructions = [];
    for (const name of KNOWN_INSTRUCTIONS) {
        const p = join(root, name);
        if (existsSync(p)) {
            instructions.push(name);
        }
    }
    const important_paths = [];
    for (const name of ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"]) {
        const p = join(root, name);
        if (existsSync(p)) {
            important_paths.push(name);
        }
    }
    const info = {
        project_id,
        root,
        repository: null,
        branch: null,
        head: null,
        dirty: null,
        instructions,
        test_commands: [],
        important_paths,
        task_metadata: {},
    };
    // Read-only snapshot; freeze for safety.
    return Object.freeze(info);
}
/**
 * Default `ProjectAdapter` for the generic case. `discover()` is a
 * thin wrapper around `discoverGenericProject`.
 */
export class GenericProjectAdapter {
    id = "generic";
    root;
    constructor(root) {
        this.root = root;
    }
    async discover() {
        return discoverGenericProject(this.root);
    }
    /** Inspect the agent instructions file (first match wins). */
    static readInstructions(info) {
        for (const name of info.instructions) {
            const p = join(info.root, name);
            try {
                return readFileSync(p, "utf8");
            }
            catch {
                // try next
            }
        }
        return null;
    }
}
function sha256Of(s) {
    return createHash("sha256").update(s).digest("hex");
}
//# sourceMappingURL=generic.js.map