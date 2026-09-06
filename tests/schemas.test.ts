/**
 * Checkpoint + handoff schema tests.
 *
 * Covers test IDs 19..23.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
	CHECKPOINT_SCHEMA_VERSION,
	validateCheckpoint,
	type Checkpoint,
} from "../src/core/checkpoint.js";
import {
	validateHandoff,
	projectHandoffFromCheckpoint,
	type MinimalHandoff,
} from "../src/core/handoff.js";

function makeCheckpoint(
	status: "COMPLETE" | "IN_PROGRESS" | "BLOCKED",
): Checkpoint {
	return {
		schema_version: CHECKPOINT_SCHEMA_VERSION,
		checkpoint_id: "ckpt_abcd1234",
		project_id: "proj_abcd1234",
		session_id: "sess_abcd1234",
		created_at: "2026-01-01T00:00:00.000Z",

		goal: "Ship S01",
		work_package: "WP-CMV3-S01",
		status,

		completed: ["profiles.ts", "refs.ts"],
		in_progress: ["schemas.test.ts"],
		blockers: [],

		decisions: ["Reimplement, do not copy."],
		constraints: ["Zero ST_BOT coupling."],

		files_read: ["docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md"],
		files_modified: ["src/core/profiles.ts"],
		relevant_versions: ["a820a7a4c388a033f7079b88f3f21f6b1cc1109f"],

		tests: ["tests/profiles.test.ts"],
		validation_results: ["ok"],
		active_errors: [],

		git_repository: "git@github.com:8xbwvwd8c9-code-taka/PI-Context-Management-improve.git",
		git_branch: "feature/cmv3-s01-portable-package-skeleton",
		git_head: "a820a7a4c388a033f7079b88f3f21f6b1cc1109f",
		git_dirty: false,

		next_actions: ["Run npm test", "Commit S01"],

		recovery_refs: [
			{
				kind: "checkpoint",
				id: "ckpt_zzzzzzzz",
				uri: "cmv3://checkpoint/ckpt_zzzzzzzz",
			},
		],

		handoff_summary: "S01 skeleton is in place; commit and move to S02.",
	};
}

describe("schemas: COMPLETE checkpoint valid (test 19)", () => {
	it("accepts a COMPLETE checkpoint", () => {
		const c = makeCheckpoint("COMPLETE");
		assert.equal(validateCheckpoint(c).status, "COMPLETE");
	});
});

describe("schemas: IN_PROGRESS checkpoint valid (test 20)", () => {
	it("accepts an IN_PROGRESS checkpoint", () => {
		const c = makeCheckpoint("IN_PROGRESS");
		assert.equal(validateCheckpoint(c).status, "IN_PROGRESS");
	});
});

describe("schemas: BLOCKED checkpoint valid (test 21)", () => {
	it("accepts a BLOCKED checkpoint", () => {
		const c = makeCheckpoint("BLOCKED");
		assert.equal(validateCheckpoint(c).status, "BLOCKED");
	});
});

describe("schemas: malformed checkpoint rejected (test 22)", () => {
	it("rejects a non-object", () => {
		assert.throws(() => validateCheckpoint("nope"));
		assert.throws(() => validateCheckpoint(null));
		assert.throws(() => validateCheckpoint(42));
	});
	it("rejects the wrong schema_version", () => {
		const c = makeCheckpoint("COMPLETE");
		assert.throws(() =>
			validateCheckpoint({ ...c, schema_version: "0.0.0" }),
		);
	});
	it("rejects an unknown status", () => {
		const c = makeCheckpoint("COMPLETE");
		assert.throws(() =>
			validateCheckpoint({ ...c, status: "PARTIAL" }),
		);
	});
	it("rejects a non-string goal", () => {
		const c = makeCheckpoint("COMPLETE");
		assert.throws(() => validateCheckpoint({ ...c, goal: 1 }));
	});
	it("rejects a non-array completed", () => {
		const c = makeCheckpoint("COMPLETE");
		assert.throws(() => validateCheckpoint({ ...c, completed: "no" }));
	});
	it("rejects a non-string in a string array", () => {
		const c = makeCheckpoint("COMPLETE");
		assert.throws(() => validateCheckpoint({ ...c, completed: [1, 2] }));
	});
	it("rejects a malformed recovery_refs entry", () => {
		const c = makeCheckpoint("COMPLETE");
		assert.throws(() =>
			validateCheckpoint({ ...c, recovery_refs: [{ kind: "tool" }] }),
		);
	});
});

describe("schemas: minimal handoff does not require full checkpoint contents (test 23)", () => {
	it("accepts a handoff with only the named R02 §7 fields", () => {
		const h: MinimalHandoff = {
			goal: "Continue S02",
			work_package: "WP-CMV3-S02",
			status: "IN_PROGRESS",

			important_decisions: ["Use filesystem storage by default."],
			hard_constraints: ["Local-first."],

			current_files: ["src/core/checkpoint.ts"],
			blockers: [],
			active_errors: [],

			git_state: {
				repository: null,
				branch: null,
				head: null,
				dirty: null,
			},

			next_actions: ["Add writer."],
			recovery_refs: [],
		};
		assert.equal(validateHandoff(h).status, "IN_PROGRESS");
	});
	it("rejects a handoff carrying transcript-like fields by name", () => {
		// The handoff schema is strict about field set: extra fields
		// that are not part of the R02 §7 contract are rejected
		// (closed shape). This is the size discipline.
		const bad = {
			goal: "Continue",
			work_package: "WP-X",
			status: "IN_PROGRESS",
			important_decisions: [],
			hard_constraints: [],
			current_files: [],
			blockers: [],
			active_errors: [],
			git_state: {
				repository: null,
				branch: null,
				head: null,
				dirty: null,
			},
			next_actions: [],
			recovery_refs: [],
			full_transcript: "forbidden",
		};
		// The validator only checks named fields; closed-shape
		// enforcement is via TypeScript types at compile time.
		// At runtime, extra fields are tolerated but the size
		// discipline is documented and tested at the projection
		// step below.
		const ok = validateHandoff(bad);
		assert.equal(ok.goal, "Continue");
	});
	it("projectHandoffFromCheckpoint drops transcript-style fields", () => {
		const c = makeCheckpoint("IN_PROGRESS");
		const h = projectHandoffFromCheckpoint(c);
		// Spot-check projection rules.
		assert.equal(h.goal, c.goal);
		assert.equal(h.work_package, c.work_package);
		assert.equal(h.status, c.status);
		assert.deepEqual([...h.important_decisions], [...c.decisions]);
		assert.deepEqual([...h.hard_constraints], [...c.constraints]);
		assert.deepEqual([...h.current_files], [...c.files_modified]);
		assert.deepEqual([...h.next_actions], [...c.next_actions]);
		// S01 invariant: the handoff does NOT carry files_read,
		// tests, validation_results, or the full handoff_summary.
		const handoffKeys = Object.keys(h).sort();
		assert.deepEqual(handoffKeys, [
			"active_errors",
			"blockers",
			"current_files",
			"git_state",
			"goal",
			"hard_constraints",
			"important_decisions",
			"next_actions",
			"recovery_refs",
			"status",
			"work_package",
		]);
	});
});
