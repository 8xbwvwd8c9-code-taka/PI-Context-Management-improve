/**
 * Top-level CMV3 store façade.
 *
 * One `Cmv3Store` instance owns a `StoreLayout` and exposes the
 * individual record stores, history, and recovery helpers. S03
 * attaches the tool-result store; S04 (rollover) will extend the
 * façade with the live orchestrator.
 */
import { type CMV3Config, type ResolvedCMV3Config } from "../core/config.js";
import { type StoreLayout } from "./paths.js";
import { type CheckpointStore, type CheckpointSummary } from "./checkpoint-store.js";
import { type HandoffStore, type HandoffSummary } from "./handoff-store.js";
import { type ProjectStore } from "./project-store.js";
import { type SessionStore, type SessionSummary } from "./session-store.js";
import { type ToolResultStore, type ToolResultListFilters, type ToolResultSummary, type ToolResultWriteInput, type ToolResultWriteOutput } from "./tool-result-store.js";
import { type RolloverStore, type RolloverListFilters, type RolloverSummary } from "./rollover-store.js";
import { History, type HistoryQuery } from "./history.js";
import { type ProjectRecovery } from "./recovery.js";
export interface Cmv3Store {
    readonly config: ResolvedCMV3Config;
    readonly layout: StoreLayout;
    readonly checkpoints: CheckpointStore;
    readonly handoffs: HandoffStore;
    readonly sessions: SessionStore;
    readonly toolResults: ToolResultStore;
    readonly rollovers: RolloverStore;
    readonly projects: ProjectStore;
    readonly history: History;
    recover(projectId: string): ProjectRecovery;
    rebuildAllIndexes(projectId: string): void;
}
export interface OpenStoreOptions {
    storagePath?: string;
    home?: string;
    config?: Partial<CMV3Config>;
}
export declare function openStore(options?: OpenStoreOptions): Cmv3Store;
export declare function rebuildAll(layout: StoreLayout, projectId: string): void;
export type { CheckpointSummary, HandoffSummary, SessionSummary, HistoryQuery, ToolResultListFilters, ToolResultSummary, ToolResultWriteInput, ToolResultWriteOutput, ToolResultStore, RolloverListFilters, RolloverSummary, RolloverStore, };
export { ToolResultAccessError, ToolResultPersistenceError, createToolResultStore, rebuildToolResultIndex, } from "./tool-result-store.js";
export { RolloverIdentityError, RolloverIntegrityError, RolloverTransitionError, createRolloverStore, rebuildRolloverIndex, ROLLOVER_REF_KIND, } from "./rollover-store.js";
//# sourceMappingURL=store.d.ts.map