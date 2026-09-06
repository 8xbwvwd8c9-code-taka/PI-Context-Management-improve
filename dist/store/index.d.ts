/**
 * Public surface of the CMV3 durable store.
 *
 * The store is intentionally a library: S02 implements the data
 * plane, S03 attaches tool-result virtualization, S04 attaches the
 * rollover orchestrator. None of the live Pi lifecycle hooks are
 * wired here.
 */
export { openStore, rebuildAll, type Cmv3Store, type OpenStoreOptions, } from "./store.js";
export { CheckpointIntegrityError, createCheckpointStore, type CheckpointListFilters, type CheckpointStore, type CheckpointSummary, } from "./checkpoint-store.js";
export { HandoffIntegrityError, createHandoffStore, HANDOFF_REF_KIND, HANDOFF_SCHEMA_VERSION, type HandoffListFilters, type HandoffStore, type HandoffSummary, } from "./handoff-store.js";
export { SessionIntegrityError, createSessionStore, SESSION_REF_KIND, type SessionStore, type SessionSummary, } from "./session-store.js";
export { ToolResultAccessError, ToolResultPersistenceError, createToolResultStore, rebuildToolResultIndex, type ToolResultListFilters, type ToolResultStore, type ToolResultSummary, type ToolResultWriteInput, type ToolResultWriteOutput, } from "./tool-result-store.js";
export { RolloverIdentityError, RolloverIntegrityError, RolloverTransitionError, createRolloverStore, rebuildRolloverIndex, ROLLOVER_REF_KIND, type RolloverListFilters, type RolloverStore, type RolloverSummary, } from "./rollover-store.js";
export { ProjectMetadataIntegrityError, createProjectStore, type ProjectStore, } from "./project-store.js";
export { RecoveryError, type ProjectRecovery } from "./recovery.js";
export { History, type HistoryEntry, type HistoryQuery, type RecordKind } from "./history.js";
export { generateId, projectIdFromSeed, projectIdFromSeedFull, } from "./ids.js";
export { AtomicWriteError, atomicWriteBytes, atomicWriteFile, ensureDir, readBytes, } from "./atomic.js";
export { canonicalJsonStringify, seal, verify, sha256Hex, type IntegrityEnvelope, } from "./integrity.js";
export { appendIndexEntry, clearIndex, readIndex, rebuildIndex, type IndexEntry, } from "./index-table.js";
export { defaultStorePath, projectDir, resolveStorePath, rolloverRequestPath, storeLayout, toolResultDir, toolResultMetadataPath, toolResultPayloadPath, CMV3_HOME_SUBDIR, CMV3_SCHEMA_VERSION, SCHEMA_FILENAME, type StoreLayout, } from "./paths.js";
export { type ProjectAdapterKind, type ProjectMetadata, type SessionRecord, SESSION_SCHEMA_VERSION, METADATA_SCHEMA_VERSION, } from "./records.js";
export { ACTIVE_VIEW_BOUNDS, buildActiveView, buildFailureActiveView, buildSafeBoundedText, DEFAULT_ACTIVE_VIEW_POLICY, TOOL_RESULT_METADATA_SCHEMA_VERSION, TOOL_RESULT_REF_KIND, TOOL_RESULT_SCHEMA_VERSION, validateActiveViewPolicy, validateToolResultMetadata, type ActiveViewPolicy, type ToolResultActiveView, type ToolResultKind, type ToolResultMetadata, } from "../core/tool-result.js";
//# sourceMappingURL=index.d.ts.map