/**
 * Portable core — configuration.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §11 / §12.
 *
 * Pure parsing + default resolution. Zero-config generic Git
 * operation is required. Config is optional. Invalid config fails
 * safely; unknown keys are tolerated (defaults applied).
 */
import { OUTPUT_RESERVE_LARGE_CAP, TINY_MAX_CONTEXT_CAP, } from "./profiles.js";
export const CMV3_MODES = Object.freeze([
    "legacy",
    "v3-observe",
    "v3",
]);
export const DEFAULT_MODE = "legacy";
/**
 * Default resolved config. Used when no `.cmv3.json` / `.pi/cmv3.json`
 * is present.
 */
export function defaultResolvedConfig() {
    return Object.freeze({
        mode: DEFAULT_MODE,
        profile: "auto",
        storage_path: ".cmv3",
        project_adapter: "generic",
        rollover_policy: "natural-then-pressure",
    });
}
/**
 * Resolve a partial config into a fully-populated resolved config.
 * Unknown keys are tolerated. Invalid values throw.
 */
export function resolveConfig(input = {}) {
    const mode = input.mode ?? DEFAULT_MODE;
    if (!isMode(mode)) {
        throw new Error(`resolveConfig: mode must be one of ${CMV3_MODES.join(" | ")} (got ${JSON.stringify(mode)})`);
    }
    const profile = input.profile ?? "auto";
    if (profile !== "auto" && !isProfileName(profile)) {
        throw new Error(`resolveConfig: profile must be one of tiny | local_32k | large | auto (got ${JSON.stringify(profile)})`);
    }
    const storage_path = input.storage_path ?? ".cmv3";
    if (typeof storage_path !== "string" || storage_path.length === 0) {
        throw new Error("resolveConfig: storage_path must be a non-empty string");
    }
    const project_adapter = input.project_adapter ?? "generic";
    if (typeof project_adapter !== "string" || project_adapter.length === 0) {
        throw new Error("resolveConfig: project_adapter must be a non-empty string");
    }
    const rollover_policy = input.rollover_policy ?? "natural-then-pressure";
    if (typeof rollover_policy !== "string" || rollover_policy.length === 0) {
        throw new Error("resolveConfig: rollover_policy must be a non-empty string");
    }
    return Object.freeze({
        mode,
        profile,
        storage_path,
        project_adapter,
        rollover_policy,
    });
}
/**
 * Parse a raw JSON value (or `undefined`) into a partial config.
 * Throws on invalid JSON or wrong root type. Unknown keys are
 * tolerated at the top level; invalid values are caught at
 * `resolveConfig` time.
 */
export function parseConfig(raw) {
    if (raw === undefined)
        return {};
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`parseConfig: invalid JSON (${err.message})`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("parseConfig: top-level value must be a JSON object");
    }
    // Pass through; resolveConfig() validates per-key.
    return parsed;
}
function isMode(v) {
    return typeof v === "string" && CMV3_MODES.includes(v);
}
function isProfileName(v) {
    return v === "tiny" || v === "local_32k" || v === "large";
}
/**
 * Public surface constants — exported here so consumers can mirror
 * the frozen defaults without re-importing from `profiles.ts`.
 */
export { OUTPUT_RESERVE_LARGE_CAP, TINY_MAX_CONTEXT_CAP };
//# sourceMappingURL=config.js.map