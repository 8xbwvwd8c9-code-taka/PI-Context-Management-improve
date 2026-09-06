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
import type { ProjectAdapter, ProjectInfo } from "./index.js";

const KNOWN_INSTRUCTIONS = [
	"AGENTS.md",
	"CLAUDE.md",
	"AGENT.md",
	"README.md",
] as const;

/**
 * Build a generic project info from a root path. `root` MUST be an
 * absolute path that exists and is a directory.
 */
export function discoverGenericProject(root: string): ProjectInfo {
	if (typeof root !== "string" || root.length === 0) {
		throw new Error("discoverGenericProject: root must be a non-empty string");
	}
	let stat;
	try {
		stat = statSync(root);
	} catch (err) {
		throw new Error(
			`discoverGenericProject: cannot stat root ${JSON.stringify(root)} (${(err as Error).message})`,
		);
	}
	if (!stat.isDirectory()) {
		throw new Error(
			`discoverGenericProject: root is not a directory: ${JSON.stringify(root)}`,
		);
	}

	const project_id = sha256Of(root);
	const instructions: string[] = [];
	for (const name of KNOWN_INSTRUCTIONS) {
		const p = join(root, name);
		if (existsSync(p)) {
			instructions.push(name);
		}
	}

	const important_paths: string[] = [];
	for (const name of ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"]) {
		const p = join(root, name);
		if (existsSync(p)) {
			important_paths.push(name);
		}
	}

	const info: ProjectInfo = {
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
export class GenericProjectAdapter implements ProjectAdapter {
	readonly id = "generic";
	private readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	async discover(): Promise<ProjectInfo> {
		return discoverGenericProject(this.root);
	}

	/** Inspect the agent instructions file (first match wins). */
	static readInstructions(info: ProjectInfo): string | null {
		for (const name of info.instructions) {
			const p = join(info.root, name);
			try {
				return readFileSync(p, "utf8");
			} catch {
				// try next
			}
		}
		return null;
	}
}

function sha256Of(s: string): string {
	return createHash("sha256").update(s).digest("hex");
}
