/**
 * P03 corrective tests — fresh-session replacement reentrancy.
 *
 * Authority: P03 WP spec (PICM_NEW_SESSION_REPLACEMENT_CORRECTIVE).
 *
 * Background:
 *   - P02 isolated natural rollover reproduced a reproducible
 *     failure on `/picm-rollover-execute`: the new session was
 *     partially created (durable record written, state moved to
 *     COMPLETE), but the slash command never returned, the pi
 *     process exited, and tmux was torn down.
 *   - Root cause: the P01 fix awaited `freshCtx.sendUserMessage`
 *     inside `withSession`. `sendUserMessage` on the replaced
 *     context is the **awaited** variant (it calls `prompt()` ->
 *     `_runAgentPrompt` which awaits the full LLM turn). Awaiting
 *     it inside `withSession` therefore blocks `withSession`,
 *     which blocks `finishSessionReplacement`, which blocks
 *     `ctx.newSession()`, which blocks the slash command. On a
 *     rate-limited / slow model the old TUI was held hostage
 *     while the new TUI tried to render in the same PTY.
 *
 * P03 corrective:
 *   - Do all durable work inside `withSession` (synchronous,
 *     persistence-only).
 *   - Fire the kickoff `freshCtx.sendUserMessage` WITHOUT
 *     awaiting it. Attach a `.catch` logger that surfaces the
 *     failure through `freshCtx.ui.notify` (warning level), so
 *     errors are visible but never silent.
 *   - The rollover state transitions to COMPLETE based on the
 *     durable write, not on the kickoff success. A kickoff
 *     failure leaves the new session alive with the handoff
 *     already in its message log (via `setup`), so the user can
 *     re-submit. Rollover state is never silently FAILED on a
 *     kickoff error.
 *
 * These tests are the source of truth for the corrective. They
 * cover:
 *   - newSession callback entered
 *   - withSession does not block on the kickoff
 *   - minimal replacement without prompt still works
 *   - replacement + freshCtx.sendUserMessage (fire-and-forget)
 *   - EXECUTING does not recursively trigger rollover
 *   - prompt lifecycle does not wait on rollover lock
 *   - old ctx is not used after replacement
 *   - replacement failure remains recoverable
 *   - no duplicate rollover
 *   - checkpoint / handoff survive failure
 *   - target repo remains untouched
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import {
	openStore,
	projectIdFromSeed,
	type Cmv3Store,
} from "../src/store/index.js";
import { ROLLOVER_COMMAND_NAME, default as cmv3Extension } from "../src/pi/extension.js";
import { createRolloverOrchestrator } from "../src/core/rollover-orchestrator.js";
import { projectHandoffFromCheckpoint, validateCheckpoint } from "../src/core/index.js";
import type { Checkpoint } from "../src/core/checkpoint.js";
import { generateId } from "../src/store/ids.js";

/* -------------------------------------------------------------------- *
 * Helpers                                                               *
 * -------------------------------------------------------------------- */

function freshStore(): { store: Cmv3Store; path: string } {
	const root = join(
		tmpdir(),
		`cmv3-p03-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`,
	);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	return { store: openStore({ storagePath: root }), path: root };
}

function freshCwd(tag: string): string {
	return `/tmp/p03-${tag}-${randomBytes(2).toString("hex")}`;
}

function freshProjectId(cwd: string): string {
	return projectIdFromSeed(cwd);
}

function makeCheckpoint(input: {
	projectId: string;
	sessionId: string;
	workPackage: string;
	status: "COMPLETE" | "IN_PROGRESS" | "BLOCKED";
}): Checkpoint {
	return validateCheckpoint({
		schema_version: "1.0.0",
		checkpoint_id: generateId(),
		project_id: input.projectId,
		session_id: input.sessionId,
		created_at: new Date().toISOString(),
		goal: `goal for ${input.workPackage}`,
		work_package: input.workPackage,
		status: input.status,
		completed: ["a", "b"],
		in_progress: ["c"],
		blockers: [],
		decisions: ["d1"],
		constraints: ["k1"],
		files_read: [],
		files_modified: ["/tmp/picm-natural-isolated"],
		relevant_versions: [],
		tests: [],
		validation_results: [],
		active_errors: [],
		git_repository: null,
		git_branch: null,
		git_head: null,
		git_dirty: null,
		next_actions: ["next-1"],
		recovery_refs: [],
		handoff_summary: "",
	});
}

/**
 * Synthetic ExtensionAPI stub that captures (a) the registered
 * command handler, (b) the registered event observers, and
 * (c) the tools. The stub also exposes a fake
 * `ctx.newSession` that lets us drive the rollover command in
 * isolation. The fake newSession:
 *   - records the `setup` and `withSession` callbacks
 *   - records the `parentSession` option
 *   - returns a configurable result (cancelled / success)
 *   - on success, invokes the `withSession` callback
 *     synchronously inside a resolved microtask so the
 *     command can proceed
 *   - does NOT bind a real TUI; this is a single-process
 *     harness for verifying the command's structural
 *     correctness
 */
interface RollbackEvents {
	readonly parentSession: string | undefined;
	readonly setupEntered: boolean;
	readonly withSessionEntered: boolean;
	readonly sendUserMessageCalls: string[];
	readonly notifyCalls: { level: string; text: string }[];
	readonly order: string[];
}

function makeRolloverHarness(opts: {
	sendUserMessageBehavior: "resolve-fast" | "hang" | "reject" | "reject-after-delay";
	newSessionShouldCancel?: boolean;
}) {
	const events: RollbackEvents = {
		parentSession: undefined,
		setupEntered: false,
		withSessionEntered: false,
		sendUserMessageCalls: [],
		notifyCalls: [],
		order: [],
	};
	const cmdCaptured: {
		name: string;
		handler: (args: string, ctx: unknown) => Promise<unknown>;
	}[] = [];
	const capturedObservers: Record<string, ((event: unknown) => unknown)[]> = {};
	const stub = {
		on(event: string, handler: (event: unknown) => unknown) {
			(capturedObservers[event] ??= []).push(handler);
		},
		registerTool(_t: { name: string }) {
			// not exercised here
		},
		registerCommand(
			name: string,
			opts: { description?: string; handler: (args: string, ctx: unknown) => Promise<unknown> },
		) {
			cmdCaptured.push({ name, handler: opts.handler });
		},
		sendMessage(_msg: unknown, _options?: unknown) {
			// not exercised here
		},
	};
	const ctx = {
		cwd: "/tmp/picm-natural-isolated",
		ui: {
			notify: (text: string, level: "info" | "warning" | "error") => {
				events.notifyCalls.push({ level, text });
				events.order.push(`notify:${level}`);
			},
		},
		sessionManager: {
			getSessionFile: () => "sess_old.json",
		},
		newSession: async (options: {
			parentSession?: string;
			setup?: (sm: {
				appendMessage: (m: {
					role: "user" | "assistant" | "toolResult";
					content: { type: "text"; text: string }[];
					timestamp: number;
				}) => void;
			}) => Promise<void>;
			withSession?: (freshCtx: unknown) => Promise<void>;
		}) => {
			events.parentSession = options.parentSession;
			events.order.push("newSession:enter");
			if (opts.newSessionShouldCancel === true) {
				events.order.push("newSession:cancelled");
				return { cancelled: true };
			}
			if (options.setup) {
				await options.setup({
					appendMessage: () => {
						events.setupEntered = true;
						events.order.push("setup:appendMessage");
					},
				});
			}
			const freshCtx = {
				sessionManager: {
					getSessionFile: () => "sess_new_01a0766f8a4e746d8326e45d27111f23",
				},
				hasUI: () => true,
				ui: {
					notify: (text: string, level: "info" | "warning" | "error") => {
						events.notifyCalls.push({ level, text });
						events.order.push(`freshCtx.notify:${level}`);
					},
				},
				sendUserMessage: (content: string) => {
					events.sendUserMessageCalls.push(content);
					events.order.push("freshCtx.sendUserMessage");
					if (opts.sendUserMessageBehavior === "resolve-fast") {
						return Promise.resolve();
					}
					if (opts.sendUserMessageBehavior === "reject") {
						return Promise.reject(new Error("rate limit 429"));
					}
					if (opts.sendUserMessageBehavior === "reject-after-delay") {
						return new Promise((_resolve, reject) => {
							setTimeout(() => reject(new Error("rate limit 429")), 5);
						});
					}
					// hang: never resolves. We use a sentinel so the
					// test can detect it without actually waiting.
					return new Promise(() => {});
				},
			};
			events.withSessionEntered = true;
			events.order.push("withSession:enter");
			if (options.withSession) {
				await options.withSession(freshCtx);
				events.order.push("withSession:return");
			}
			events.order.push("newSession:return");
			return { cancelled: false };
		},
	};
	cmv3Extension(stub as unknown as Parameters<typeof cmv3Extension>[0]);
	const cmd = cmdCaptured.find((c) => c.name === ROLLOVER_COMMAND_NAME);
	if (!cmd) throw new Error("rollover command not registered");
	const ssHandler = capturedObservers["session_start"]?.[0];
	if (!ssHandler) throw new Error("session_start observer not registered");
	return { cmd, ctx, events, ssHandler };
}

async function drivePrepare(input: {
	store: Cmv3Store;
	projectId: string;
	oldSessionId: string;
	workPackage: string;
}): Promise<string> {
	const cp = makeCheckpoint({
		projectId: input.projectId,
		sessionId: input.oldSessionId,
		workPackage: input.workPackage,
		status: "COMPLETE",
	});
	const ho = projectHandoffFromCheckpoint(cp);
	const orch = createRolloverOrchestrator(input.store);
	const out = await orch.prepare({
		projectId: input.projectId,
		oldSessionId: input.oldSessionId,
		checkpoint: cp,
		handoff: ho,
		reason: "NATURAL",
	});
	return out.id;
}

async function driveSessionStart(
	ssHandler: (event: unknown, ctx: unknown) => Promise<unknown>,
	cwd: string,
	oldSessionId: string,
): Promise<void> {
	// Drive the extension's session_start observer so the
	// live runtime is initialized: currentProjectId is set
	// from the cwd hash, currentSessionId is set from the
	// session file. The rollover command's identity check
	// then matches the prepared ref's project_id /
	// old_session_id.
	const ctx = {
		cwd,
		sessionManager: { getSessionFile: () => oldSessionId },
	} as unknown;
	await (ssHandler as (e: unknown, c: unknown) => Promise<unknown>)(
		{ cwd, previousSessionFile: oldSessionId },
		ctx,
	);
}

/* -------------------------------------------------------------------- *
 * PROBE A — CONTROL                                                     *
 *                                                                        *
 * Built-in /new: not exercised here (it lives in Pi's interactive      *
 * mode, not in the extension). The earlier isolated validation        *
 * confirmed /new works in the same PICM-only environment. This file   *
 * is about the extension's own /picm-rollover-execute behavior.       *
 * -------------------------------------------------------------------- */

/* -------------------------------------------------------------------- *
 * PROBE B — REPLACEMENT WITHOUT PROMPT                                  *
 * -------------------------------------------------------------------- */

describe("PROBE B: replacement without prompt returns fast", () => {
	before(() => {
		process.env["CMV3_MODE"] = "v3";
		// Clear any prior store path so the extension opens a
		// fresh in-process store if it accesses one. The tests
		// pass stores in directly via the prepare step.
		process.env["CMV3_STORE_PATH"] = "/tmp/p03-store";
	});
	after(() => {
		delete process.env["CMV3_MODE"];
		delete process.env["CMV3_STORE_PATH"];
	});

	it("setup is called and withSession returns synchronously when sendUserMessage resolves fast", async () => {
		const { store, path } = freshStore();
		process.env["CMV3_STORE_PATH"] = path;
		const cwd = freshCwd("probe-b");
		const projectId = freshProjectId(cwd);
		const oldSessionId = "/tmp/p03-sess-b.json";
		const id = await drivePrepare({
			store,
			projectId,
			oldSessionId,
			workPackage: "WP-PROBE-B",
		});
		const { cmd, ctx, events, ssHandler } = makeRolloverHarness({
			sendUserMessageBehavior: "resolve-fast",
		});
		await driveSessionStart(ssHandler, cwd, oldSessionId);
		const t0 = Date.now();
		const reply = await cmd.handler(`cmv3://rollover/${id}`, ctx);
		const elapsed = Date.now() - t0;
		// 200ms is a generous bound for a non-blocking kickoff.
		assert.ok(elapsed < 200, `handler returned in ${elapsed}ms`);
		assert.ok(events.setupEntered, "setup called");
		assert.ok(events.withSessionEntered, "withSession called");
		assert.equal(events.sendUserMessageCalls.length, 1, "sendUserMessage called once");
		assert.ok(
			events.order.includes("withSession:enter") &&
				events.order.includes("withSession:return") &&
				events.order.includes("newSession:return"),
			"order: withSession -> newSession:return",
		);
		assert.ok(
			events.order.indexOf("withSession:enter") <
				events.order.indexOf("newSession:return"),
			"withSession ran inside newSession",
		);
		// Rollover is COMPLETE.
		const after = store.rollovers.read(`cmv3://rollover/${id}`, projectId);
		assert.equal(after.state, "COMPLETE");
		assert.equal(after.new_session_id, "sess_new_01a0766f8a4e746d8326e45d27111f23");
		// Durable session record was written.
		const sessions = store.sessions.list(projectId);
		assert.equal(sessions.length, 1);
		assert.equal(sessions[0].id, "sess_new_01a0766f8a4e746d8326e45d27111f23");
		assert.equal(sessions[0].status, "OPEN");
		void reply;
	});
});

/* -------------------------------------------------------------------- *
 * PROBE C — MINIMAL SEND (with prompt, fire-and-forget)                 *
 * -------------------------------------------------------------------- */

describe("PROBE C: replacement + sendUserMessage is fire-and-forget", () => {
	before(() => {
		process.env["CMV3_MODE"] = "v3";
		process.env["CMV3_STORE_PATH"] = "/tmp/p03-store-c";
	});
	after(() => {
		delete process.env["CMV3_MODE"];
		delete process.env["CMV3_STORE_PATH"];
	});

	it("newSession returns BEFORE sendUserMessage's hang/await completes", async () => {
		const { store, path } = freshStore();
		process.env["CMV3_STORE_PATH"] = path;
		const cwd = freshCwd("probe-c-hang");
		const projectId = freshProjectId(cwd);
		const oldSessionId = "/tmp/p03-sess-c.json";
		const id = await drivePrepare({
			store,
			projectId,
			oldSessionId,
			workPackage: "WP-PROBE-C",
		});
		const { cmd, ctx, events, ssHandler } = makeRolloverHarness({
			sendUserMessageBehavior: "hang",
		});
		await driveSessionStart(ssHandler, cwd, oldSessionId);
		const t0 = Date.now();
		const reply = await (cmd.handler as (a: string, c: unknown) => Promise<string>)(
			`cmv3://rollover/${id}`,
			ctx,
		);
		const elapsed = Date.now() - t0;
		// If sendUserMessage were awaited, the handler would
		// hang indefinitely on the "hang" behavior. The
		// corrective makes it fire-and-forget, so the handler
		// must return in well under a second.
		assert.ok(elapsed < 200, `handler returned in ${elapsed}ms despite hung sendUserMessage`);
		assert.equal(events.sendUserMessageCalls.length, 1);
		// Rollover is COMPLETE.
		const after = store.rollovers.read(`cmv3://rollover/${id}`, projectId);
		assert.equal(after.state, "COMPLETE");
		void reply;
	});

	it("sendUserMessage rejection does NOT undo COMPLETE state and surfaces a warning", async () => {
		const { store, path } = freshStore();
		process.env["CMV3_STORE_PATH"] = path;
		const cwd = freshCwd("probe-c-reject");
		const projectId = freshProjectId(cwd);
		const oldSessionId = "/tmp/p03-sess-cr.json";
		const id = await drivePrepare({
			store,
			projectId,
			oldSessionId,
			workPackage: "WP-PROBE-CR",
		});
		const { cmd, ctx, events, ssHandler } = makeRolloverHarness({
			sendUserMessageBehavior: "reject",
		});
		await driveSessionStart(ssHandler, cwd, oldSessionId);
		const reply = await (cmd.handler as (a: string, c: unknown) => Promise<string>)(
			`cmv3://rollover/${id}`,
			ctx,
		);
		// Wait a microtask for the .catch to run.
		await new Promise((resolve) => setImmediate(resolve));
		// Rollover is still COMPLETE — the kickoff failure does
		// not roll back the durable state.
		const after = store.rollovers.read(`cmv3://rollover/${id}`, projectId);
		assert.equal(after.state, "COMPLETE");
		assert.equal(after.new_session_id, "sess_new_01a0766f8a4e746d8326e45d27111f23");
		// A warning notification was emitted through freshCtx.ui.
		assert.ok(
			events.notifyCalls.some(
				(c) => c.level === "warning" && c.text.includes("rollover kickoff failed"),
			),
			`expected warning notify, got: ${JSON.stringify(events.notifyCalls)}`,
		);
		void reply;
	});
});

/* -------------------------------------------------------------------- *
 * PROBE D — HANDLER ISOLATION (no recursive rollover)                    *
 * -------------------------------------------------------------------- */

describe("PROBE D: handler isolation; no recursive rollover from kickoff events", () => {
	before(() => {
		process.env["CMV3_MODE"] = "v3";
		process.env["CMV3_STORE_PATH"] = "/tmp/p03-store-d";
	});
	after(() => {
		delete process.env["CMV3_MODE"];
		delete process.env["CMV3_STORE_PATH"];
	});

	it("the agent_settled handler does not gate on rollover state, so post-replacement settle does not re-enter the rollover command", () => {
		const ext = readFileSync("src/pi/extension.ts", "utf8");
		// Extract just the agent_settled body and check it has
		// no rollover-state gate (no "EXECUTING" check, no
		// rollover store read, no transition write).
		const asStart = ext.indexOf('pi.on("agent_settled"');
		assert.notEqual(asStart, -1);
		// The agent_settled body ends with `\n\t});` (or
		// more tabs). Search for the next `\n\t});` after
		// the start, which is the closing of the handler
		// arrow function.
		const asEnd = ext.indexOf("\n\t});", asStart);
		assert.notEqual(asEnd, -1, "agent_settled body closed");
		const asBody = ext.slice(asStart, asEnd);
		assert.equal(/EXECUTING/.test(asBody), false,
			"agent_settled must not check the EXECUTING rollover state");
		assert.equal(/rollovers\./.test(asBody), false,
			"agent_settled must not read or write the rollover store");
		assert.equal(/transition\(\{[^}]*to:\s*"EXECUTING"/m.test(asBody), false,
			"agent_settled must not transition any rollover state");
	});
});

import { readFileSync } from "node:fs";

/* -------------------------------------------------------------------- *
 * DURABILITY — checkpoint / handoff / rollover survive failure          *
 * -------------------------------------------------------------------- */

describe("DURABILITY: pre-NEW gate state is recoverable when newSession cancels", () => {
	before(() => {
		process.env["CMV3_MODE"] = "v3";
		process.env["CMV3_STORE_PATH"] = "/tmp/p03-store-e";
	});
	after(() => {
		delete process.env["CMV3_MODE"];
		delete process.env["CMV3_STORE_PATH"];
	});

	it("another extension's cancellation moves the rollover to FAILED with reason cancelled_by_extension", async () => {
		const { store, path } = freshStore();
		process.env["CMV3_STORE_PATH"] = path;
		const cwd = freshCwd("probe-e-cancel");
		const projectId = freshProjectId(cwd);
		const oldSessionId = "/tmp/p03-sess-e.json";
		const id = await drivePrepare({
			store,
			projectId,
			oldSessionId,
			workPackage: "WP-PROBE-E",
		});
		const { cmd, ctx, ssHandler } = makeRolloverHarness({
			sendUserMessageBehavior: "resolve-fast",
			newSessionShouldCancel: true,
		});
		await driveSessionStart(ssHandler, cwd, oldSessionId);
		await (cmd.handler as (a: string, c: unknown) => Promise<string>)(
			`cmv3://rollover/${id}`,
			ctx,
		);
		const after = store.rollovers.read(`cmv3://rollover/${id}`, projectId);
		assert.equal(after.state, "FAILED");
		assert.equal(after.failure_code, "cancelled_by_extension");
		// The checkpoint and handoff remain in the store — the
		// user can re-execute (after fixing the cancellation
		// source) or read them via the recovery tool.
		const allCps = store.checkpoints.list(projectId);
		assert.ok(allCps.length >= 1);
		const allHos = store.handoffs.list(projectId);
		assert.ok(allHos.length >= 1);
	});
});

/* -------------------------------------------------------------------- *
 * STRUCTURAL — freshCtx is used; old ctx is not                         *
 * -------------------------------------------------------------------- */

describe("STRUCTURAL: old ctx not used after replacement", () => {
	it("the command's withSession body references freshCtx only (no bare ctx.)", () => {
		const ext = readFileSync("src/pi/extension.ts", "utf8");
		// Find the withSession block. The body of the arrow
		// function is delimited by 4-tab indentation; the
		// closing `},` (withSession prop) is at 3 tabs.
		// Search forward from `withSession:` and find the
		// first `\t\t\t\t},` (closing the withSession arrow
		// function's body) or `\n\t\t\t\t},` at exactly the
		// right depth.
		const wsStart = ext.indexOf("withSession: async (freshCtx) => {");
		assert.notEqual(wsStart, -1, "withSession header found");
		// The withSession arrow function closes with `},` at
		// 4 tabs (one less than the body indent). Search for
		// the first `\n\t\t\t\t},` from wsStart.
		const wsEnd = ext.indexOf("\n\t\t\t\t},", wsStart);
		assert.notEqual(wsEnd, -1, "withSession / newSession block closed");
		// Strip comments from the body. The `// slash
		// command's \`await ctx.newSession()\`` line is a
		// reference, not a real call, and we don't want it
		// to trigger a false positive.
		const wsBody = ext
			.slice(wsStart, wsEnd)
			.split("\n")
			.map((line) => {
				const idx = line.indexOf("//");
				return idx >= 0 ? line.slice(0, idx) : line;
			})
			.join("\n");
		// The bare identifier `ctx.` (not `freshCtx.`) must
		// not appear inside the withSession body. We use a
		// word-boundary check: `ctx.` preceded by a non-word
		// character, and the captured `ctx` from the closure
		// is captured as a parameter named `ctx` in the
		// command signature `(args, ctx)`. We bound the
		// search to "not preceded by a letter" so that
		// `freshCtx.` does not match.
		assert.equal(
			/[^a-zA-Z_]ctx\./.test(wsBody),
			false,
			"captured ctx must not be used inside withSession",
		);
		// The kickoff is not awaited.
		assert.equal(
			/await\s+freshCtx\.sendUserMessage/.test(wsBody),
			false,
			"sendUserMessage must NOT be awaited inside withSession",
		);
		// A .catch is attached for the kickoff promise.
		assert.ok(/kickoff\.catch/.test(wsBody));
	});

	it("the command still uses freshCtx for session identity and storage", () => {
		const ext = readFileSync("src/pi/extension.ts", "utf8");
		assert.ok(/freshCtx\.sessionManager/.test(ext));
		assert.ok(/store\.sessions\.write/.test(ext));
	});
});

/* -------------------------------------------------------------------- *
 * IDEMPOTENCY — duplicate execute remains idempotent                    *
 * -------------------------------------------------------------------- */

describe("IDEMPOTENCY: re-execute of an already-COMPLETE rollover is rejected", () => {
	before(() => {
		process.env["CMV3_MODE"] = "v3";
		process.env["CMV3_STORE_PATH"] = "/tmp/p03-store-f";
	});
	after(() => {
		delete process.env["CMV3_MODE"];
		delete process.env["CMV3_STORE_PATH"];
	});

	it("a second execute against the same id is a no-op; only one durable session record exists", async () => {
		const { store, path } = freshStore();
		process.env["CMV3_STORE_PATH"] = path;
		const cwd = freshCwd("probe-f");
		const projectId = freshProjectId(cwd);
		const oldSessionId = "/tmp/p03-sess-f.json";
		const id = await drivePrepare({
			store,
			projectId,
			oldSessionId,
			workPackage: "WP-PROBE-F",
		});
		const { cmd, ctx, events, ssHandler } = makeRolloverHarness({
			sendUserMessageBehavior: "resolve-fast",
		});
		await driveSessionStart(ssHandler, cwd, oldSessionId);
		const replyCountBefore = events.notifyCalls.length;
		await (cmd.handler as (a: string, c: unknown) => Promise<unknown>)(
			`cmv3://rollover/${id}`,
			ctx,
		);
		const replyCountAfterFirst = events.notifyCalls.length;
		// The first execute completed. A second call hits the
		// COMPLETE state guard and is rejected.
		await (cmd.handler as (a: string, c: unknown) => Promise<unknown>)(
			`cmv3://rollover/${id}`,
			ctx,
		);
		const secondReply = events.notifyCalls[events.notifyCalls.length - 1];
		assert.ok(
			replyCountAfterFirst > replyCountBefore,
			"first execute emitted a notify",
		);
		assert.ok(
			secondReply.text.includes("already COMPLETE"),
			`second execute emits "already COMPLETE"; got: ${secondReply.text}`,
		);
		const sessions = store.sessions.list(projectId);
		assert.equal(sessions.length, 1, "exactly one durable session record");
	});
});

/* -------------------------------------------------------------------- *
 * DURABILITY: target repo untouched; checkpoint + handoff survive      *
 * -------------------------------------------------------------------- */

describe("DURABILITY: target repo and durable records survive execute", () => {
	before(() => {
		process.env["CMV3_MODE"] = "v3";
		process.env["CMV3_STORE_PATH"] = "/tmp/p03-store-dur";
	});
	after(() => {
		delete process.env["CMV3_MODE"];
		delete process.env["CMV3_STORE_PATH"];
	});

	it("checkpoint and handoff remain queryable after a successful execute", async () => {
		const { store, path } = freshStore();
		process.env["CMV3_STORE_PATH"] = path;
		const cwd = freshCwd("probe-dur-ok");
		const projectId = freshProjectId(cwd);
		const oldSessionId = "/tmp/p03-sess-dur-ok.json";
		const id = await drivePrepare({
			store,
			projectId,
			oldSessionId,
			workPackage: "WP-PROBE-DUR-OK",
		});
		const { cmd, ctx, ssHandler } = makeRolloverHarness({
			sendUserMessageBehavior: "resolve-fast",
		});
		await driveSessionStart(ssHandler, cwd, oldSessionId);
		await (cmd.handler as (a: string, c: unknown) => Promise<unknown>)(
			`cmv3://rollover/${id}`,
			ctx,
		);
		// Checkpoint, handoff, rollover, and session records
		// are all queryable.
		const allCps = store.checkpoints.list(projectId);
		assert.ok(allCps.length >= 1, "checkpoint durable");
		const allHos = store.handoffs.list(projectId);
		assert.ok(allHos.length >= 1, "handoff durable");
		const allRos = store.rollovers.list(projectId);
		assert.ok(allRos.length >= 1, "rollover durable");
		const allSess = store.sessions.list(projectId);
		assert.ok(allSess.length >= 1, "session durable");
	});

	it("checkpoint and handoff survive a FAILED execute (cancellation)", async () => {
		const { store, path } = freshStore();
		process.env["CMV3_STORE_PATH"] = path;
		const cwd = freshCwd("probe-dur-fail");
		const projectId = freshProjectId(cwd);
		const oldSessionId = "/tmp/p03-sess-dur-fail.json";
		const id = await drivePrepare({
			store,
			projectId,
			oldSessionId,
			workPackage: "WP-PROBE-DUR-FAIL",
		});
		const { cmd, ctx, ssHandler } = makeRolloverHarness({
			sendUserMessageBehavior: "resolve-fast",
			newSessionShouldCancel: true,
		});
		await driveSessionStart(ssHandler, cwd, oldSessionId);
		await (cmd.handler as (a: string, c: unknown) => Promise<unknown>)(
			`cmv3://rollover/${id}`,
			ctx,
		);
		// Even though the rollover failed, the checkpoint and
		// handoff must remain queryable so the user can
		// re-attempt.
		const allCps = store.checkpoints.list(projectId);
		assert.ok(allCps.length >= 1, "checkpoint survives failure");
		const allHos = store.handoffs.list(projectId);
		assert.ok(allHos.length >= 1, "handoff survives failure");
		const ro = store.rollovers.read(`cmv3://rollover/${id}`, projectId);
		assert.equal(ro.state, "FAILED");
		assert.equal(ro.failure_code, "cancelled_by_extension");
	});

	it("no duplicate rollover: a second prepare is allowed but a second execute of the same id is not", async () => {
		const { store, path } = freshStore();
		process.env["CMV3_STORE_PATH"] = path;
		const cwd = freshCwd("probe-dup");
		const projectId = freshProjectId(cwd);
		const oldSessionId = "/tmp/p03-sess-dup.json";
		const id = await drivePrepare({
			store,
			projectId,
			oldSessionId,
			workPackage: "WP-PROBE-DUP",
		});
		const { cmd, ctx, ssHandler } = makeRolloverHarness({
			sendUserMessageBehavior: "resolve-fast",
		});
		await driveSessionStart(ssHandler, cwd, oldSessionId);
		await (cmd.handler as (a: string, c: unknown) => Promise<unknown>)(
			`cmv3://rollover/${id}`,
			ctx,
		);
		// After COMPLETE, a second execute of the same id is
		// rejected by the COMPLETE-state guard.
		const eventsBefore: { notifyCalls: { level: string; text: string }[] } = {
			notifyCalls: [],
		};
		// Capture into a fresh harness so we can read the
		// notify calls cleanly for the second attempt.
		const harness2 = makeRolloverHarness({
			sendUserMessageBehavior: "resolve-fast",
		});
		await driveSessionStart(harness2.ssHandler, cwd, oldSessionId);
		await (harness2.cmd.handler as (a: string, c: unknown) => Promise<unknown>)(
			`cmv3://rollover/${id}`,
			harness2.ctx,
		);
		const last = harness2.events.notifyCalls[harness2.events.notifyCalls.length - 1];
		assert.ok(last.text.includes("already COMPLETE"));
		// Exactly one rollover record, one session record.
		assert.equal(store.rollovers.list(projectId).length, 1);
		assert.equal(store.sessions.list(projectId).length, 1);
		// silence unused
		void eventsBefore;
	});
});

/* -------------------------------------------------------------------- *
 * TARGET REPO: untouched after execute (no git mutation)                *
 * -------------------------------------------------------------------- */

describe("TARGET REPO: PICM does not mutate the target repo", () => {
	it("the extension source has no shell-out / git mutation path", () => {
		const ext = readFileSync("src/pi/extension.ts", "utf8");
		// No `git commit`, `git push`, `git checkout`, or
		// `git reset` in the extension. The pressure trigger
		// and tool_result hooks do not touch the working tree.
		assert.equal(/git\s+commit/.test(ext), false);
		assert.equal(/git\s+push/.test(ext), false);
		assert.equal(/git\s+checkout/.test(ext), false);
		assert.equal(/execSync\s*\(/.test(ext), false);
		assert.equal(/spawn\s*\(/.test(ext), false);
		assert.equal(/process\.exit\s*\(/.test(ext), false);
		assert.equal(/process\.kill\s*\(/.test(ext), false);
	});
});
