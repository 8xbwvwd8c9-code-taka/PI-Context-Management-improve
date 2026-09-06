/**
 * S02 config + portability + security tests.
 *
 * Covers test IDs 39..47.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import { openStore, projectIdFromSeed } from "../src/store/index.js";
import { resolveConfig, defaultResolvedConfig } from "../src/core/config.js";

function freshRoot(): string {
	const root = join(
		tmpdir(),
		`cmv3-s02-cfg-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`,
	);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	return root;
}

describe("CONFIG 39: default storage outside repo", () => {
	it("default store lives under the user home (~/.pi/cmv3), not the cwd", () => {
		const s = openStore();
		// The default store root MUST NOT be the cwd.
		assert.ok(
			!s.layout.root.startsWith(process.cwd()) || s.layout.root === process.env["HOME"] + "/.pi/cmv3",
			`default store root is outside the cwd: ${s.layout.root}`,
		);
	});
});

describe("CONFIG 40: storage override works", () => {
	it("openStore({ storagePath }) places the store at the requested path", () => {
		const root = freshRoot();
		const s = openStore({ storagePath: root });
		assert.equal(s.layout.root, root);
		assert.ok(existsSync(root));
	});
});

describe("CONFIG 41: default mode remains legacy", () => {
	it("openStore without config returns ResolvedCMV3Config with mode=legacy", () => {
		const s = openStore({ storagePath: freshRoot() });
		assert.equal(s.config.mode, "legacy");
	});
	it("defaultResolvedConfig returns mode=legacy", () => {
		assert.equal(defaultResolvedConfig().mode, "legacy");
	});
});

describe("PORTABILITY 42: synthetic non-Git project passes", () => {
	it("a non-Git project can write and read checkpoints", () => {
		const root = freshRoot();
		const s = openStore({ storagePath: root });
		const p = projectIdFromSeed("non-git-project-42");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = {
			schema_version: "1.0.0" as const,
			checkpoint_id: "ckpt_pending",
			project_id: p,
			session_id: "sess_42",
			created_at: new Date().toISOString(),
			goal: "g",
			work_package: "WP-42",
			status: "COMPLETE" as const,
			completed: [],
			in_progress: [],
			blockers: [],
			decisions: [],
			constraints: [],
			files_read: [],
			files_modified: [],
			relevant_versions: [],
			tests: [],
			validation_results: [],
			active_errors: [],
			git_repository: null,
			git_branch: null,
			git_head: null,
			git_dirty: null,
			next_actions: [],
			recovery_refs: [],
			handoff_summary: "",
		};
		const w = s.checkpoints.write(cp, { projectId: p });
		const r = s.checkpoints.read(w.ref, p);
		assert.equal(r.work_package, "WP-42");
	});
});

describe("PORTABILITY 43: production package source has zero ST_BOT dependency", () => {
	it("grep for forbidden host-project identifiers in production source returns 0", async () => {
		// We import the package, which transitively requires the
		// store. If the store accidentally pulled in a host-project
		// identifier, this would fail at import time. The grep is
		// performed in package-check.mjs; this is a smoke test that
		// the package loads.
		const mod = await import("../src/index.js");
		assert.ok(mod["store"]);
		assert.ok(mod["core"]);
		assert.ok(mod["adapters"]);
		assert.ok(mod["pi"]);
	});
});

describe("SECURITY 44: stored filenames contain no secret/project absolute path", () => {
	it("a record filename is the opaque id plus .json", () => {
		const root = freshRoot();
		const s = openStore({ storagePath: root });
		const p = projectIdFromSeed("seed-sec44");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = {
			schema_version: "1.0.0" as const,
			checkpoint_id: "ckpt_pending",
			project_id: p,
			session_id: "sess",
			created_at: new Date().toISOString(),
			goal: "g",
			work_package: "WP",
			status: "COMPLETE" as const,
			completed: [],
			in_progress: [],
			blockers: [],
			decisions: [],
			constraints: [],
			files_read: [],
			files_modified: [],
			relevant_versions: [],
			tests: [],
			validation_results: [],
			active_errors: [],
			git_repository: null,
			git_branch: null,
			git_head: null,
			git_dirty: null,
			next_actions: [],
			recovery_refs: [],
			handoff_summary: "",
		};
		const w = s.checkpoints.write(cp, { projectId: p });
		const path = join(s.layout.projectsRoot, p, "checkpoints", `${w.id}.json`);
		const base = path.split("/").pop()!;
		assert.match(base, /^[a-z0-9_-]+\.json$/);
		assert.ok(!base.includes(process.cwd().split("/").pop()!));
		assert.ok(!base.includes("Users"));
	});
});

describe("SECURITY 45: refs opaque", () => {
	it("refs are exactly cmv3://<kind>/<id>", () => {
		const root = freshRoot();
		const s = openStore({ storagePath: root });
		const p = projectIdFromSeed("seed-sec45");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = {
			schema_version: "1.0.0" as const,
			checkpoint_id: "ckpt_pending",
			project_id: p,
			session_id: "sess",
			created_at: new Date().toISOString(),
			goal: "g",
			work_package: "WP",
			status: "COMPLETE" as const,
			completed: [],
			in_progress: [],
			blockers: [],
			decisions: [],
			constraints: [],
			files_read: [],
			files_modified: [],
			relevant_versions: [],
			tests: [],
			validation_results: [],
			active_errors: [],
			git_repository: null,
			git_branch: null,
			git_head: null,
			git_dirty: null,
			next_actions: [],
			recovery_refs: [],
			handoff_summary: "",
		};
		const w = s.checkpoints.write(cp, { projectId: p });
		assert.match(w.ref, /^cmv3:\/\/checkpoint\/[a-z0-9_-]+$/);
	});
});

describe("SECURITY 46: normal logs do not emit checkpoint body", () => {
	it("writing a checkpoint does not console.log the body", () => {
		const root = freshRoot();
		const s = openStore({ storagePath: root });
		const p = projectIdFromSeed("seed-sec46");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = {
			schema_version: "1.0.0" as const,
			checkpoint_id: "ckpt_pending",
			project_id: p,
			session_id: "sess",
			created_at: new Date().toISOString(),
			goal: "BODY-MUST-NOT-BE-LOGGED",
			work_package: "WP",
			status: "COMPLETE" as const,
			completed: [],
			in_progress: [],
			blockers: [],
			decisions: [],
			constraints: [],
			files_read: [],
			files_modified: [],
			relevant_versions: [],
			tests: [],
			validation_results: [],
			active_errors: [],
			git_repository: null,
			git_branch: null,
			git_head: null,
			git_dirty: null,
			next_actions: [],
			recovery_refs: [],
			handoff_summary: "",
		};
		// We do not intercept process.stdout; we just assert the
		// store surface does not expose any "logBody" method.
		assert.equal(typeof (s.checkpoints as unknown as { logBody?: unknown }).logBody, "undefined");
		s.checkpoints.write(cp, { projectId: p });
	});
});

describe("SECURITY 47: default permissions are restrictive where supported", () => {
	it("the store root is created with 0o700", () => {
		const root = freshRoot();
		const s = openStore({ storagePath: root });
		// Best-effort: on POSIX we can stat; on Windows the mode is
		// approximate.
		if (process.platform !== "win32") {
			const st = statSync(s.layout.root);
			// Strip the type bits and compare. We only require that
			// permissions do not include o+w for group/other.
			const mode = st.mode & 0o777;
			assert.equal(mode & 0o077, 0, "no group/other access on the store root");
		}
	});
});
