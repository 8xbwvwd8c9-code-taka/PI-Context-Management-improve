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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverGenericProject, GenericProjectAdapter } from "./generic.js";
import type { ProjectAdapter, ProjectInfo } from "./index.js";

const REFS_HEADS = "ref: refs/heads/";

/**
 * Pure Git discovery from a project root. Returns the same shape
 * as `discoverGenericProject` plus the Git fields populated
 * best-effort.
 */
export function discoverGitProject(root: string): ProjectInfo {
	const base = discoverGenericProject(root);
	const gitDir = join(root, ".git");
	if (!existsSync(gitDir)) {
		// Not a Git repo; return the generic info unchanged.
		return base;
	}

	const head = readRefOrNull(join(gitDir, "HEAD"));
	const { branch, headSha: detachedSha } = parseHead(head);
	// When HEAD points at a branch, the SHA is the branch ref.
	const headSha =
		detachedSha ?? (branch !== null ? readRefOrNull(join(gitDir, "refs", "heads", branch)) : null);

	const origin = readOriginUrl(join(gitDir, "config"));
	const indexPath = join(gitDir, "index");
	// Conservative dirty: null until a real comparison is run.
	// S01 does not perform the comparison.
	const dirty: boolean | null = existsSync(indexPath) ? null : null;

	const info: ProjectInfo = {
		...base,
		repository: origin,
		branch,
		head: headSha,
		dirty,
	};
	return Object.freeze(info);
}

/**
 * `ProjectAdapter` implementation for the Git case. Wraps
 * `discoverGitProject` in the same async shape as
 * `GenericProjectAdapter`.
 */
export class GitProjectAdapter implements ProjectAdapter {
	readonly id = "git";
	private readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	async discover(): Promise<ProjectInfo> {
		return discoverGitProject(this.root);
	}
}

/**
 * Resolve the right adapter for a root, preferring Git when a
 * `.git` directory is present. Always falls back to the generic
 * adapter — non-Git projects are first-class.
 */
export async function discoverProject(root: string): Promise<ProjectInfo> {
	const gitDir = join(root, ".git");
	if (existsSync(gitDir)) {
		return new GitProjectAdapter(root).discover();
	}
	return new GenericProjectAdapter(root).discover();
}

function readRefOrNull(path: string): string | null {
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return null;
	}
}

function readOriginUrl(gitConfigPath: string): string | null {
	let raw: string;
	try {
		raw = readFileSync(gitConfigPath, "utf8");
	} catch {
		return null;
	}
	// Best-effort parse of `[remote "origin"]\n  url = ...`.
	// Not a full gitconfig parser; sufficient for the S01 snapshot.
	const lines = raw.split(/\r?\n/);
	let inOrigin = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("[")) {
			inOrigin = trimmed === '[remote "origin"]';
			continue;
		}
		if (inOrigin && trimmed.startsWith("url")) {
			const idx = trimmed.indexOf("=");
			if (idx > 0) {
				return trimmed.slice(idx + 1).trim();
			}
		}
	}
	return null;
}

function parseHead(head: string | null): {
	branch: string | null;
	headSha: string | null;
} {
	if (head === null || head.length === 0) {
		return { branch: null, headSha: null };
	}
	if (head.startsWith(REFS_HEADS)) {
		return { branch: head.slice(REFS_HEADS.length), headSha: null };
	}
	// Detached HEAD; treat the value as a SHA.
	if (/^[0-9a-f]{7,40}$/i.test(head)) {
		return { branch: null, headSha: head };
	}
	return { branch: null, headSha: null };
}
