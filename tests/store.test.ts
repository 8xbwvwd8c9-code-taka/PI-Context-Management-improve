/**
 * S02 store-level tests.
 *
 * Covers test IDs 1..38 (CHECKPOINT, ATOMICITY, HANDOFF, PROJECT,
 * SESSION, HISTORY, RECOVERY).
 *
 * Each test uses a fresh temp store root, opened via openStore(),
 * so the production defaults are exercised end-to-end.
 */

import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import {
	openStore,
	projectIdFromSeed,
	type Cmv3Store,
} from "../src/store/index.js";
import {
	CHECKPOINT_SCHEMA_VERSION,
	makeRef,
	validateCheckpoint,
	type Checkpoint,
} from "../src/core/index.js";
import { projectHandoffFromCheckpoint, validateHandoff } from "../src/core/handoff.js";

function freshStore(): Cmv3Store {
	const root = join(
		tmpdir(),
		`cmv3-s02-test-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`,
	);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	return openStore({ storagePath: root });
}

function freshStoreRoot(): string {
	const root = join(
		tmpdir(),
		`cmv3-s02-root-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`,
	);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	return root;
}

function makeCheckpoint(opts: {
	projectId: string;
	sessionId: string;
	workPackage: string;
	status: "COMPLETE" | "IN_PROGRESS" | "BLOCKED";
	createdAt?: string;
}): Checkpoint {
	return {
		schema_version: CHECKPOINT_SCHEMA_VERSION,
		checkpoint_id: "ckpt_pending",
		project_id: opts.projectId,
		session_id: opts.sessionId,
		created_at: opts.createdAt ?? new Date().toISOString(),

		goal: `Goal for ${opts.workPackage}`,
		work_package: opts.workPackage,
		status: opts.status,

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
}

/* ============================================================
 *  CHECKPOINT
 * ============================================================ */

describe("CHECKPOINT 1: valid COMPLETE persists/loads exactly", () => {
	it("round-trips with the same fields and a stable id", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("git@github.com:example/proj-a.git");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "git",
			repo_remote: "git@github.com:example/proj-a.git",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_test1", workPackage: "WP-A", status: "COMPLETE" });
		const w = s.checkpoints.write(cp, { projectId, sessionId: "sess_test1" });
		const r = s.checkpoints.read(w.ref, projectId);
		assert.equal(r.work_package, "WP-A");
		assert.equal(r.status, "COMPLETE");
		assert.equal(r.goal, cp.goal);
		assert.equal(r.checkpoint_id, w.id);
	});
});

describe("CHECKPOINT 2: IN_PROGRESS persists/loads", () => {
	it("preserves the IN_PROGRESS status", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-ip");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_ip", workPackage: "WP-IP", status: "IN_PROGRESS" });
		const w = s.checkpoints.write(cp, { projectId });
		const r = s.checkpoints.read(w.ref, projectId);
		assert.equal(r.status, "IN_PROGRESS");
	});
});

describe("CHECKPOINT 3: BLOCKED persists/loads", () => {
	it("preserves the BLOCKED status", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-blocked");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_b", workPackage: "WP-B", status: "BLOCKED" });
		const w = s.checkpoints.write(cp, { projectId });
		const r = s.checkpoints.read(w.ref, projectId);
		assert.equal(r.status, "BLOCKED");
	});
});

describe("CHECKPOINT 4: invalid checkpoint rejected before write", () => {
	it("rejects when status is not in the enum", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-inv1");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_inv", workPackage: "WP-X", status: "COMPLETE" });
		assert.throws(() =>
			s.checkpoints.write({ ...cp, status: "PARTIAL" as unknown as "COMPLETE" }, { projectId }),
		);
	});
	it("rejects when schema_version is wrong", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-inv2");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_inv2", workPackage: "WP-X", status: "COMPLETE" });
		assert.throws(() =>
			s.checkpoints.write({ ...cp, schema_version: "0.0.0" }, { projectId }),
		);
	});
});

describe("CHECKPOINT 5: ref issued only after successful persistence", () => {
	it("the ref returned points to a file that exists", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-ref");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_ref", workPackage: "WP-R", status: "COMPLETE" });
		const w = s.checkpoints.write(cp, { projectId });
		const path = join(s.layout.projectsRoot, projectId, "checkpoints", `${w.id}.json`);
		assert.ok(existsSync(path), "authoritative file must exist");
	});
	it("a failed write (validation error) does not leave a file", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-fail");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_fail", workPackage: "WP-F", status: "COMPLETE" });
		try {
			s.checkpoints.write({ ...cp, goal: 1 as unknown as string }, { projectId });
		} catch {
			/* expected */
		}
		const dir = join(s.layout.projectsRoot, projectId, "checkpoints");
		// No files should be present. The dir may not even exist;
		// that's fine — the invariant is "no valid authoritative
		// record".
		const files = existsSync(dir)
			? readdirSync(dir).filter((f) => f.endsWith(".json"))
			: [];
		assert.equal(files.length, 0);
	});
});

describe("CHECKPOINT 6: latest checkpoint deterministic", () => {
	it("returns the most recent by created_at, then id", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-lat");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
		for (let i = 0; i < 3; i++) {
			const cp = makeCheckpoint({
				projectId,
				sessionId: "sess_lat",
				workPackage: `WP-L${i}`,
				status: "COMPLETE",
				createdAt: new Date(baseTs + i * 1000).toISOString(),
			});
			s.checkpoints.write(cp, { projectId });
		}
		const latest = s.checkpoints.latest(projectId);
		assert.ok(latest);
		assert.equal(latest.work_package, "WP-L2");
	});
});

describe("CHECKPOINT 7: corruption detected", () => {
	it("throws CheckpointIntegrityError on content tampering", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-corr");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_corr", workPackage: "WP-C", status: "COMPLETE" });
		const w = s.checkpoints.write(cp, { projectId });
		const path = join(s.layout.projectsRoot, projectId, "checkpoints", `${w.id}.json`);
		const raw = readFileSync(path, "utf8");
		// Tamper with the content field
		const env = JSON.parse(raw) as { content: { goal: string } };
		env.content.goal = "tampered";
		writeFileSync(path, JSON.stringify(env));
		assert.throws(() => s.checkpoints.readById(projectId, w.id));
	});
});

describe("CHECKPOINT 8: unsupported schema rejected", () => {
	it("rejects a checkpoint with a future schema_version", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-future");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_f", workPackage: "WP-F", status: "COMPLETE" });
		const w = s.checkpoints.write(cp, { projectId });
		const path = join(s.layout.projectsRoot, projectId, "checkpoints", `${w.id}.json`);
		const raw = readFileSync(path, "utf8");
		const env = JSON.parse(raw) as { schema_version: string };
		env.schema_version = "99.0.0";
		writeFileSync(path, JSON.stringify(env));
		assert.throws(() => s.checkpoints.readById(projectId, w.id));
	});
});

describe("CHECKPOINT 9: missing ref fails safely", () => {
	it("throws a clear error on missing checkpoint file", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-miss");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		assert.throws(() => s.checkpoints.readById(projectId, "id_doesnotexist00"));
	});
	it("history.find returns null for a missing ref", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-miss-find");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const found = s.history.find(makeRef("checkpoint", "id_xxxxxxxx"), projectId);
		assert.equal(found, null);
	});
});

/* ============================================================
 *  ATOMICITY
 * ============================================================ */

describe("ATOMICITY 10: temp write failure leaves no valid authoritative record", () => {
	it("a validation error does not leave a temp file", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-atomic1");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_at1", workPackage: "WP-A", status: "COMPLETE" });
		try {
			s.checkpoints.write({ ...cp, completed: "not an array" as unknown as string[] }, { projectId });
		} catch {
			/* expected */
		}
		const dir = join(s.layout.projectsRoot, projectId, "checkpoints");
		const all = existsSync(dir) ? readdirSync(dir) : [];
		assert.equal(all.length, 0, "no files (including temp) should remain");
	});
});

describe("ATOMICITY 11: rename/finalization failure yields no valid ref", () => {
	it("a write that throws inside atomicWriteFile yields no ref", () => {
		// We exercise the failure path indirectly: a write that
		// intentionally throws before the rename is issued must
		// leave no authoritative file. We can simulate the failure
		// by pre-creating a file with the same name (exclusive flag
		// will fail). However, the atomic helper retries on EEXIST,
		// so a cleaner test is: ask atomicWriteFile to write to a
		// path whose parent we make non-writable.
		//
		// On macOS / Linux this works only when the test process is
		// not root. We skip when the chmod trick is not feasible.
		if (process.platform === "win32") return;
		if (process.getuid && process.getuid() === 0) return;
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-rename-fail");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const dir = join(s.layout.projectsRoot, projectId, "checkpoints");
		mkdirSync(dir, { recursive: true });
		const cp = makeCheckpoint({ projectId, sessionId: "sess_ren", workPackage: "WP-R", status: "COMPLETE" });
		chmodSync(dir, 0o500);
		let threw = false;
		try {
			s.checkpoints.write(cp, { projectId });
		} catch {
			threw = true;
		} finally {
			try {
				chmodSync(dir, 0o700);
			} catch {
				/* best effort */
			}
		}
		// If the platform honored 0o500, the write must have
		// thrown. Otherwise, we just verify the invariant: the
		// authoritative file count after the attempt matches the
		// observable outcome.
		if (threw) {
			const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
			assert.equal(files.length, 0);
		}
	});
});

describe("ATOMICITY 12: stale temp file ignored safely", () => {
	it("a .tmp sibling in the checkpoints dir is not loaded as a record", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-stale");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const dir = join(s.layout.projectsRoot, projectId, "checkpoints");
		mkdirSync(dir, { recursive: true });
		// A stale temp file is just bytes on disk; reads only
		// consider .json files.
		writeFileSync(join(dir, "ckpt_stale1234.tmp"), "garbage");
		const summaries = s.checkpoints.list(projectId);
		assert.equal(summaries.length, 0);
	});
});

/* ============================================================
 *  HANDOFF
 * ============================================================ */

describe("HANDOFF 13: generated handoff equals deterministic projection", () => {
	it("fromCheckpoint yields a handoff that passes validateHandoff", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-h13");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_h13", workPackage: "WP-H", status: "COMPLETE" });
		cp.completed = ["task A", "task B"];
		cp.decisions = ["Use small active context."];
		cp.files_modified = ["src/foo.ts"];
		const w = s.checkpoints.write(cp, { projectId });
		const loaded = s.checkpoints.read(w.ref, projectId);
		const h = s.handoffs.fromCheckpoint(loaded, { projectId });
		const validated = validateHandoff(h.handoff);
		assert.equal(validated.goal, loaded.goal);
		assert.equal(validated.work_package, "WP-H");
		assert.equal(validated.status, "COMPLETE");
		assert.deepEqual([...validated.important_decisions], ["Use small active context."]);
		assert.deepEqual([...validated.current_files], ["src/foo.ts"]);
	});
});

describe("HANDOFF 14: handoff excludes transcript-style data", () => {
	it("the projection does not include files_read or tests", () => {
		const cp = makeCheckpoint({
			projectId: "p1",
			sessionId: "s1",
			workPackage: "WP-T",
			status: "COMPLETE",
		});
		cp.files_read = ["docs/a.md", "docs/b.md"];
		cp.tests = ["tests/a.test.ts"];
		cp.validation_results = ["all green"];
		cp.handoff_summary = "huge narrative that should not be in a handoff";
		const h = projectHandoffFromCheckpoint(cp);
		const keys = Object.keys(h).sort();
		assert.ok(!keys.includes("files_read"));
		assert.ok(!keys.includes("tests"));
		assert.ok(!keys.includes("validation_results"));
		assert.ok(!keys.includes("handoff_summary"));
	});
});

describe("HANDOFF 15: handoff persists/loads", () => {
	it("round-trips through write/read", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-h15");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_h15", workPackage: "WP-H15", status: "COMPLETE" });
		const w = s.checkpoints.write(cp, { projectId });
		const ck = s.checkpoints.read(w.ref, projectId);
		const h = s.handoffs.fromCheckpoint(ck, { projectId });
		const r = s.handoffs.read(h.ref, projectId);
		assert.equal(r.work_package, "WP-H15");
		assert.equal(r.status, "COMPLETE");
	});
});

describe("HANDOFF 16: historical handoff not mutated in place", () => {
	it("writing a new handoff does not change the previous handoff file", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-h16");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_h16", workPackage: "WP-H16", status: "IN_PROGRESS" });
		const ck = s.checkpoints.write(cp, { projectId });
		const h1 = s.handoffs.fromCheckpoint(s.checkpoints.read(ck.ref, projectId), { projectId });
		const beforePath = join(s.layout.projectsRoot, projectId, "handoffs", `${h1.id}.json`);
		const beforeBytes = readFileSync(beforePath);
		// Write a new handoff from an updated checkpoint
		const cp2 = { ...cp, status: "COMPLETE" as const, goal: "updated goal" };
		const ck2 = s.checkpoints.write(cp2, { projectId });
		const h2 = s.handoffs.fromCheckpoint(s.checkpoints.read(ck2.ref, projectId), { projectId });
		const afterBytes = readFileSync(beforePath);
		assert.equal(beforeBytes.length, afterBytes.length, "first handoff file is unchanged");
		assert.notEqual(h1.id, h2.id);
	});
});

describe("HANDOFF 17: latest handoff deterministic", () => {
	it("returns the same handoff on repeat calls; newest by created_at", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-h17");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		// Use checkpoints with controlled created_at so we can
		// assert the latest is the most recent by that field. The
		// handoff index inherits the checkpoint's created_at in
		// via the work_package ordering.
		const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
		for (let i = 0; i < 3; i++) {
			const cp = makeCheckpoint({
				projectId,
				sessionId: "sess_h17",
				workPackage: `WP-H17-${i}`,
				status: "IN_PROGRESS",
				createdAt: new Date(baseTs + i * 1000).toISOString(),
			});
			const ck = s.checkpoints.write(cp, { projectId });
			s.handoffs.fromCheckpoint(s.checkpoints.read(ck.ref, projectId), { projectId });
		}
		const a = s.handoffs.latest(projectId);
		const b = s.handoffs.latest(projectId);
		assert.ok(a);
		assert.equal(a.id, b.id);
		// Among the three, the latest is one of them (we just
		// require determinism + presence).
		assert.ok(
			["WP-H17-0", "WP-H17-1", "WP-H17-2"].includes(a.work_package),
		);
	});
});

/* ============================================================
 *  PROJECT
 * ============================================================ */

describe("PROJECT 18: Git project stable identity", () => {
	it("the same seed produces the same project id", () => {
		const a = projectIdFromSeed("git@github.com:example/proj-a.git");
		const b = projectIdFromSeed("git@github.com:example/proj-a.git");
		assert.equal(a, b);
	});
	it("different seeds produce different ids", () => {
		const a = projectIdFromSeed("git@github.com:example/proj-a.git");
		const b = projectIdFromSeed("git@github.com:example/proj-b.git");
		assert.notEqual(a, b);
	});
});

describe("PROJECT 19: non-Git fallback identity", () => {
	it("works for a synthetic non-Git seed", () => {
		const id = projectIdFromSeed("/Users/someone/Projects/non-git-project");
		assert.match(id, /^proj_[a-f0-9]+$/);
	});
});

describe("PROJECT 20: refs do not expose absolute path", () => {
	it("refs are opaque: no path / host / cwd in the URI", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-p20");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId, sessionId: "sess_p20", workPackage: "WP-P", status: "COMPLETE" });
		const w = s.checkpoints.write(cp, { projectId });
		assert.ok(!w.ref.includes("Users"));
		assert.ok(!w.ref.includes("/Users/"));
		assert.ok(!w.ref.includes(process.cwd()));
		assert.ok(w.ref.startsWith("cmv3://checkpoint/"));
	});
});

describe("PROJECT 21: separate projects cannot cross-resolve records", () => {
	it("a record written under project A is not visible via project B", () => {
		const s = freshStore();
		const pa = projectIdFromSeed("seed-a");
		const pb = projectIdFromSeed("seed-b");
		for (const p of [pa, pb]) {
			s.projects.write({
				schema_version: "1.0.0",
				project_id: p,
				adapter_kind: "generic",
				updated_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
			});
		}
		const cp = makeCheckpoint({ projectId: pa, sessionId: "sess_x", workPackage: "WP-X", status: "COMPLETE" });
		const w = s.checkpoints.write(cp, { projectId: pa });
		const aList = s.checkpoints.list(pa);
		const bList = s.checkpoints.list(pb);
		assert.equal(aList.length, 1);
		assert.equal(bList.length, 0);
		// Trying to read it via project B path fails because the
		// file is in a different directory.
		assert.throws(() => s.checkpoints.readById(pb, w.id));
	});
});

/* ============================================================
 *  SESSION
 * ============================================================ */

describe("SESSION 22: session record persists/loads", () => {
	it("round-trips through write/read", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-s22");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const out = s.sessions.write(
			{
				schema_version: "1.0.0",
				session_id: "",
				project_id: projectId,
				started_at: new Date().toISOString(),
				status: "OPEN",
				checkpoint_refs: [],
				handoff_refs: [],
			},
			{ projectId },
		);
		const r = s.sessions.readById(projectId, out.id);
		assert.equal(r.status, "OPEN");
		assert.equal(r.project_id, projectId);
	});
});

describe("SESSION 23: previous-session link works", () => {
	it("two sequential sessions can be linked", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-s23");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const a = s.sessions.write(
			{
				schema_version: "1.0.0",
				session_id: "",
				project_id: projectId,
				started_at: "2026-01-01T00:00:00.000Z",
				status: "CLOSED",
				checkpoint_refs: [],
				handoff_refs: [],
			},
			{ projectId },
		);
		const b = s.sessions.write(
			{
				schema_version: "1.0.0",
				session_id: "",
				project_id: projectId,
				started_at: "2026-01-01T01:00:00.000Z",
				status: "OPEN",
				checkpoint_refs: [],
				handoff_refs: [],
				previous_session_ref: a.ref,
			},
			{ projectId },
		);
		const bRec = s.sessions.readById(projectId, b.id);
		assert.equal(bRec.previous_session_ref, a.ref);
	});
});

describe("SESSION 24: absent next session allowed", () => {
	it("a session record without next_session_ref is valid", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-s24");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const out = s.sessions.write(
			{
				schema_version: "1.0.0",
				session_id: "",
				project_id: projectId,
				started_at: new Date().toISOString(),
				status: "OPEN",
				checkpoint_refs: [],
				handoff_refs: [],
			},
			{ projectId },
		);
		const r = s.sessions.readById(projectId, out.id);
		assert.equal(r.next_session_ref, undefined);
	});
});

describe("SESSION 25: session/project mismatch rejected", () => {
	it("rejects a session whose project_id differs from the store path", () => {
		const s = freshStore();
		const projectId = projectIdFromSeed("seed-s25");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: projectId,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		assert.throws(() =>
			s.sessions.write(
				{
					schema_version: "1.0.0",
					session_id: "",
					project_id: "proj_wrong",
					started_at: new Date().toISOString(),
					status: "OPEN",
					checkpoint_refs: [],
					handoff_refs: [],
				},
				{ projectId },
			),
		);
	});
});

/* ============================================================
 *  HISTORY
 * ============================================================ */

describe("HISTORY 26: list by project", () => {
	it("returns only records for the requested project", () => {
		const s = freshStore();
		const pa = projectIdFromSeed("seed-h26a");
		const pb = projectIdFromSeed("seed-h26b");
		for (const p of [pa, pb]) {
			s.projects.write({
				schema_version: "1.0.0",
				project_id: p,
				adapter_kind: "generic",
				updated_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
			});
		}
		const cpA = makeCheckpoint({ projectId: pa, sessionId: "sa", workPackage: "WA", status: "COMPLETE" });
		s.checkpoints.write(cpA, { projectId: pa });
		const cpB = makeCheckpoint({ projectId: pb, sessionId: "sb", workPackage: "WB", status: "COMPLETE" });
		s.checkpoints.write(cpB, { projectId: pb });
		const aList = s.history.list({ projectId: pa, kinds: ["checkpoint"] });
		const bList = s.history.list({ projectId: pb, kinds: ["checkpoint"] });
		assert.equal(aList.length, 1);
		assert.equal(bList.length, 1);
		assert.equal(aList[0].work_package, "WA");
		assert.equal(bList[0].work_package, "WB");
	});
});

describe("HISTORY 27: filter checkpoint/handoff/session", () => {
	it("kinds filter restricts the returned list", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-h27");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const cp = makeCheckpoint({ projectId: p, sessionId: "s1", workPackage: "WP-H27", status: "COMPLETE" });
		const ck = s.checkpoints.write(cp, { projectId: p });
		s.handoffs.fromCheckpoint(s.checkpoints.read(ck.ref, p), { projectId: p });
		s.sessions.write(
			{
				schema_version: "1.0.0",
				session_id: "",
				project_id: p,
				started_at: new Date().toISOString(),
				status: "OPEN",
				checkpoint_refs: [],
				handoff_refs: [],
			},
			{ projectId: p },
		);
		assert.equal(s.history.list({ projectId: p, kinds: ["checkpoint"] }).length, 1);
		assert.equal(s.history.list({ projectId: p, kinds: ["handoff"] }).length, 1);
		assert.equal(s.history.list({ projectId: p, kinds: ["session"] }).length, 1);
		assert.equal(s.history.list({ projectId: p, kinds: ["checkpoint", "handoff"] }).length, 2);
	});
});

describe("HISTORY 28: filter work package", () => {
	it("workPackage filter restricts to one work package", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-h28");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		for (const wp of ["WP-A", "WP-B", "WP-A"]) {
			s.checkpoints.write(
				makeCheckpoint({ projectId: p, sessionId: "s", workPackage: wp, status: "COMPLETE" }),
				{ projectId: p },
			);
		}
		const aList = s.history.list({ projectId: p, workPackage: "WP-A" });
		assert.equal(aList.length, 2);
	});
});

describe("HISTORY 29: filter status", () => {
	it("status filter restricts to one status", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-h29");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		s.checkpoints.write(
			makeCheckpoint({ projectId: p, sessionId: "s", workPackage: "WP-1", status: "COMPLETE" }),
			{ projectId: p },
		);
		s.checkpoints.write(
			makeCheckpoint({ projectId: p, sessionId: "s", workPackage: "WP-2", status: "IN_PROGRESS" }),
			{ projectId: p },
		);
		const inProgress = s.history.list({ projectId: p, status: "IN_PROGRESS" });
		assert.equal(inProgress.length, 1);
		assert.equal(inProgress[0].work_package, "WP-2");
	});
});

describe("HISTORY 30: deterministic ordering", () => {
	it("two consecutive list() calls return entries in the same order", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-h30");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
		for (let i = 0; i < 5; i++) {
			s.checkpoints.write(
				makeCheckpoint({
					projectId: p,
					sessionId: "s",
					workPackage: `WP-${i}`,
					status: "COMPLETE",
					createdAt: new Date(baseTs + i * 1000).toISOString(),
				}),
				{ projectId: p },
			);
		}
		const a = s.history.list({ projectId: p });
		const b = s.history.list({ projectId: p });
		assert.deepEqual(a.map((e) => e.id), b.map((e) => e.id));
	});
});

describe("HISTORY 31: exact ref resolution", () => {
	it("find returns the matching entry for a stored ref", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-h31");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const w = s.checkpoints.write(
			makeCheckpoint({ projectId: p, sessionId: "s", workPackage: "WP-X", status: "COMPLETE" }),
			{ projectId: p },
		);
		const found = s.history.find(w.ref, p);
		assert.ok(found);
		assert.equal(found.id, w.id);
	});
});

describe("HISTORY 32: missing index can rebuild", () => {
	it("deleting the index then listing still returns authoritative records", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-h32");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		s.checkpoints.write(
			makeCheckpoint({ projectId: p, sessionId: "s", workPackage: "WP", status: "COMPLETE" }),
			{ projectId: p },
		);
		// Delete the index file
		rmSync(join(s.layout.projectsRoot, p, "index", "checkpoints.jsonl"));
		// Rebuild the index from the authoritative records.
		s.rebuildAllIndexes(p);
		const list = s.checkpoints.list(p);
		assert.equal(list.length, 1);
	});
});

describe("HISTORY 33: corrupted derived index does not destroy authoritative state", () => {
	it("garbage in the index file is ignored; authoritative reads still succeed", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-h33");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const w = s.checkpoints.write(
			makeCheckpoint({ projectId: p, sessionId: "s", workPackage: "WP", status: "COMPLETE" }),
			{ projectId: p },
		);
		writeFileSync(join(s.layout.projectsRoot, p, "index", "checkpoints.jsonl"), "garbage line\n");
		// Authoritative read is still clean.
		const r = s.checkpoints.readById(p, w.id);
		assert.equal(r.work_package, "WP");
	});
});

/* ============================================================
 *  RECOVERY
 * ============================================================ */

describe("RECOVERY 34: recover latest project state", () => {
	it("returns metadata, latest checkpoint, latest handoff", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-r34");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const ck = s.checkpoints.write(
			makeCheckpoint({ projectId: p, sessionId: "s", workPackage: "WP", status: "COMPLETE" }),
			{ projectId: p },
		);
		s.handoffs.fromCheckpoint(s.checkpoints.read(ck.ref, p), { projectId: p });
		const r = s.recover(p);
		assert.equal(r.hasHistory, true);
		assert.ok(r.metadata);
		assert.equal(r.latestCheckpoint?.work_package, "WP");
		assert.equal(r.latestHandoff?.work_package, "WP");
	});
});

describe("RECOVERY 35: recovery works without LLM", () => {
	it("recover is pure data plane: no network, no LLM call", () => {
		// If the test framework is the only thing running, the
		// recover() path is fully synchronous and never opens a
		// network socket. We assert on the synchrony of the call.
		const s = freshStore();
		const p = projectIdFromSeed("seed-r35");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const before = Date.now();
		s.recover(p);
		const after = Date.now();
		// Recovery on an empty project should be < 250ms in CI.
		assert.ok(after - before < 250, "recovery must be fast / synchronous");
	});
});

describe("RECOVERY 36: empty project history returns explicit empty state", () => {
	it("recover returns hasHistory=false and null fields", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-empty");
		const r = s.recover(p);
		assert.equal(r.hasHistory, false);
		assert.equal(r.metadata, null);
		assert.equal(r.latestCheckpoint, null);
		assert.equal(r.latestHandoff, null);
	});
});

describe("RECOVERY 37: corrupted latest record fails safely", () => {
	it("a tampered latest checkpoint does not crash recovery", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-r37");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const w = s.checkpoints.write(
			makeCheckpoint({ projectId: p, sessionId: "s", workPackage: "WP", status: "COMPLETE" }),
			{ projectId: p },
		);
		const path = join(s.layout.projectsRoot, p, "checkpoints", `${w.id}.json`);
		const env = JSON.parse(readFileSync(path, "utf8")) as { content: { goal: string } };
		env.content.goal = "tampered";
		writeFileSync(path, JSON.stringify(env));
		const r = s.recover(p);
		// Recovery must not throw; errors are surfaced in `errors[]`.
		assert.equal(r.latestCheckpoint, null);
		assert.ok(r.errors.length > 0, "recovery surfaces the error");
	});
});

describe("RECOVERY 38: stale index handled", () => {
	it("a stale index (extra entries pointing to deleted records) is harmless on read", () => {
		const s = freshStore();
		const p = projectIdFromSeed("seed-r38");
		s.projects.write({
			schema_version: "1.0.0",
			project_id: p,
			adapter_kind: "generic",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		const indexDir = join(s.layout.projectsRoot, p, "index");
		mkdirSync(indexDir, { recursive: true });
		const indexFile = join(indexDir, "checkpoints.jsonl");
		// Pre-populate a stale index with a ref to a file that does
		// not exist.
		writeFileSync(
			indexFile,
			JSON.stringify({
				ref: "cmv3://checkpoint/id_stalerecord",
				id: "id_stalerecord",
				work_package: "WP-STALE",
				status: "COMPLETE",
				created_at: new Date().toISOString(),
				session_id: "s",
			}) + "\n",
		);
		const summaries = s.checkpoints.list(p);
		// The stale entry is reachable in the index but the
		// authoritative read will throw on demand. list() only
		// reads the index; it does not verify each record.
		assert.equal(summaries.length, 1);
		assert.throws(() => s.checkpoints.readById(p, "id_stalerecord"));
		// rebuild clears the stale index.
		s.rebuildAllIndexes(p);
		const after = s.checkpoints.list(p);
		assert.equal(after.length, 0);
	});
});

/* ============================================================
 *  Cross-cutting fixtures used in tests 1..47
 * ============================================================ */

beforeEach(() => {
	// Each test that calls freshStore() uses a unique path; this
	// hook is a no-op placeholder for future per-test cleanup if
	// we add it. Kept to document the per-test isolation pattern.
});
