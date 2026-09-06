/**
 * Public surface of the CMV3 durable store.
 *
 * The store is intentionally a library: S02 implements the data
 * plane, S03 attaches tool-result virtualization, S04 attaches the
 * rollover orchestrator. None of the live Pi lifecycle hooks are
 * wired here.
 */
export { openStore, rebuildAll, } from "./store.js";
export { CheckpointIntegrityError, createCheckpointStore, } from "./checkpoint-store.js";
export { HandoffIntegrityError, createHandoffStore, HANDOFF_REF_KIND, HANDOFF_SCHEMA_VERSION, } from "./handoff-store.js";
export { SessionIntegrityError, createSessionStore, SESSION_REF_KIND, } from "./session-store.js";
export { ToolResultAccessError, ToolResultPersistenceError, createToolResultStore, rebuildToolResultIndex, } from "./tool-result-store.js";
export { RolloverIdentityError, RolloverIntegrityError, RolloverTransitionError, createRolloverStore, rebuildRolloverIndex, ROLLOVER_REF_KIND, } from "./rollover-store.js";
export { ProjectMetadataIntegrityError, createProjectStore, } from "./project-store.js";
export { RecoveryError } from "./recovery.js";
export { History } from "./history.js";
export { generateId, projectIdFromSeed, projectIdFromSeedFull, } from "./ids.js";
export { AtomicWriteError, atomicWriteBytes, atomicWriteFile, ensureDir, readBytes, } from "./atomic.js";
export { canonicalJsonStringify, seal, verify, sha256Hex, } from "./integrity.js";
export { appendIndexEntry, clearIndex, readIndex, rebuildIndex, } from "./index-table.js";
export { defaultStorePath, projectDir, resolveStorePath, rolloverRequestPath, storeLayout, toolResultDir, toolResultMetadataPath, toolResultPayloadPath, CMV3_HOME_SUBDIR, CMV3_SCHEMA_VERSION, SCHEMA_FILENAME, } from "./paths.js";
export { SESSION_SCHEMA_VERSION, METADATA_SCHEMA_VERSION, } from "./records.js";
// Re-export the S03 tool-result pure contract so callers can
// import validation and active-view helpers from the store barrel.
export { ACTIVE_VIEW_BOUNDS, buildActiveView, buildFailureActiveView, buildSafeBoundedText, DEFAULT_ACTIVE_VIEW_POLICY, TOOL_RESULT_METADATA_SCHEMA_VERSION, TOOL_RESULT_REF_KIND, TOOL_RESULT_SCHEMA_VERSION, validateActiveViewPolicy, validateToolResultMetadata, } from "../core/tool-result.js";
//# sourceMappingURL=index.js.map