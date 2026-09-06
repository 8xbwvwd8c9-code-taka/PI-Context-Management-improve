/**
 * Portable core — configuration.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §11 / §12.
 *
 * Pure parsing + default resolution. Zero-config generic Git
 * operation is required. Config is optional. Invalid config fails
 * safely; unknown keys are tolerated (defaults applied).
 */
import { OUTPUT_RESERVE_LARGE_CAP, TINY_MAX_CONTEXT_CAP, type ProfileName } from "./profiles.js";
/**
 * Frozen CMV3 modes. R02 §12.
 *
 *   legacy     — no CMV3 behavioral takeover
 *   v3-observe — calculate / record decisions but do not execute rollover
 *   v3         — full CMV3 behavior (deferred to S04; not active in S01)
 */
export type CMV3Mode = "legacy" | "v3-observe" | "v3";
export declare const CMV3_MODES: readonly CMV3Mode[];
export declare const DEFAULT_MODE: CMV3Mode;
/**
 * Optional configuration surface. R02 §11.
 */
export interface CMV3Config {
    /** Active profile. Overrides cap-driven selection. */
    readonly profile?: ProfileName;
    /** Active mode. Default: legacy. */
    readonly mode?: CMV3Mode;
    /** Storage path override. Default: ${cwd}/.cmv3 (zero-config). */
    readonly storage_path?: string;
    /** Project adapter override. Default: generic Git. */
    readonly project_adapter?: "generic" | "git" | string;
    /** Rollover policy override. Reserved for S04. */
    readonly rollover_policy?: "natural-only" | "natural-then-pressure" | string;
}
/**
 * Resolved configuration with all defaults applied. Pure; no I/O.
 */
export interface ResolvedCMV3Config {
    readonly mode: CMV3Mode;
    readonly profile: ProfileName | "auto";
    readonly storage_path: string;
    readonly project_adapter: string;
    readonly rollover_policy: string;
}
/**
 * Default resolved config. Used when no `.cmv3.json` / `.pi/cmv3.json`
 * is present.
 */
export declare function defaultResolvedConfig(): ResolvedCMV3Config;
/**
 * Resolve a partial config into a fully-populated resolved config.
 * Unknown keys are tolerated. Invalid values throw.
 */
export declare function resolveConfig(input?: Partial<CMV3Config>): ResolvedCMV3Config;
/**
 * Parse a raw JSON value (or `undefined`) into a partial config.
 * Throws on invalid JSON or wrong root type. Unknown keys are
 * tolerated at the top level; invalid values are caught at
 * `resolveConfig` time.
 */
export declare function parseConfig(raw: string | undefined): Partial<CMV3Config>;
/**
 * Public surface constants — exported here so consumers can mirror
 * the frozen defaults without re-importing from `profiles.ts`.
 */
export { OUTPUT_RESERVE_LARGE_CAP, TINY_MAX_CONTEXT_CAP };
//# sourceMappingURL=config.d.ts.map