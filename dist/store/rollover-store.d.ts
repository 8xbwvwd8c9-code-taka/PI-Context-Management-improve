/**
 * RolloverRequest store.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §9, §10.
 *
 * The rollover store is a thin I/O layer that:
 *   - validates before persistence
 *   - writes the request.json atomically inside a per-id directory
 *   - enforces the S04 state machine on every write
 *   - enforces project + session identity invariants
 *   - returns an opaque cmv3://rollover/<id> ref only on success
 *   - never mutates an existing record in place from the caller's
 *     point of view: state changes are explicit transitions that
 *     re-seal the same record file
 *
 * The store does NOT call `ctx.newSession()`. It is the data plane
 * the orchestrator consumes. The orchestrator is the only surface
 * allowed to call newSession, and only through the supported
 * ExtensionCommandContext.
 */
import { type RolloverFailureCode, type RolloverRequest, type RolloverState } from "../core/index.js";
import { type StoreLayout } from "./paths.js";
export declare const ROLLOVER_REF_KIND: "rollover";
export interface RolloverStore {
    /** Persist a freshly-prepared request (state must be PREPARING or READY). */
    write(input: unknown, opts: {
        projectId: string;
        oldSessionId: string;
    }): {
        ref: string;
        id: string;
        request: RolloverRequest;
    };
    /**
     * Append-only state transition. Validates the existing record,
     * checks the transition is allowed, persists the new state, and
     * returns the new record. Throws on disallowed transitions.
     */
    transition(opts: {
        projectId: string;
        ref: string;
        to: RolloverState;
        now?: string;
        newSessionId?: string | null;
        failureCode?: RolloverFailureCode | null;
        failureDetail?: string | null;
    }): RolloverRequest;
    read(ref: string, projectId: string): RolloverRequest;
    readById(projectId: string, id: string): RolloverRequest;
    list(projectId: string, filters?: RolloverListFilters): RolloverSummary[];
    latest(projectId: string): RolloverRequest | null;
    refFor(id: string): string;
}
export interface RolloverListFilters {
    reason?: RolloverRequest["reason"];
    state?: RolloverState;
    since?: string;
    until?: string;
    oldSessionId?: string;
}
export interface RolloverSummary {
    id: string;
    ref: string;
    reason: RolloverRequest["reason"];
    state: RolloverState;
    created_at: string;
    updated_at: string;
    old_session_id: string;
    new_session_id: string | null;
    checkpoint_ref: string;
    handoff_ref: string;
}
export declare class RolloverIntegrityError extends Error {
    constructor(message: string);
}
export declare class RolloverTransitionError extends Error {
    readonly from: RolloverState;
    readonly to: RolloverState;
    constructor(message: string, from: RolloverState, to: RolloverState);
}
export declare class RolloverIdentityError extends Error {
    constructor(message: string);
}
export declare function createRolloverStore(layout: StoreLayout): RolloverStore;
/**
 * Re-scan authoritative rollover directories and rebuild the
 * rollover index. Used by `rebuildAll` and by the recovery path.
 *
 * This is a synchronous walk; the durable directory layout is
 * `rollovers/<id>/request.json`.
 */
export declare function rebuildRolloverIndex(layout: StoreLayout, projectId: string): void;
//# sourceMappingURL=rollover-store.d.ts.map