/**
 * Portable core — frozen profile contracts.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §3.
 *
 * Pure data + pure validation. No I/O. No Pi. No host project.
 */
/**
 * Profile selection. Cap-driven, deterministic, no LLM call.
 */
export type ProfileName = "tiny" | "local_32k" | "large";
/**
 * Frozen policy defaults. R02 §3.
 *
 * `output_reserve` is mandatory and explicit.
 * `max_context` and operating `target` are separate concepts.
 */
export interface ContextProfile {
    readonly name: ProfileName;
    readonly max_context: number;
    readonly target: number;
    readonly sweep: number;
    readonly checkpoint: number;
    readonly rollover: number;
    readonly emergency: number;
    readonly output_reserve: number;
    readonly fitted_to_physical: boolean;
}
/**
 * Ratio set for the `large` / cloud profile. R02 §3.
 *
 * Applied against `max_context` (or the fitted cap when physical
 * cap < requested `max_context`). `output_reserve` is also a ratio
 * and is capped at 4096.
 */
export interface LargeProfileRatios {
    readonly target_ratio: 0.45;
    readonly sweep_ratio: 0.6;
    readonly checkpoint_ratio: 0.68;
    readonly rollover_ratio: 0.78;
    readonly emergency_ratio: 0.88;
    readonly output_reserve_ratio: 0.1;
}
/**
 * Validate a profile's internal ordering.
 * Throws a descriptive Error on any violation; never reorders silently.
 */
export declare function validateProfileOrdering(p: ContextProfile): void;
/**
 * Frozen tiny profile values. R02 §3.
 */
export declare const TINY_PROFILE: ContextProfile;
/**
 * Frozen local_32k profile values. R02 §3.
 */
export declare const LOCAL_32K_PROFILE: ContextProfile;
/**
 * Frozen large / cloud ratios. R02 §3.
 */
export declare const LARGE_RATIOS: LargeProfileRatios;
/** Hard cap on the `output_reserve` for the large profile. */
export declare const OUTPUT_RESERVE_LARGE_CAP = 4096;
/** Threshold caps used by `selectProfile`. */
export declare const TINY_MAX_CONTEXT_CAP = 4096;
export declare const LOCAL_32K_MAX_CONTEXT_CAP = 32768;
/**
 * Materialize a `large` profile from a physical cap.
 *
 * `max_context` is set to the supplied cap; thresholds are derived
 * from the frozen ratios. `output_reserve` is also a ratio, capped
 * at `OUTPUT_RESERVE_LARGE_CAP`.
 */
export declare function materializeLargeProfile(max_context: number): ContextProfile;
/**
 * Derive a fitted profile when the physical cap is smaller than the
 * requested profile's `max_context`. Thresholds are scaled down
 * preserving ratios; `output_reserve` is preserved up to its cap.
 *
 * Selection remains deterministic.
 */
export declare function fitProfileToPhysical(profile: ContextProfile, physical_cap: number): ContextProfile;
/**
 * Cap-driven profile selection. R02 §3.
 *
 * No model-id map. No LLM call. Deterministic.
 */
export declare function selectProfile(physical_cap: number): ContextProfile;
//# sourceMappingURL=profiles.d.ts.map