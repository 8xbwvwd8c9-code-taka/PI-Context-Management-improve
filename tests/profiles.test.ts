/**
 * Profile / budget / pressure validation tests.
 *
 * Covers R02 §3 + R02 §5 boundary semantics. S01 test IDs 6..18.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
	TINY_PROFILE,
	LOCAL_32K_PROFILE,
	LARGE_RATIOS,
	TINY_MAX_CONTEXT_CAP,
	LOCAL_32K_MAX_CONTEXT_CAP,
	OUTPUT_RESERVE_LARGE_CAP,
	materializeLargeProfile,
	fitProfileToPhysical,
	selectProfile,
	validateProfileOrdering,
} from "../src/core/profiles.js";
import {
	classifyPressure,
	headroomToTarget,
	headroomToEmergency,
	PRESSURE_STATES,
} from "../src/core/pressure.js";

describe("profiles: tiny exact policy (test 6)", () => {
	it("matches the R02 §3 frozen values", () => {
		assert.equal(TINY_PROFILE.name, "tiny");
		assert.equal(TINY_PROFILE.max_context, 4096);
		assert.equal(TINY_PROFILE.target, 2200);
		assert.equal(TINY_PROFILE.sweep, 2600);
		assert.equal(TINY_PROFILE.checkpoint, 2900);
		assert.equal(TINY_PROFILE.rollover, 3200);
		assert.equal(TINY_PROFILE.emergency, 3600);
		assert.equal(TINY_PROFILE.output_reserve, 512);
	});
	it("passes the frozen ordering", () => {
		assert.doesNotThrow(() => validateProfileOrdering(TINY_PROFILE));
	});
});

describe("profiles: local_32k exact policy (test 7)", () => {
	it("matches the R02 §3 frozen values", () => {
		assert.equal(LOCAL_32K_PROFILE.name, "local_32k");
		assert.equal(LOCAL_32K_PROFILE.max_context, 32768);
		assert.equal(LOCAL_32K_PROFILE.target, 16000);
		assert.equal(LOCAL_32K_PROFILE.sweep, 20000);
		assert.equal(LOCAL_32K_PROFILE.checkpoint, 22000);
		assert.equal(LOCAL_32K_PROFILE.rollover, 26000);
		assert.equal(LOCAL_32K_PROFILE.emergency, 28672);
		assert.equal(LOCAL_32K_PROFILE.output_reserve, 4096);
	});
	it("passes the frozen ordering", () => {
		assert.doesNotThrow(() => validateProfileOrdering(LOCAL_32K_PROFILE));
	});
});

describe("profiles: large ratio materialization (test 8)", () => {
	it("materializes thresholds from the frozen ratios", () => {
		const p = materializeLargeProfile(100_000);
		assert.equal(p.name, "large");
		assert.equal(p.max_context, 100_000);
		assert.equal(p.target, Math.floor(100_000 * LARGE_RATIOS.target_ratio));
		assert.equal(p.sweep, Math.floor(100_000 * LARGE_RATIOS.sweep_ratio));
		assert.equal(p.checkpoint, Math.floor(100_000 * LARGE_RATIOS.checkpoint_ratio));
		assert.equal(p.rollover, Math.floor(100_000 * LARGE_RATIOS.rollover_ratio));
		assert.equal(p.emergency, Math.floor(100_000 * LARGE_RATIOS.emergency_ratio));
	});
	it("caps output_reserve at OUTPUT_RESERVE_LARGE_CAP", () => {
		const p = materializeLargeProfile(1_000_000);
		assert.equal(p.output_reserve, OUTPUT_RESERVE_LARGE_CAP);
	});
	it("rejects a cap at or below the tiny cap", () => {
		assert.throws(
			() => materializeLargeProfile(TINY_MAX_CONTEXT_CAP),
			/tiny cap/,
		);
	});
});

describe("profiles: invalid ordering rejected (test 9)", () => {
	it("rejects target == 0", () => {
		assert.throws(
			() =>
				validateProfileOrdering({
					...TINY_PROFILE,
					target: 0,
				}),
			/target must be > 0/,
		);
	});
	it("rejects target >= sweep", () => {
		assert.throws(
			() =>
				validateProfileOrdering({
					...TINY_PROFILE,
					target: TINY_PROFILE.sweep,
				}),
			/target .* must be < sweep/,
		);
	});
	it("rejects sweep >= checkpoint", () => {
		assert.throws(
			() =>
				validateProfileOrdering({
					...TINY_PROFILE,
					sweep: TINY_PROFILE.checkpoint,
				}),
			/sweep .* must be < checkpoint/,
		);
	});
	it("rejects checkpoint >= rollover", () => {
		assert.throws(
			() =>
				validateProfileOrdering({
					...TINY_PROFILE,
					checkpoint: TINY_PROFILE.rollover,
				}),
			/checkpoint .* must be < rollover/,
		);
	});
	it("rejects rollover >= emergency", () => {
		assert.throws(
			() =>
				validateProfileOrdering({
					...TINY_PROFILE,
					rollover: TINY_PROFILE.emergency,
				}),
			/rollover .* must be < emergency/,
		);
	});
	it("rejects emergency >= max_context", () => {
		assert.throws(
			() =>
				validateProfileOrdering({
					...TINY_PROFILE,
					emergency: TINY_PROFILE.max_context,
				}),
			/emergency .* must be < max_context/,
		);
	});
	it("never silently reorders", () => {
		const bad = {
			...TINY_PROFILE,
			sweep: 2100, // < target
		};
		assert.throws(() => validateProfileOrdering(bad));
	});
});

describe("profiles: max_context != operating target (test 10)", () => {
	it("operating target is a fraction of max_context on large", () => {
		const p = materializeLargeProfile(100_000);
		assert.notEqual(p.max_context, p.target);
		assert.ok(p.target < p.max_context);
		assert.equal(p.target, Math.floor(100_000 * 0.45));
	});
	it("operating target is also strictly less on tiny and local_32k", () => {
		assert.ok(TINY_PROFILE.target < TINY_PROFILE.max_context);
		assert.ok(LOCAL_32K_PROFILE.target < LOCAL_32K_PROFILE.max_context);
	});
});

describe("profiles: output reserve exists (test 11)", () => {
	it("every profile carries a positive output_reserve", () => {
		assert.ok(TINY_PROFILE.output_reserve > 0);
		assert.ok(LOCAL_32K_PROFILE.output_reserve > 0);
		const large = materializeLargeProfile(200_000);
		assert.ok(large.output_reserve > 0);
	});
	it("output_reserve is strictly less than max_context", () => {
		assert.ok(TINY_PROFILE.output_reserve < TINY_PROFILE.max_context);
		assert.ok(LOCAL_32K_PROFILE.output_reserve < LOCAL_32K_PROFILE.max_context);
	});
});

describe("profiles: fit-to-physical", () => {
	it("scales a profile down when physical cap is smaller", () => {
		const fitted = fitProfileToPhysical(LOCAL_32K_PROFILE, 16_384);
		assert.equal(fitted.max_context, 16_384);
		assert.equal(fitted.fitted_to_physical, true);
		assert.ok(fitted.target < LOCAL_32K_PROFILE.target);
	});
	it("returns an unfitted copy when physical cap >= max_context", () => {
		const fitted = fitProfileToPhysical(LOCAL_32K_PROFILE, 64_000);
		assert.equal(fitted.fitted_to_physical, false);
		assert.equal(fitted.max_context, LOCAL_32K_PROFILE.max_context);
	});
});

describe("profiles: cap-driven selection", () => {
	it("selects tiny at the tiny cap", () => {
		const p = selectProfile(TINY_MAX_CONTEXT_CAP);
		assert.equal(p.name, "tiny");
	});
	it("selects local_32k at the local_32k cap", () => {
		const p = selectProfile(LOCAL_32K_MAX_CONTEXT_CAP);
		assert.equal(p.name, "local_32k");
	});
	it("selects large above the local_32k cap", () => {
		const p = selectProfile(100_000);
		assert.equal(p.name, "large");
	});
	it("rejects invalid physical cap", () => {
		assert.throws(() => selectProfile(0), /> 0/);
		assert.throws(() => selectProfile(-1), /> 0/);
		assert.throws(() => selectProfile(Number.NaN), /> 0/);
	});
});

describe("pressure: below target = NORMAL (test 12)", () => {
	it("NORMAL when usage < target", () => {
		assert.equal(
			classifyPressure({ tokens: TINY_PROFILE.target - 1 }, TINY_PROFILE),
			"NORMAL",
		);
	});
	it("NORMAL at usage = 0", () => {
		assert.equal(classifyPressure({ tokens: 0 }, TINY_PROFILE), "NORMAL");
	});
});

describe("pressure: target boundary (test 13)", () => {
	it("TARGET_EXCEEDED at usage == target", () => {
		assert.equal(
			classifyPressure({ tokens: TINY_PROFILE.target }, TINY_PROFILE),
			"TARGET_EXCEEDED",
		);
	});
});

describe("pressure: sweep boundary (test 14)", () => {
	it("SWEEP at usage == sweep", () => {
		assert.equal(
			classifyPressure({ tokens: TINY_PROFILE.sweep }, TINY_PROFILE),
			"SWEEP",
		);
	});
});

describe("pressure: checkpoint boundary (test 15)", () => {
	it("CHECKPOINT at usage == checkpoint", () => {
		assert.equal(
			classifyPressure({ tokens: TINY_PROFILE.checkpoint }, TINY_PROFILE),
			"CHECKPOINT",
		);
	});
});

describe("pressure: rollover boundary (test 16)", () => {
	it("ROLLOVER at usage == rollover", () => {
		assert.equal(
			classifyPressure({ tokens: TINY_PROFILE.rollover }, TINY_PROFILE),
			"ROLLOVER",
		);
	});
});

describe("pressure: emergency boundary (test 17)", () => {
	it("EMERGENCY at usage == emergency", () => {
		assert.equal(
			classifyPressure({ tokens: TINY_PROFILE.emergency }, TINY_PROFILE),
			"EMERGENCY",
		);
	});
});

describe("pressure: max-context handling (test 18)", () => {
	it("EMERGENCY at usage >= max_context", () => {
		assert.equal(
			classifyPressure({ tokens: TINY_PROFILE.max_context }, TINY_PROFILE),
			"EMERGENCY",
		);
		assert.equal(
			classifyPressure({ tokens: TINY_PROFILE.max_context + 1 }, TINY_PROFILE),
			"EMERGENCY",
		);
	});
	it("states are exactly the frozen PRESSURE_STATES list", () => {
		assert.deepEqual([...PRESSURE_STATES], [
			"NORMAL",
			"TARGET_EXCEEDED",
			"SWEEP",
			"CHECKPOINT",
			"ROLLOVER",
			"EMERGENCY",
		]);
	});
	it("rejects negative or non-finite usage", () => {
		assert.throws(() => classifyPressure({ tokens: -1 }, TINY_PROFILE));
		assert.throws(() => classifyPressure({ tokens: Number.NaN }, TINY_PROFILE));
	});
});

describe("pressure: headroom helpers", () => {
	it("headroomToTarget turns negative on TARGET_EXCEEDED", () => {
		assert.equal(
			headroomToTarget({ tokens: TINY_PROFILE.target + 100 }, TINY_PROFILE),
			-100,
		);
	});
	it("headroomToEmergency turns negative on EMERGENCY", () => {
		assert.equal(
			headroomToEmergency({ tokens: TINY_PROFILE.emergency + 100 }, TINY_PROFILE),
			-100,
		);
	});
});
