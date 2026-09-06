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

/** Hard ordering invariant from R02 §3. */
const ORDER_KEYS = [
	"target",
	"sweep",
	"checkpoint",
	"rollover",
	"emergency",
] as const;

/**
 * Validate a profile's internal ordering.
 * Throws a descriptive Error on any violation; never reorders silently.
 */
export function validateProfileOrdering(p: ContextProfile): void {
	if (!(p.max_context > 0)) {
		throw new Error(
			`profile[${p.name}]: max_context must be > 0 (got ${p.max_context})`,
		);
	}
	if (!(p.target > 0)) {
		throw new Error(`profile[${p.name}]: target must be > 0 (got ${p.target})`);
	}
	if (!(p.output_reserve > 0)) {
		throw new Error(
			`profile[${p.name}]: output_reserve must be > 0 (got ${p.output_reserve})`,
		);
	}
	if (p.output_reserve >= p.max_context) {
		throw new Error(
			`profile[${p.name}]: output_reserve (${p.output_reserve}) must be < max_context (${p.max_context})`,
		);
	}
	for (let i = 0; i < ORDER_KEYS.length - 1; i++) {
		const lo = ORDER_KEYS[i];
		const hi = ORDER_KEYS[i + 1];
		const loVal = p[lo];
		const hiVal = p[hi];
		if (!(loVal < hiVal)) {
			throw new Error(
				`profile[${p.name}]: ${lo} (${loVal}) must be < ${hi} (${hiVal})`,
			);
		}
	}
	if (!(p.emergency < p.max_context)) {
		throw new Error(
			`profile[${p.name}]: emergency (${p.emergency}) must be < max_context (${p.max_context})`,
		);
	}
}

/**
 * Frozen tiny profile values. R02 §3.
 */
export const TINY_PROFILE: ContextProfile = Object.freeze({
	name: "tiny",
	max_context: 4096,
	target: 2200,
	sweep: 2600,
	checkpoint: 2900,
	rollover: 3200,
	emergency: 3600,
	output_reserve: 512,
	fitted_to_physical: false,
});

/**
 * Frozen local_32k profile values. R02 §3.
 */
export const LOCAL_32K_PROFILE: ContextProfile = Object.freeze({
	name: "local_32k",
	max_context: 32768,
	target: 16000,
	sweep: 20000,
	checkpoint: 22000,
	rollover: 26000,
	emergency: 28672,
	output_reserve: 4096,
	fitted_to_physical: false,
});

/**
 * Frozen large / cloud ratios. R02 §3.
 */
export const LARGE_RATIOS: LargeProfileRatios = Object.freeze({
	target_ratio: 0.45,
	sweep_ratio: 0.6,
	checkpoint_ratio: 0.68,
	rollover_ratio: 0.78,
	emergency_ratio: 0.88,
	output_reserve_ratio: 0.1,
});

/** Hard cap on the `output_reserve` for the large profile. */
export const OUTPUT_RESERVE_LARGE_CAP = 4096;

/** Threshold caps used by `selectProfile`. */
export const TINY_MAX_CONTEXT_CAP = 4096;
export const LOCAL_32K_MAX_CONTEXT_CAP = 32768;

/**
 * Materialize a `large` profile from a physical cap.
 *
 * `max_context` is set to the supplied cap; thresholds are derived
 * from the frozen ratios. `output_reserve` is also a ratio, capped
 * at `OUTPUT_RESERVE_LARGE_CAP`.
 */
export function materializeLargeProfile(max_context: number): ContextProfile {
	if (!Number.isFinite(max_context) || max_context <= 0) {
		throw new Error(
			`materializeLargeProfile: max_context must be a finite number > 0 (got ${max_context})`,
		);
	}
	if (max_context <= TINY_MAX_CONTEXT_CAP) {
		throw new Error(
			`materializeLargeProfile: cap ${max_context} is at or below tiny cap (${TINY_MAX_CONTEXT_CAP}); use tiny instead`,
		);
	}
	const rawOutputReserve = Math.floor(max_context * LARGE_RATIOS.output_reserve_ratio);
	const output_reserve = Math.min(rawOutputReserve, OUTPUT_RESERVE_LARGE_CAP);
	const profile: ContextProfile = {
		name: "large",
		max_context,
		target: Math.floor(max_context * LARGE_RATIOS.target_ratio),
		sweep: Math.floor(max_context * LARGE_RATIOS.sweep_ratio),
		checkpoint: Math.floor(max_context * LARGE_RATIOS.checkpoint_ratio),
		rollover: Math.floor(max_context * LARGE_RATIOS.rollover_ratio),
		emergency: Math.floor(max_context * LARGE_RATIOS.emergency_ratio),
		output_reserve,
		fitted_to_physical: false,
	};
	validateProfileOrdering(profile);
	return profile;
}

/**
 * Derive a fitted profile when the physical cap is smaller than the
 * requested profile's `max_context`. Thresholds are scaled down
 * preserving ratios; `output_reserve` is preserved up to its cap.
 *
 * Selection remains deterministic.
 */
export function fitProfileToPhysical(
	profile: ContextProfile,
	physical_cap: number,
): ContextProfile {
	if (!Number.isFinite(physical_cap) || physical_cap <= 0) {
		throw new Error(
			`fitProfileToPhysical: physical_cap must be a finite number > 0 (got ${physical_cap})`,
		);
	}
	if (physical_cap >= profile.max_context) {
		// No fit needed; return a frozen copy that marks fitted_to_physical=false.
		return { ...profile, fitted_to_physical: false };
	}

	const scale = physical_cap / profile.max_context;
	const fit = (v: number) => Math.max(1, Math.floor(v * scale));

	const fitted: ContextProfile = {
		name: profile.name,
		max_context: physical_cap,
		target: fit(profile.target),
		sweep: fit(profile.sweep),
		checkpoint: fit(profile.checkpoint),
		rollover: fit(profile.rollover),
		emergency: fit(profile.emergency),
		output_reserve: Math.min(profile.output_reserve, fit(profile.output_reserve)),
		fitted_to_physical: true,
	};
	validateProfileOrdering(fitted);
	return fitted;
}

/**
 * Cap-driven profile selection. R02 §3.
 *
 * No model-id map. No LLM call. Deterministic.
 */
export function selectProfile(physical_cap: number): ContextProfile {
	if (!Number.isFinite(physical_cap) || physical_cap <= 0) {
		throw new Error(
			`selectProfile: physical_cap must be a finite number > 0 (got ${physical_cap})`,
		);
	}
	if (physical_cap <= TINY_MAX_CONTEXT_CAP) {
		return fitProfileToPhysical(TINY_PROFILE, physical_cap);
	}
	if (physical_cap <= LOCAL_32K_MAX_CONTEXT_CAP) {
		return fitProfileToPhysical(LOCAL_32K_PROFILE, physical_cap);
	}
	return materializeLargeProfile(physical_cap);
}
