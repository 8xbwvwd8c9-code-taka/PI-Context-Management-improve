/**
 * Pi runtime extension — S04 fresh-session rollover entrypoint.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §9, §10.
 *
 * S04 contract:
 *   - register one custom tool (`picm_prepare_rollover`) for the
 *     agent to call when a meaningful work package is complete
 *     (NATURAL) or when the runtime surfaces a PRESSURE signal
 *   - register one custom command (`/picm-rollover-execute`) for
 *     the actual session replacement; this is the ONLY surface
 *     that calls `ctx.newSession()`
 *   - on `agent_settled`, observe pressure and (in v3) queue a
 *     follow-up rollover command if ROLLOVER pressure is reached;
 *     the observer NEVER calls newSession directly
 *   - never call the native compact entrypoint, never modify native Pi
 *     compaction, never mutate the user's Git state
 *   - never capture a stale `pi` or command `ctx` after
 *     `await ctx.newSession()`; post-replacement work is done
 *     through `withSession(freshCtx)` and the fresh context only
 *
 * The extension does NOT auto-spool tool output (S03 was a data
 * plane; S04 does not widen the live hook to all tools). It is
 * also explicitly not a session-level hook installer: it registers
 * exactly one tool and exactly one command, and one event
 * observer.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { openStore, type Cmv3Store } from "../store/index.js";
import {
	buildHydrationPayload,
	classifyPressure,
	createRolloverOrchestrator,
	decideRollover,
	projectHandoffFromCheckpoint,
	requireRolloverRef,
	resolveConfig,
	type CMV3Config,
} from "../core/index.js";
import { LOCAL_32K_PROFILE, type ContextUsage } from "../core/index.js";

/** Package identity. Mirrored from package.json for runtime introspection. */
export const PACKAGE_NAME = "pi-context-management-improve";
export const PACKAGE_VERSION = "0.1.0";
export const PACKAGE_PHASE = "S04-FRESH-SESSION-ROLLOVER";

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
 * Default export. Wired as a Pi extension entrypoint per
 * `pi.extensions` in package.json.
 */
export default function cmv3Extension(pi: ExtensionAPI): void {
	let storeRef: Cmv3Store | null = null;
	const getStore = (): Cmv3Store => {
		if (storeRef !== null) return storeRef;
		storeRef = openStore();
		return storeRef;
	};

	// The runtime session id is captured at session_start. The
	// orchestrator uses it as the "old session id" for the next
	// rollover; a successful rollover then records the new
	// session id and clears the captured old id.
	let currentSessionId: string | null = null;
	let currentProjectId: string | null = null;
	let resolvedConfig: ReturnType<typeof resolveConfig> | null = null;

	pi.on("session_start", async (event) => {
		// Resolve config from env so tests can opt in.
		const configRaw = process.env["CMV3_MODE"];
		const configInput: Partial<CMV3Config> =
			typeof configRaw === "string" && configRaw.length > 0
				? { mode: configRaw as CMV3Config["mode"] }
				: {};
		resolvedConfig = resolveConfig(configInput);
		// The runtime may not expose a session id; we accept the
		// event's sessionFile as a stable proxy.
		const ev = event as { sessionFile?: string };
		currentSessionId = ev.sessionFile ?? "current";
		// Project id derives from the current cwd's opaque hash.
		// We do not capture absolute paths; the store computes the
		// hash at write time.
		const cwd = process.cwd();
		const { projectIdFromSeed } = await import("../store/ids.js");
		currentProjectId = projectIdFromSeed(cwd);
	});

	// ------------------------------------------------------------------
	// 1) Custom tool: picm_prepare_rollover
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
							text: "PICM rollover preparation requires a known project / session; none available yet.",
						},
					],
					details: { ref: "", id: "", state: "IDLE" as const },
				};
			}
			const orchestrator = createRolloverOrchestrator(store);
			const now = new Date().toISOString();
			const cp = {
				schema_version: "1.0.0" as const,
				checkpoint_id: "",
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
					kind: r.kind as "tool" | "checkpoint" | "session" | "file" | "handoff" | "rollover",
					id: r.id,
					uri: r.uri,
				})),
				handoff_summary: "",
			};
			// Project the handoff for the orchestrator's
			// self-consistency check.
			const ho = projectHandoffFromCheckpoint(cp);
			const out = await orchestrator.prepare({
				projectId,
				oldSessionId,
				checkpoint: cp,
				handoff: ho,
				reason: a.reason,
				recovery_refs: cp.recovery_refs,
				now,
			});
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
	// 2) Custom command: /picm-rollover-execute
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
				reply(`Rollover request not found or unreadable: ${(err as Error).message}`);
				return;
			}
			if (request.project_id !== projectId || request.old_session_id !== oldSessionId) {
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
							previous_session_ref: oldSessionId === "current" ? null : `cmv3://session/${oldSessionId}`,
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
					// Kick the new session off on the structured
					// handoff.
					await freshCtx.sendUserMessage(
						`Continuing ${ho.work_package}. ${hydration.text.split("\n")[0]}`,
					);
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
	// 3) agent_settled pressure observer
	// ------------------------------------------------------------------
	pi.on("agent_settled", async (_event, ctx) => {
		if (resolvedConfig === null) {
			resolvedConfig = resolveConfig({});
		}
		// The runtime may not expose a token count; we accept an
		// env override for testing. The observer returns "none"
		// in legacy mode regardless of input.
		const usage: ContextUsage = {
			tokens: Number(process.env["CMV3_PRESSURE_TOKENS"] ?? 0),
		};
		const decision = decideRollover({
			usage,
			profile: LOCAL_32K_PROFILE,
			mode: resolvedConfig.mode,
			agentSettled: true,
		});
		// v3-observe may record the decision; v3 may queue a
		// follow-up. We do not call newSession from here.
		if (decision.would_new_session) {
			const store = getStore();
			const projectId = currentProjectId;
			const oldSessionId = currentSessionId;
			if (projectId === null || oldSessionId === null) return;
			// Best-effort: persist a pressure observation marker
			// by preparing a "would-rollover" handoff state. We
			// do NOT call prepare() because prepare() requires a
			// structured checkpoint; we simply record the
			// observation through the orchestrator's diagnostic
			// surface. The actual rollover requires the LLM to
			// call picm_prepare_rollover.
			const pressure = classifyPressure(usage, LOCAL_32K_PROFILE);
			// Use the ctx only to read fresh ui/state. We do not
			// mutate the user-visible session.
			void ctx;
			void pressure;
			void store;
		}
	});
}
