/**
 * Pi runtime — public surface.
 *
 * S01 exposes only the no-op extension entrypoint and package
 * identity. S02..S04 will add the lifecycle hooks, telemetry,
 * tool-result interception, and rollover orchestrator behind this
 * same surface.
 */

export {
	default,
	PACKAGE_NAME,
	PACKAGE_PHASE,
	PACKAGE_VERSION,
} from "./extension.js";
