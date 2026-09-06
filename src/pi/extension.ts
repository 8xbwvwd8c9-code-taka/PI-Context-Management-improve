/**
 * Pi runtime extension — S01 no-op entrypoint.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §2.B, §13.
 *
 * S01 contract:
 *   - load
 *   - register package identity
 *   - expose version metadata if Pi convention supports it
 *
 * S01 does NOT:
 *   - inspect live context
 *   - change context
 *   - call the native compaction entrypoint
 *   - trigger checkpoint
 *   - trigger NEW session
 *   - intercept tool results
 *   - create history
 *   - write runtime telemetry
 *   - alter the legacy water marks
 *   - modify existing Pi extensions
 *
 * The full extension is deferred to S04.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Package identity. Mirrored from package.json for runtime introspection. */
export const PACKAGE_NAME = "pi-context-management-improve";
export const PACKAGE_VERSION = "0.1.0";
export const PACKAGE_PHASE = "S01-NOOP-SKELETON";

/**
 * Default export. Wired as a Pi extension entrypoint per
 * `pi.extensions` in package.json.
 *
 * This is intentionally a no-op skeleton. It does NOT register any
 * lifecycle hooks, custom tools, commands, or session entries. It
 * exists to validate that the combined Skill + Extension package
 * pattern loads cleanly in a Pi install without altering runtime
 * behavior.
 */
export default function cmv3Extension(_pi: ExtensionAPI): void {
	// S01: intentionally empty.
	//
	// Future WPs (S02..S04) will register lifecycle hooks, the
	// checkpoint / handoff / ref recovery tools, and the rollover
	// orchestrator. None of that lands in S01.
	//
	// The function body is empty by design. The named export
	// exists so the entrypoint can be statically checked and so the
	// package identity is visible in the bundle.
	return;
}
