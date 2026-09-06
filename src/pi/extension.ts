/**
 * Pi runtime extension — S05 live runtime integration.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §9, §10.
 *            docs/LIVE_RUNTIME.md (S05).
 *
 * S05 contract (additive over S04):
 *   - registers one live `tool_result` hook (v3 mode only;
 *     legacy / v3-observe are pass-through or observe-only)
 *   - persists full authoritative tool result before replacing
 *     active content (PERSIST BEFORE REPLACE)
 *   - returns the bounded active view to the LLM; full result
 *     remains recoverable via the `cmv3://tool/<id>` ref
 *   - registers one agent-callable recovery tool
 *     (`picm_recover`); the tool accepts the opaque ref and
 *     bounded range args; it refuses arbitrary filesystem paths
 *   - on `agent_settled`, computes pressure from the live
 *     `ctx.getContextUsage()` (cap-driven profile selection;
 *     does NOT hardcode 32K)
 *   - never calls `ctx.newSession()` from the tool_result hook
 *     or the recovery tool; only the S04 command does
 *   - never calls the native compact entrypoint on the runtime
 *     context; never modifies native Pi compaction
 *   - never captures a stale `pi` or command `ctx` after
 *     `await ctx.newSession()`; post-replacement work is done
 *     through `withSession(freshCtx)` and the fresh context only
 *
 * The extension is the only S05 surface. S04's surface is
 * preserved bit-for-bit:
 *   - one `picm_prepare_rollover` tool
 *   - one `/picm-rollover-execute` command
 *   - one `session_start` event observer
 *   - one `agent_settled` event observer
 *   - one `tool_result` event observer (NEW in S05)
 *   - one `picm_recover` tool (NEW in S05)
 *
 * `package:check` and the S04 acceptance matrix in
 * `tests/rollover.test.ts` must remain green.
 */

import type {
	ExtensionAPI,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

import { openStore, type Cmv3Store } from "../store/index.js";
import { generateId } from "../store/ids.js";
import {
	buildHydrationPayload,
	createRolloverOrchestrator,
	projectHandoffFromCheckpoint,
	requireRolloverRef,
	resolveConfig,
} from "../core/index.js";
import { LOCAL_32K_PROFILE } from "../core/index.js";

import { RECOVERY_TOOL_NAME, executePicmRecover } from "./recovery-tool.js";
import {
	computeLivePressure,
	LIVE_PRESSURE_HOOK_NAME,
} from "./pressure-live.js";
import {
	LIVE_SESSION_START_HOOK_NAME,
	resolveLiveRuntime,
} from "./session-init.js";
import {
	consoleDiagnosticSink,
	reconcileInterruptedRollovers,
	type JsonlParentScanner,
} from "./reconcile.js";
import { createFsJsonlParentScanner } from "./jsonl-parent-scanner.js";
import {
	failOpenForPersistenceError,
	virtualizeToolResult,
	type LiveToolResultInput,
} from "./tool-result-live.js";
import {
	classifyPrepareOutcome,
	shouldTriggerPressureRollover,
	PressureTriggerMachine,
} from "./pressure-trigger.js";
import { RolloverOrchestratorError } from "../core/rollover-orchestrator.js";
import type { ResolvedCMV3Config } from "../core/config.js";
import type { ContextProfile } from "../core/profiles.js";
import {
	ToolResultAccessError,
	ToolResultPersistenceError,
} from "../store/tool-result-store.js";

/** Package identity. Mirrored from package.json for runtime introspection. */
export const PACKAGE_NAME = "pi-context-management-improve";
export const PACKAGE_VERSION = "1.0.1";
export const PACKAGE_PHASE = "P02-CROSS-PROJECT-PORTABILITY-V1";

/**
 * The slash command that owns the `ctx.newSession` call. The
 * command receives only an opaque rollover request id; the rest
 * of the rollover state is loaded from the durable store by the
 * orchestrator.
 */
export const ROLLOVER_COMMAND_NAME = "picm-rollover-execute";

/**
 * The custom tool that prepares a rollover. The tool is callable
 * by the LLM; the tool NEVER calls `ctx.newSession()`. It only
 * persists state and returns the opaque request id.
 */
export const ROLLOVER_TOOL_NAME = "picm_prepare_rollover";

/**
 * The custom tool that recovers a tool result. The tool is
 * callable by the LLM; the tool NEVER calls newSession, the
 * native compact entrypoint, or any other session-mutating API.
 * The tool accepts ONLY a `cmv3://tool/<id>` ref (or bare id)
 * and bounded range args; it refuses arbitrary paths.
 */
export { RECOVERY_TOOL_NAME };

/**
 * Default export. Wired as a Pi extension entrypoint per
 * `pi.extensions` in package.json.
 */
export default function cmv3Extension(pi: ExtensionAPI): void {
	// Per-extension instance state. The Pi runtime is responsible
	// for not loading the same extension twice; this state lives
	// for the lifetime of one extension instance.
	let storeRef: Cmv3Store | null = null;
	const getStore = (): Cmv3Store => {
		if (storeRef !== null) return storeRef;
		storeRef = openStore();
		return storeRef;
	};

	// Live runtime state captured at session_start. The rollover
	// command consumes `currentProjectId` and `currentSessionId`
	// as the "old" project / session for the next rollover.
	let currentSessionId: string | null = null;
	let currentProjectId: string | null = null;
	let resolvedConfig: ResolvedCMV3Config | null = null;
	let activeProfile: ContextProfile = LOCAL_32K_PROFILE;

	// Per-(project, session) pressure-trigger state machine. S05A
	// dedup / loop guard. The active machine is the one for the
	// currently live (project, session); previous entries are
	// retained in the map for inspection (and are cleared when
	// `session_start` fires for that exact key).
	const pressureMachines = new Map<string, PressureTriggerMachine>();
	const pressureMachineKey = (projectId: string, sessionId: string): string =>
		`${projectId}::${sessionId}`;
	const getPressureMachine = (): PressureTriggerMachine | null => {
		const projectId = currentProjectId;
		const sessionId = currentSessionId;
		if (projectId === null || sessionId === null) return null;
		const key = pressureMachineKey(projectId, sessionId);
		let m = pressureMachines.get(key);
		if (m === undefined) {
			m = new PressureTriggerMachine(projectId, sessionId);
			pressureMachines.set(key, m);
		}
		return m;
	};

	// P04 — interrupted-rollover recovery. The scanner is
	// filesystem-backed by default; tests inject a stub via the
	// `cmv3SetReconcileScanner` test-only setter (see end of
	// file). The sink is console-backed in production and
	// overridable via `cmv3SetReconcileSink` for tests.
	let reconcileScanner: JsonlParentScanner = createFsJsonlParentScanner();
	let reconcileSink = consoleDiagnosticSink();

	// ------------------------------------------------------------------
	// 0) session_start: resolve mode / profile / project / session
	// ------------------------------------------------------------------
	pi.on("session_start", async (event, ctx) => {
		const cwd = ctx.cwd;
		const ev = event as { previousSessionFile?: string };
		const previousSessionFile = ev.previousSessionFile;
		const startReason = (event as { reason?: string }).reason ?? "startup";
		// The runtime may not expose the active model's context
		// window yet (it may be null right at start). We pass
		// `undefined` to let the session-init helper default to
		// the local_32k profile. The first `agent_settled` event
		// will supply a real value (if available).
		const initial = resolveLiveRuntime(
			{
				cwd,
				previousSessionFile,
			},
			getStore(),
		);
		resolvedConfig = initial.config;
		activeProfile = initial.profile;
		currentProjectId = initial.projectId;
		currentSessionId = initial.oldSessionId;
		// P04: on Pi startup, reconcile any RolloverRequest
		// stuck in EXECUTING. Per the WP, this runs ONLY when
		// the runtime reports `reason === "startup"`. For
		// `new` / `resume` / `fork` / `reload`, a rollover in
		// EXECUTING is LEGITIMATELY in flight (e.g. the
		// slash command's `withSession` is mid-write) and
		// must NOT be touched. The reconcile call NEVER
		// invokes `ctx.newSession()`; it only writes
		// EXECUTING -> COMPLETE / FAILED transitions through
		// the S04 store.
		if (startReason === "startup") {
			try {
				reconcileInterruptedRollovers({
					projectId: initial.projectId,
					oldSessionId: initial.oldSessionId,
					store: getStore(),
					jsonlScanner: reconcileScanner,
					sink: reconcileSink,
				});
			} catch {
				// The reconciler is bounded: its own outer
				// try/catch converts exceptions into a
				// diagnostic. Anything that escapes here is a
				// programmer error; swallow it so the
				// session_start pipeline completes.
			}
		}
		// S05A: a new (project, session) starts with a fresh
		// pressure-trigger machine. Any prior machine for this
		// exact key is reset; machines for prior keys are
		// retained for diagnostics.
		const key = pressureMachineKey(initial.projectId, initial.oldSessionId);
		pressureMachines.set(
			key,
			new PressureTriggerMachine(initial.projectId, initial.oldSessionId),
		);
		void LIVE_SESSION_START_HOOK_NAME;
	});

	// ------------------------------------------------------------------
	// 1) Custom tool: picm_recover (NEW in S05)
	// ------------------------------------------------------------------
	pi.registerTool({
		name: RECOVERY_TOOL_NAME,
		label: "PICM recover tool result",
		description:
			"Read a previously persisted tool result by its cmv3://tool/<id> ref. Optional byte range. The recovery tool's output is bounded.",
		promptSnippet:
			"Recover a tool result from a cmv3://tool/<id> ref with optional byte range.",
		promptGuidelines: [
			"Use picm_recover when a tool result was virtualized and the bounded active view is not enough.",
			"picm_recover accepts ONLY a cmv3://tool/<id> ref (or bare id) and a bounded byte range. It refuses arbitrary paths.",
			"picm_recover never returns the full unbounded payload; the default cap is 64 KiB and the hard ceiling is 1 MiB.",
		],
		parameters: {
			type: "object",
			properties: {
				ref: { type: "string" },
				start: { type: "number" },
				end: { type: "number" },
				full: { type: "boolean" },
				max_bytes: { type: "number" },
			},
			required: ["ref"],
		},
		async execute(
			_toolCallId,
			args,
		): Promise<{
			content: LiveToolResultInput["content"][number][];
			details: unknown;
			isError?: boolean;
		}> {
			if (resolvedConfig === null) {
				resolvedConfig = resolveConfig({});
			}
			if (resolvedConfig.mode === "legacy") {
				return {
					content: [
						{
							type: "text",
							text:
								"PICM mode is legacy; recovery surface is disabled. " +
								"Set CMV3_MODE=v3 (or v3-observe) to enable.",
						},
					],
					details: { error: "legacy_mode" },
				};
			}
			const projectId = currentProjectId;
			if (projectId === null) {
				return {
					content: [
						{
							type: "text",
							text:
								"PICM recovery requires a known project; session_start has not run yet.",
						},
					],
					details: { error: "no_project" },
				};
			}
			try {
				const out = executePicmRecover(args, {
					projectId,
					store: getStore(),
				});
				return { content: [out.content], details: out.details };
			} catch (err) {
				if (err instanceof ToolResultAccessError) {
					return {
						content: [
							{
								type: "text",
								text: `picm_recover refused: ${err.message}`,
							},
						],
						details: { error: "access", message: err.message },
					};
				}
				throw err;
			}
		},
	});

	// ------------------------------------------------------------------
	// 2) Custom tool: picm_prepare_rollover (S04, preserved)
	// ------------------------------------------------------------------
	pi.registerTool({
		name: ROLLOVER_TOOL_NAME,
		label: "PICM prepare rollover",
		description:
			"Persists checkpoint, projects MinimalHandoff, and creates a RolloverRequest for the /picm-rollover-execute command. Does NOT call newSession.",
		promptSnippet:
			"Persist checkpoint + handoff and queue a follow-up rollover command.",
		promptGuidelines: [
			"Use picm_prepare_rollover after a meaningful validated work package is complete (NATURAL) or when the runtime reports rollover pressure (PRESSURE).",
			"picm_prepare_rollover does NOT replace the session. It only persists durable state and returns an opaque request id; /picm-rollover-execute owns the actual session replacement.",
		],
		parameters: {
			type: "object",
			properties: {
				reason: { type: "string", enum: ["NATURAL", "PRESSURE"] },
				goal: { type: "string" },
				work_package: { type: "string" },
				status: {
					type: "string",
					enum: ["COMPLETE", "IN_PROGRESS", "BLOCKED"],
				},
				completed: { type: "array", items: { type: "string" } },
				in_progress: { type: "array", items: { type: "string" } },
				blockers: { type: "array", items: { type: "string" } },
				important_decisions: { type: "array", items: { type: "string" } },
				hard_constraints: { type: "array", items: { type: "string" } },
				current_files: { type: "array", items: { type: "string" } },
				active_errors: { type: "array", items: { type: "string" } },
				next_actions: { type: "array", items: { type: "string" } },
				recovery_refs: {
					type: "array",
					items: {
						type: "object",
						properties: {
							kind: { type: "string" },
							id: { type: "string" },
							uri: { type: "string" },
						},
						required: ["kind", "id", "uri"],
					},
				},
			},
			required: [
				"reason",
				"goal",
				"work_package",
				"status",
				"completed",
				"in_progress",
				"blockers",
				"important_decisions",
				"hard_constraints",
				"current_files",
				"active_errors",
				"next_actions",
			],
		},
		async execute(_toolCallId, args) {
			// SAFETY: the tool's parameters schema is the LLM-facing
			// boundary; the runtime hands us the parsed object. We
			// re-narrow to the tool-specific shape here.
			const a = (args ?? {}) as unknown as {
				reason: "NATURAL" | "PRESSURE";
				goal: string;
				work_package: string;
				status: "COMPLETE" | "IN_PROGRESS" | "BLOCKED";
				completed: string[];
				in_progress: string[];
				blockers: string[];
				important_decisions: string[];
				hard_constraints: string[];
				current_files: string[];
				active_errors: string[];
				next_actions: string[];
				recovery_refs?: { kind: string; id: string; uri: string }[];
			};
			if (resolvedConfig === null) {
				resolvedConfig = resolveConfig({});
			}
			if (resolvedConfig.mode === "legacy") {
				return {
					content: [
						{
							type: "text",
							text:
								"PICM mode is legacy; rollover preparation is a no-op. " +
								"Set CMV3_MODE=v3 (or v3-observe) to enable.",
						},
					],
					details: { ref: "", id: "", state: "IDLE" as const },
				};
			}
			const store = getStore();
			const projectId = currentProjectId;
			const oldSessionId = currentSessionId;
			if (projectId === null || oldSessionId === null) {
				return {
					content: [
						{
							type: "text",
							text:
								"PICM rollover preparation requires a known project / session; none available yet.",
						},
					],
					details: { ref: "", id: "", state: "IDLE" as const },
				};
			}
			const orchestrator = createRolloverOrchestrator(store);
			const now = new Date().toISOString();
			const cp = {
				schema_version: "1.0.0" as const,
				// P01 corrective: the S04 orchestrator
				// validates the checkpoint and projects the
				// handoff before persisting. The store
				// rewrites checkpoint_id on write, so the
				// only requirement here is a non-empty
				// placeholder that satisfies
				// `requireString(c, "checkpoint_id", ...)`.
				// An empty string failed the live
				// `picm_prepare_rollover` tool path that
				// no unit test had exercised before P01.
				checkpoint_id: generateId(),
				project_id: projectId,
				session_id: oldSessionId,
				created_at: now,
				goal: a.goal,
				work_package: a.work_package,
				status: a.status,
				completed: a.completed,
				in_progress: a.in_progress,
				blockers: a.blockers,
				decisions: a.important_decisions,
				constraints: a.hard_constraints,
				files_read: [],
				files_modified: a.current_files,
				relevant_versions: [],
				tests: [],
				validation_results: [],
				active_errors: a.active_errors,
				git_repository: null,
				git_branch: null,
				git_head: null,
				git_dirty: null,
				next_actions: a.next_actions,
				recovery_refs: (a.recovery_refs ?? []).map((r) => ({
					kind: r.kind as
						| "tool"
						| "checkpoint"
						| "session"
						| "file"
						| "handoff"
						| "rollover",
					id: r.id,
					uri: r.uri,
				})),
				handoff_summary: "",
			};
			// Project the handoff for the orchestrator's
			// self-consistency check.
			const ho = projectHandoffFromCheckpoint(cp);
			// S05A: feed the prepare outcome back into the
			// pressure-trigger machine so the dedup / retry
			// budget is honored. A PRESSURE-triggered prepare
			// that throws reports the failure to the machine;
			// a successful prepare transitions the machine
			// out of PENDING so the new session's
			// `session_start` consumes the slot.
			const pmForPrepare = getPressureMachine();
			let out;
			try {
				out = await orchestrator.prepare({
					projectId,
					oldSessionId,
					checkpoint: cp,
					handoff: ho,
					reason: a.reason,
					recovery_refs: cp.recovery_refs,
					now,
				});
			} catch (err) {
				if (pmForPrepare !== null && a.reason === "PRESSURE") {
					const failure_code =
						err instanceof RolloverOrchestratorError ? err.failure_code : "unknown";
					pmForPrepare.applyPrepareOutcome(
						classifyPrepareOutcome({ ok: false, failure_code }),
					);
				}
				throw err;
			}
			if (pmForPrepare !== null && a.reason === "PRESSURE") {
				pmForPrepare.applyPrepareOutcome(classifyPrepareOutcome({ ok: true }));
			}
			return {
				content: [
					{
						type: "text",
						text:
							`PICM rollover prepared.\n` +
							`ref: ${out.ref}\n` +
							`reason: ${a.reason}\n` +
							`state: ${out.request.state}\n` +
							`Use /${ROLLOVER_COMMAND_NAME} ${out.id} to execute.`,
					},
				],
				details: { ref: out.ref, id: out.id, state: out.request.state },
			};
		},
	});

	// ------------------------------------------------------------------
	// 3) Custom command: /picm-rollover-execute (S04, preserved)
	// ------------------------------------------------------------------
	pi.registerCommand(ROLLOVER_COMMAND_NAME, {
		description:
			"Execute a prepared PICM rollover. The argument is the opaque rollover request id (no checkpoint body, no handoff body, no file content).",
		handler: async (args, ctx) => {
			const reply = (msg: string): void => {
				ctx.ui.notify(msg, "info");
			};
			if (resolvedConfig === null) {
				resolvedConfig = resolveConfig({});
			}
			if (resolvedConfig.mode !== "v3") {
				reply(`PICM mode is ${resolvedConfig.mode}; refuse to call newSession.`);
				return;
			}
			const trimmed = args.trim();
			if (trimmed.length === 0) {
				reply(`Usage: /${ROLLOVER_COMMAND_NAME} <opaque-request-id>`);
				return;
			}
			// Accept either the full ref (cmv3://rollover/<id>) or
			// the bare id. We MUST reject any path-like input.
			let id: string;
			try {
				if (trimmed.startsWith("cmv3://")) {
					const parsed = requireRolloverRef(trimmed);
					id = parsed.id;
				} else if (/^[a-z0-9_-]{8,128}$/.test(trimmed)) {
					id = trimmed;
				} else {
					reply(`Invalid rollover request id syntax: ${trimmed}`);
					return;
				}
			} catch (err) {
				reply(`Invalid rollover request id: ${(err as Error).message}`);
				return;
			}
			const store = getStore();
			const projectId = currentProjectId;
			const oldSessionId = currentSessionId;
			if (projectId === null || oldSessionId === null) {
				reply("PICM rollover requires a known project / session; none available.");
				return;
			}
			const ref = `cmv3://rollover/${id}`;
			let request;
			try {
				request = store.rollovers.read(ref, projectId);
			} catch (err) {
				reply(
					`Rollover request not found or unreadable: ${(err as Error).message}`,
				);
				return;
			}
			if (
				request.project_id !== projectId ||
				request.old_session_id !== oldSessionId
			) {
				reply("Rollover identity mismatch (project or session).");
				return;
			}
			if (request.state === "COMPLETE") {
				reply(`Rollover ${id} is already COMPLETE; cannot re-execute.`);
				return;
			}
			if (request.state === "CANCELLED") {
				reply(`Rollover ${id} is CANCELLED; create a new request.`);
				return;
			}
			if (request.state === "FAILED" && request.failure_code !== null) {
				// Allow retry: a FAILED state may transition to
				// PREPARING -> READY through a fresh request.
				reply(`Rollover ${id} is FAILED; create a new rollover request to retry.`);
				return;
			}
			// Pre-NEW hard gate.
			const cp = store.checkpoints.read(request.checkpoint_ref, projectId);
			const ho = store.handoffs.read(request.handoff_ref, projectId);
			const orchestrator = createRolloverOrchestrator(store);
			const gate = orchestrator.preNewGate({
				projectId,
				oldSessionId,
				request,
				checkpoint: cp,
				handoff: ho,
				mode: resolvedConfig.mode,
			});
			if (!gate.ok) {
				store.rollovers.transition({
					projectId,
					ref,
					to: "FAILED",
					failureCode: gate.failure_code,
					failureDetail: gate.detail,
				});
				reply(`Pre-NEW gate failed: ${gate.failure_code} (${gate.detail})`);
				return;
			}
			// Idempotency: if the request is already EXECUTING, we
			// refuse to start a second concurrent newSession.
			if (request.state !== "READY") {
				reply(`Rollover ${id} is in state ${request.state}; cannot execute.`);
				return;
			}
			// Move to EXECUTING.
			store.rollovers.transition({
				projectId,
				ref,
				to: "EXECUTING",
			});
			const hydration = buildHydrationPayload(ho);
			const parentSession = ctx.sessionManager.getSessionFile();
			const result = await ctx.newSession({
				parentSession,
				setup: async (sm) => {
					sm.appendMessage({
						role: "user",
						content: [{ type: "text", text: hydration.text }],
						timestamp: Date.now(),
					});
				},
				withSession: async (freshCtx) => {
					// Only the fresh context is used here. The
					// captured `ctx` and `pi` from the outer
					// closure are stale; we deliberately do not
					// touch them.
					const newSessionFile = freshCtx.sessionManager.getSessionFile();
					const newSessionId = newSessionFile ?? "new-session";
					const ts = new Date().toISOString();
					// P01 corrective: `oldSessionId` is set
					// by `session_start` from the runtime's
					// session-file getter, which in real Pi is
					// a session file path (e.g. `sess_xxx.json`).
					// A file path cannot be embedded in a
					// `cmv3://session/<id>` ref — the store
					// rejects it as malformed. Normalize to a
					// ref-shaped id by stripping the directory
					// and extension. If the result is empty
					// (which only happens for the synthetic
					// `current` sentinel), fall back to null.
					const oldSessionBasename = oldSessionId.split("/").pop() ?? "";
					const oldSessionIdBare = oldSessionBasename.replace(/\.json$/, "");
					const previous_session_ref =
						oldSessionIdBare.length === 0 || oldSessionIdBare === "current"
							? null
							: `cmv3://session/${oldSessionIdBare}`;
					// Persist a new session record.
					store.sessions.write(
						{
							schema_version: "1.0.0",
							session_id: newSessionId,
							project_id: projectId,
							started_at: ts,
							status: "OPEN",
							checkpoint_refs: [request.checkpoint_ref],
							handoff_refs: [request.handoff_ref],
							previous_session_ref,
							next_session_ref: null,
						},
						{ projectId },
					);
					store.rollovers.transition({
						projectId,
						ref,
						to: "COMPLETE",
						newSessionId,
					});
					// P03 corrective: `freshCtx.sendUserMessage`
					// awaits the new session's full agent turn
					// (prompt -> LLM -> response). Awaiting it
					// inside `withSession` blocked the old
					// slash command's `await ctx.newSession()`
					// indefinitely, and on rate-limited models
					// the old TUI was held hostage while the
					// new TUI tried to render in the same PTY.
					// The handoff itself is already persisted as
					// the first user message in the new session
					// by `setup` above; `sendUserMessage` here
					// is only the kickoff prompt that asks the
					// new agent to begin work on the handoff.
					// Fire it without awaiting; attach a
					// bounded error logger so failures are
					// visible (NOT silent). Rollover state is
					// already COMPLETE — the new session was
					// successfully created, the handoff is
					// durable, and a kickoff failure is
					// recoverable by the user re-submitting.
					const kickoff = freshCtx.sendUserMessage(
						`Continuing ${ho.work_package}. ${hydration.text.split("\n")[0]}`,
					);
					kickoff.catch((err: unknown) => {
						// ponytail: best-effort kickoff logger.
						// The new session is fully active at
						// the point this catch runs (the old
						// session is invalidated and the new
						// TUI is bound). We surface the error
						// through the replaced context's
						// public UI: a notification in the new
						// TUI is observable, and Pi itself
						// will not crash on a notify call.
						// SAFETY: `ui` is a public getter on
						// the replaced context (see Pi's
						// `ExtensionRunner.createContext`,
						// which is re-used by
						// `createReplacedSessionContext`).
						// `hasUI` is a guarded check; the
						// runner's `assertActive()` runs on
						// every access and is valid because
						// the new session is the active
						// runner at the time this catch
						// fires. If `hasUI` is false, the
						// notify is silently skipped.
						const message = err instanceof Error ? err.message : String(err);
						try {
							// SAFETY: `ui` and `hasUI` are public
							// members of the replaced context's
							// underlying ExtensionContext (Pi's
							// `runner.createContext` at
							// `dist/core/extensions/runner.js`).
							// The re-type only narrows the public
							// shape to the methods we actually
							// call, and the chained `try` plus
							// `hasUI?.()` guard short-circuits if
							// either is unavailable.
							const ui = freshCtx as unknown as {
								hasUI?: () => boolean;
								ui?: {
									notify?: (text: string, level: "info" | "warning" | "error") => void;
								};
							};
							if (ui.hasUI?.() && ui.ui?.notify) {
								ui.ui.notify(
									`PICM rollover kickoff failed (new session is ready, handoff persisted): ${message}`,
									"warning",
								);
							}
						} catch {
							// The notification itself failed
							// (e.g. the new session was torn
							// down before the catch fired).
							// The new session file is durable
							// and the user can re-submit the
							// kickoff message; nothing more
							// we can do here.
						}
					});
				},
			});
			if (result.cancelled) {
				store.rollovers.transition({
					projectId,
					ref,
					to: "FAILED",
					failureCode: "cancelled_by_extension",
					failureDetail: "another extension cancelled newSession",
				});
				reply(`Rollover ${id} was cancelled by an extension.`);
				return;
			}
			reply(`Rollover ${id} executed.`);
		},
	});

	// ------------------------------------------------------------------
	// 4) tool_result event (NEW in S05)
	// ------------------------------------------------------------------
	// The Pi API declares many `on(event, ...)` overloads. The
	// runtime accepts a handler of shape
	// `(event: ToolResultEvent, ctx) => ToolResultEventResult | void`.
	// The handler below returns the virtualization result; the
	// runtime uses `content` to replace the tool result in the
	// active context. We define the handler as a typed
	// `picmToolResultHandler` and pass it through a minimal
	// cast so overload resolution picks the right overload.
	// The tool_result subscription is the only call site; the
	// S05 test SIDE EFFECT 41 grep matches this exact form.
	const picmToolResultHandler = (
		event: ToolResultEvent,
	): PicmToolResultEventResult | void => {
		if (resolvedConfig === null) {
			resolvedConfig = resolveConfig({});
		}
		const projectId = currentProjectId;
		if (projectId === null) {
			// No project resolved yet (session_start did not
			// run for some reason). Pass through unchanged.
			return;
		}
		// The Pi runtime guarantees that `content` is a
		// (TextContent | ImageContent)[] array; we re-type the
		// slice to the live helper's structural shape so the
		// extension does not depend on the private pi-ai
		// module. SAFETY: the runtime's content shape is the
		// same TextContent | ImageContent union we declare
		// locally in tool-result-live.ts.
		const liveInput: LiveToolResultInput = {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			content: event.content as unknown as LiveToolResultInput["content"],
			isError: event.isError,
			sessionId: currentSessionId,
		};
		try {
			return virtualizeToolResult(liveInput, {
				projectId,
				sessionId: currentSessionId,
				mode: resolvedConfig.mode,
				store: getStore(),
			});
		} catch (err) {
			// The helper throws only on a persistence error.
			// We fail-open: return the original event content
			// unchanged; the diagnostic is recorded as
			// metadata.
			if (err instanceof ToolResultPersistenceError) {
				return failOpenForPersistenceError(liveInput, err);
			}
			// Any other throw is a programmer error. We
			// swallow it so Pi does not crash; the helper
			// already produced a diagnostic.
			return undefined;
		}
	};
	// Cast to a generic `on` event so TypeScript can pick the
	// right overload. The runtime signature is
	// `(event, ctx) => ToolResultEventResult | void`; the
	// handler above matches.
	// SAFETY: the runtime merges the returned `content` /
	// `details` into the tool-result pipeline. `picmToolResultHandler`
	// returns a value shape whose `content` and `details` are
	// the runtime's TextContent | ImageContent union and an
	// unknown details; structurally identical to
	// `ToolResultEventResult`. The cast is the standard
	// pattern for navigating a long overload set on a public
	// API where one concrete branch is the target.
	// ponytail: TS overload resolution on `pi.on` picks the
	// LAST overload (input), so the literal "tool_result" fails.
	// The full-call cast is the minimal pattern; the runtime
	// payload is identical.
	(pi.on as unknown as (event: string, handler: unknown) => void)(
		"tool_result",
		picmToolResultHandler,
	);

	// ------------------------------------------------------------------
	// 5) agent_settled: live pressure observation + S05A trigger
	// ------------------------------------------------------------------
	pi.on("agent_settled", async (_event, ctx) => {
		if (resolvedConfig === null) {
			resolvedConfig = resolveConfig({});
		}
		// Try to read the live model context window. When the
		// runtime reports it, refresh the active profile.
		const live = ctx.getContextUsage();
		if (live !== undefined && live.contextWindow > 0) {
			// Re-resolve the live runtime so the profile is
			// driven by the physical cap. The resolver is pure
			// and idempotent; the only side effect here is
			// updating the per-extension `activeProfile`.
			const r = resolveLiveRuntime(
				{
					cwd: ctx.cwd,
					contextWindow: live.contextWindow,
					previousSessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
				},
				getStore(),
			);
			activeProfile = r.profile;
		}
		const usage = {
			tokens: live?.tokens ?? 0,
		};
		const out = computeLivePressure({
			live: {
				tokens: live?.tokens ?? null,
				contextWindow: live?.contextWindow ?? activeProfile.max_context,
			},
			mode: resolvedConfig.mode,
			agentSettled: true,
			profileOverride: activeProfile,
		});
		// S05A: when the live decision is eligible for a
		// pressure-driven rollover continuation, send exactly
		// one trusted PICM custom message to the active
		// session. The message uses
		//   - customType: "picm-pressure-rollover"
		//   - content: FIXED_TRUSTED_PICM_DIRECTIVE
		//     (no payload, no transcript, no file content)
		//   - display: false
		//   - details: { pressureState, action, reason }
		//     (deterministic pressure metadata only)
		//   - triggerTurn: true
		//   - deliverAs: "followUp"
		// The observer never calls newSession. The observer
		// never modifies native Pi compaction. The observer
		// is the SOLE pressure-side call site of
		// `pi.sendMessage`; the S04 command remains the only
		// newSession owner.
		const pm = getPressureMachine();
		if (pm !== null) {
			const trig = shouldTriggerPressureRollover({
				decision: out.decision,
				mode: resolvedConfig.mode,
				machine: pm,
			});
			if (trig.shouldSend && trig.call !== null) {
				pi.sendMessage(
					{
						customType: trig.call.message.customType,
						content: trig.call.message.content,
						display: trig.call.message.display,
						details: trig.call.message.details,
					},
					{
						triggerTurn: trig.call.options.triggerTurn,
						deliverAs: trig.call.options.deliverAs,
					},
				);
				pm.markSent();
			}
		}
		void LIVE_PRESSURE_HOOK_NAME;
		void usage;
	});
}

// Re-export the live helper names so tests can import the
// surface from the public extension barrel.
export { RECOVERY_TOOL_NAME as PICM_RECOVER_TOOL_NAME } from "./recovery-tool.js";
export { LIVE_TOOL_RESULT_HOOK_NAME } from "./tool-result-live.js";
// Defensive: keep the public type re-exports tied to one place.
export type { ContextProfile } from "../core/profiles.js";
export type { ResolvedCMV3Config } from "../core/config.js";
// Keep the public type re-exports stable for downstream tests.
export type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
// S05A: re-export the pressure-trigger surface so tests can
// drive the live handler through the public extension barrel.
export {
	PICM_PRESSURE_CUSTOM_TYPE,
	FIXED_TRUSTED_PICM_DIRECTIVE,
	PRESSURE_ROLLOVER_OPTIONS,
	PRESSURE_DIRECTIVE_DENY_SUBSTRINGS,
	PressureTriggerMachine,
	buildPressureRolloverMessage,
	buildPressureRolloverCall,
	shouldTriggerPressureRollover,
	classifyPrepareOutcome,
} from "./pressure-trigger.js";
export type {
	PressureRolloverDetails,
	PressureRolloverMessage,
	PressureRolloverOptions,
	PressureRolloverCall,
	ShouldTriggerInput,
	ShouldTriggerOutput,
	PressureTriggerState,
	PrepareOutcome,
} from "./pressure-trigger.js";

/**
 * Local structural type matching the runtime's
 * `PicmToolResultEventResult` interface. The public
 * `@earendil-works/pi-coding-agent` API does NOT re-export
 * `PicmToolResultEventResult` (it lives in the private `pi-ai`
 * peer). The shape is small and well-known: we declare it
 * here so the extension code is fully typed without
 * importing private modules. We use the public
 * `AgentToolResult<unknown>` shape so the type aligns with
 * what `registerTool(...).execute` actually returns.
 */
export type PicmToolResultEventResult = {
	content?: LiveToolResultInput["content"][number][];
	details?: unknown;
	isError?: boolean;
};
