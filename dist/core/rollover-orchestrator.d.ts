/**
 * Portable core — fresh-session rollover orchestrator (data plane).
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §6, §7, §9, §10.
 *
 * The orchestrator is the single authority for the S04 lifecycle:
 *
 *   validate state
 *   → persist Checkpoint
 *   → project + persist Handoff
 *   → persist RolloverRequest (state: PREPARING → READY)
 *   → return the rollover ref for the command to consume
 *
 * The orchestrator:
 *   - validates the structured state at every step
 *   - throws a typed error if persistence fails
 *   - returns a single, opaque rollover ref on success
 *   - never calls `ctx.newSession()` itself
 *   - never reads from raw tool payload; only from structured state
 *   - never embeds checkpoint / handoff / file / tool body in its
 *     command surface
 *
 * The command / runtime layer (S04) consumes the returned ref via
 * `/picm-rollover-execute <opaque-id>`. That command is the
 * only place that calls `ctx.newSession`.
 *
 * This module is pure data + pure functions, with the S02 store
 * injected as a constructor argument. It does not import Pi, does
 * not import node:process, and is fully testable in isolation.
 */
import { type Checkpoint, type HistoryRef, type MinimalHandoff } from "../core/index.js";
import { type RolloverFailureCode, type RolloverReason, type RolloverRequest } from "../core/rollover.js";
import type { Cmv3Store } from "../store/store.js";
export interface PrepareRolloverInput {
    /** Prepared structured checkpoint body. Must satisfy `validateCheckpoint`. */
    checkpoint: unknown;
    /**
     * Optional pre-built handoff. When omitted, the handoff is
     * projected from the checkpoint by `projectHandoffFromCheckpoint`.
     * The projection is the only canonical mapping; the orchestrator
     * never re-parses a handoff from raw tool output.
     */
    handoff?: unknown;
    /** Rollover reason. NATURAL = next WP; PRESSURE = same WP. */
    reason: RolloverReason;
    /**
     * Optional: explicit recovery refs to attach. When omitted, the
     * orchestrator carries the refs from the prepared handoff.
     */
    recovery_refs?: readonly HistoryRef[];
    /** Optional: override `now` (ISO-8601). Used by tests. */
    now?: string;
    /**
     * Optional: lock holder id. The same project + session may not
     * have two active rollover requests. The first prepare acquires
     * the lock; concurrent prepares return a typed error.
     */
    lockHolder?: string;
}
export interface PrepareRolloverOutput {
    ref: string;
    id: string;
    request: RolloverRequest;
}
export interface PreNewGateInput {
    projectId: string;
    oldSessionId: string;
    request: RolloverRequest;
    checkpoint: Checkpoint;
    handoff: MinimalHandoff;
    mode: "legacy" | "v3-observe" | "v3";
    now?: string;
}
export type PreNewGateResult = {
    ok: true;
    reason: "READY";
} | {
    ok: false;
    reason: "BLOCKED";
    failure_code: RolloverFailureCode;
    detail: string;
};
export interface RolloverOrchestrator {
    /**
     * Prepare a fresh rollover request:
     *   1. validate the input checkpoint (pure)
     *   2. project / validate the handoff
     *   3. persist checkpoint (atomic, ref-on-success)
     *   4. persist handoff (atomic, ref-on-success)
     *   5. persist RolloverRequest in state READY
     *   6. acquire a per-project+session lock; refuse if held
     *
     * Throws typed errors on any persistence failure. The caller
     * is responsible for surfacing the error to the user / skill.
     * On success, the returned ref is the single argument to the
     * `/picm-rollover-execute` command.
     */
    prepare(opts: {
        projectId: string;
        oldSessionId: string;
    } & PrepareRolloverInput): Promise<PrepareRolloverOutput>;
    /**
     * Run the pre-NEW hard gate. Pure; does not call newSession.
     * The command invokes this immediately before `ctx.newSession`.
     */
    preNewGate(input: PreNewGateInput): PreNewGateResult;
    /**
     * Build the hydration prompt that the new session will receive.
     * Pure; the result is a structured `text` payload and a
     * `recovery_refs` array. The caller may pass either to
     * `sm.appendMessage` or `ctx.sendUserMessage`. The payload
     * contains ONLY the MinimalHandoff projection; never the
     * full checkpoint, the transcript, or the raw tool output.
     */
    buildHydrationText(handoff: MinimalHandoff): {
        text: string;
        recovery_refs: readonly HistoryRef[];
    };
}
export declare class RolloverOrchestratorError extends Error {
    readonly failure_code: RolloverFailureCode;
    constructor(message: string, failure_code: RolloverFailureCode);
}
export declare function createRolloverOrchestrator(store: Cmv3Store): RolloverOrchestrator;
export declare function parseRolloverRef(uri: string): {
    id: string;
} | null;
/**
 * Public helper: like parseRolloverRef, but throws. Used by the
 * command when an invalid ref is a hard error.
 */
export declare function requireRolloverRef(uri: string): {
    id: string;
};
//# sourceMappingURL=rollover-orchestrator.d.ts.map