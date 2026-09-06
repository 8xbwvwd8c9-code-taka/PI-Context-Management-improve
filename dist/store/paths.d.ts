/**
 * Path resolution for the CMV3 runtime store.
 *
 * Per R02 §10:
 *   - local-first
 *   - outside the target Git repo by default
 *   - safe permissions
 *   - no secrets in filenames
 *
 * The default store lives under the user home, NOT under the
 * target project directory:
 *
 *   <home>/.pi/cmv3/
 *     projects/<opaque-project-id>/
 *       metadata.json
 *       checkpoints/<id>.json
 *       handoffs/<id>.json
 *       sessions/<id>.json
 *       tool-results/<id>/
 *         metadata.json
 *         payload.bin
 *       index/
 *         checkpoints.jsonl
 *         handoffs.jsonl
 *         sessions.jsonl
 *         tool-results.jsonl
 *     schema.json
 *
 * Callers may override via:
 *   - config.storage_path (absolute path or `~`-prefixed)
 *   - env var CMV3_STORE_PATH (overrides config; for tests)
 *
 * The store path is NEVER derived from the target project path
 * except via the opaque project-id (a hash), so the directory
 * layout of the store does not leak the absolute project path.
 */
export declare const CMV3_HOME_SUBDIR: readonly [".pi", "cmv3"];
export declare const SCHEMA_FILENAME = "schema.json";
export declare const CMV3_SCHEMA_VERSION: "1.0.0";
export interface StoreLayout {
    root: string;
    projectsRoot: string;
}
export interface ResolvedStoreOptions {
    storagePath: string;
    home: string;
}
export declare function defaultStorePath(home?: string): string;
export declare function resolveStorePath(input: string | undefined, home?: string): string;
export declare function storeLayout(root: string): StoreLayout;
export declare function projectDir(layout: StoreLayout, projectId: string): string;
export declare function projectSubpaths(): {
    metadata: string;
    checkpoints: string;
    handoffs: string;
    sessions: string;
    toolResults: string;
    rollovers: string;
    index: string;
};
export declare function checkpointPath(layout: StoreLayout, projectId: string, id: string): string;
export declare function handoffPath(layout: StoreLayout, projectId: string, id: string): string;
export declare function sessionPath(layout: StoreLayout, projectId: string, id: string): string;
export declare function metadataPath(layout: StoreLayout, projectId: string): string;
export declare function indexPath(layout: StoreLayout, projectId: string, kind: "checkpoints" | "handoffs" | "sessions" | "tool-results" | "rollovers"): string;
export declare function schemaPath(layout: StoreLayout): string;
/**
 * Tool-result layout (S03). The authoritative record is a
 * directory: `<id>/metadata.json` plus `<id>/payload.bin`. The
 * id is the same opaque id used in the cmv3://tool/<id> ref.
 * Filenames contain no command, payload, or absolute project path.
 */
export declare function toolResultDir(layout: StoreLayout, projectId: string, id: string): string;
export declare function toolResultMetadataPath(layout: StoreLayout, projectId: string, id: string): string;
export declare function toolResultPayloadPath(layout: StoreLayout, projectId: string, id: string): string;
/**
 * Rollover layout (S04). The RolloverRequest is a small JSON
 * record. The directory layout (per-id directory) is used so the
 * rollover can later carry auxiliary files (e.g. a sealed
 * "executed" snapshot) without rewriting the historical record.
 * Filenames contain no payload, no command body, no project path.
 */
export declare function rolloverDir(layout: StoreLayout, projectId: string, id: string): string;
export declare function rolloverRequestPath(layout: StoreLayout, projectId: string, id: string): string;
/**
 * Reject storage paths that would be unsafe (root, home root, or
 * already inside a non-CMV3 directory without an override flag).
 */
export declare function isSafeStorePath(path: string, home?: string): boolean;
/**
 * True if `path` is already a populated directory that the
 * caller is asking us to use as a store root, AND it is not the
 * target project directory.
 */
export declare function looksLikeCmv3Root(path: string): boolean;
//# sourceMappingURL=paths.d.ts.map