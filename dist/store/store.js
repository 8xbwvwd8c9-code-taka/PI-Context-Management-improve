/**
 * Top-level CMV3 store façade.
 *
 * One `Cmv3Store` instance owns a `StoreLayout` and exposes the
 * individual record stores, history, and recovery helpers. S03
 * attaches the tool-result store; S04 (rollover) will extend the
 * façade with the live orchestrator.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveConfig, } from "../core/config.js";
import { resolveStorePath, storeLayout, } from "./paths.js";
import { createCheckpointStore, } from "./checkpoint-store.js";
import { createHandoffStore, } from "./handoff-store.js";
import { createProjectStore, } from "./project-store.js";
import { createSessionStore, } from "./session-store.js";
import { createToolResultStore, rebuildToolResultIndex, } from "./tool-result-store.js";
import { createRolloverStore, rebuildRolloverIndex, } from "./rollover-store.js";
import { History } from "./history.js";
import { recoverLatestProjectState, } from "./recovery.js";
import { rebuildIndex } from "./index-table.js";
export function openStore(options = {}) {
    const home = options.home ?? process.env["HOME"] ?? "/";
    const storagePath = resolveStorePath(options.storagePath ?? process.env["CMV3_STORE_PATH"], home);
    // Resolve config from caller input. storage_path is overridden
    // by the explicit `options.storagePath` (or env var) so the
    // caller can place the store outside the default home subdir.
    const baseConfig = options.config ?? {};
    const configInput = {
        ...baseConfig,
        storage_path: storagePath,
    };
    const config = resolveConfig(configInput);
    const layout = storeLayout(storagePath);
    mkdirSync(layout.root, { recursive: true, mode: 0o700 });
    mkdirSync(layout.projectsRoot, { recursive: true, mode: 0o700 });
    const checkpoints = createCheckpointStore(layout);
    const handoffs = createHandoffStore(layout);
    const sessions = createSessionStore(layout);
    const toolResults = createToolResultStore(layout);
    const rollovers = createRolloverStore(layout);
    const projects = createProjectStore(layout);
    const history = new History(layout, {
        checkpoints,
        handoffs,
        sessions,
        toolResults,
    });
    return {
        config,
        layout,
        checkpoints,
        handoffs,
        sessions,
        toolResults,
        rollovers,
        projects,
        history,
        recover: (projectId) => recoverLatestProjectState(projects, checkpoints, handoffs, sessions, projectId),
        rebuildAllIndexes: (projectId) => rebuildAll(layout, projectId),
    };
}
/**
 * Re-scan authoritative records and rebuild the derived indexes.
 * The authoritative files (the .json records) are the source of
 * truth; the index files are deterministic projections of them.
 */
function safeReaddir(d) {
    if (!existsSync(d))
        return [];
    return readdirSync(d).filter((f) => f.endsWith(".json"));
}
export function rebuildAll(layout, projectId) {
    const projectRoot = join(layout.projectsRoot, projectId);
    if (!existsSync(projectRoot))
        return;
    const ckpts = safeReaddir(join(projectRoot, "checkpoints"));
    const handoffs = safeReaddir(join(projectRoot, "handoffs"));
    const sessions = safeReaddir(join(projectRoot, "sessions"));
    // Import inline to avoid a circular dep at module init.
    const cp = createCheckpointStore(layout);
    const ho = createHandoffStore(layout);
    const cpEntries = ckpts.map((f) => {
        const id = f.replace(/\.json$/, "");
        const rec = cp.readById(projectId, id);
        return {
            ref: cp.refFor(projectId, id),
            id,
            work_package: rec.work_package,
            status: rec.status,
            created_at: rec.created_at,
            session_id: rec.session_id,
        };
    });
    rebuildIndex(layout, projectId, "checkpoints", cpEntries);
    const hoEntries = handoffs.map((f) => {
        const id = f.replace(/\.json$/, "");
        const rec = ho.readById(projectId, id);
        return {
            ref: ho.refFor(id),
            id,
            work_package: rec.work_package,
            status: rec.status,
        };
    });
    rebuildIndex(layout, projectId, "handoffs", hoEntries);
    const ssEntries = sessions.map((f) => {
        const id = f.replace(/\.json$/, "");
        return { ref: `cmv3://session/${id}`, id };
    });
    rebuildIndex(layout, projectId, "sessions", ssEntries);
    // Tool-result index: metadata only, never the raw payload.
    rebuildToolResultIndex(layout, projectId);
    // Rollover index: per-id directory walk.
    rebuildRolloverIndex(layout, projectId);
}
export { ToolResultAccessError, ToolResultPersistenceError, createToolResultStore, rebuildToolResultIndex, } from "./tool-result-store.js";
export { RolloverIdentityError, RolloverIntegrityError, RolloverTransitionError, createRolloverStore, rebuildRolloverIndex, ROLLOVER_REF_KIND, } from "./rollover-store.js";
//# sourceMappingURL=store.js.map