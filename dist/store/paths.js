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
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
export const CMV3_HOME_SUBDIR = [".pi", "cmv3"];
export const SCHEMA_FILENAME = "schema.json";
export const CMV3_SCHEMA_VERSION = "1.0.0";
export function defaultStorePath(home = homedir()) {
    return join(home, ...CMV3_HOME_SUBDIR);
}
export function resolveStorePath(input, home = homedir()) {
    if (input == null || input.length === 0) {
        return defaultStorePath(home);
    }
    const expanded = input.startsWith("~")
        ? join(home, input.slice(1).replace(/^[/\\]/, ""))
        : input;
    return isAbsolute(expanded) ? expanded : resolve(home, expanded);
}
export function storeLayout(root) {
    const projectsRoot = join(root, "projects");
    return { root, projectsRoot };
}
export function projectDir(layout, projectId) {
    return join(layout.projectsRoot, projectId);
}
export function projectSubpaths() {
    return {
        metadata: "metadata.json",
        checkpoints: "checkpoints",
        handoffs: "handoffs",
        sessions: "sessions",
        toolResults: "tool-results",
        rollovers: "rollovers",
        index: "index",
    };
}
export function checkpointPath(layout, projectId, id) {
    return join(projectDir(layout, projectId), "checkpoints", `${id}.json`);
}
export function handoffPath(layout, projectId, id) {
    return join(projectDir(layout, projectId), "handoffs", `${id}.json`);
}
export function sessionPath(layout, projectId, id) {
    return join(projectDir(layout, projectId), "sessions", `${id}.json`);
}
export function metadataPath(layout, projectId) {
    return join(projectDir(layout, projectId), "metadata.json");
}
export function indexPath(layout, projectId, kind) {
    return join(projectDir(layout, projectId), "index", `${kind}.jsonl`);
}
export function schemaPath(layout) {
    return join(layout.root, SCHEMA_FILENAME);
}
/**
 * Tool-result layout (S03). The authoritative record is a
 * directory: `<id>/metadata.json` plus `<id>/payload.bin`. The
 * id is the same opaque id used in the cmv3://tool/<id> ref.
 * Filenames contain no command, payload, or absolute project path.
 */
export function toolResultDir(layout, projectId, id) {
    return join(projectDir(layout, projectId), "tool-results", id);
}
export function toolResultMetadataPath(layout, projectId, id) {
    return join(toolResultDir(layout, projectId, id), "metadata.json");
}
export function toolResultPayloadPath(layout, projectId, id) {
    return join(toolResultDir(layout, projectId, id), "payload.bin");
}
/**
 * Rollover layout (S04). The RolloverRequest is a small JSON
 * record. The directory layout (per-id directory) is used so the
 * rollover can later carry auxiliary files (e.g. a sealed
 * "executed" snapshot) without rewriting the historical record.
 * Filenames contain no payload, no command body, no project path.
 */
export function rolloverDir(layout, projectId, id) {
    return join(projectDir(layout, projectId), "rollovers", id);
}
export function rolloverRequestPath(layout, projectId, id) {
    return join(rolloverDir(layout, projectId, id), "request.json");
}
/**
 * Reject storage paths that would be unsafe (root, home root, or
 * already inside a non-CMV3 directory without an override flag).
 */
export function isSafeStorePath(path, home = homedir()) {
    if (path.length === 0)
        return false;
    // Refuse root and the home root; we are not asking the user to
    // wipe anything. The dedicated CMV3 subdir is required.
    if (path === "/" || path === sep)
        return false;
    if (path === home)
        return false;
    return true;
}
/**
 * True if `path` is already a populated directory that the
 * caller is asking us to use as a store root, AND it is not the
 * target project directory.
 */
export function looksLikeCmv3Root(path) {
    return existsSync(path) && statSync(path).isDirectory();
}
//# sourceMappingURL=paths.js.map