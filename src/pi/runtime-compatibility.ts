export const KNOWN_UNSAFE_PI_VERSIONS = ["0.85.1"] as const;
/** No distributed interactive Pi runtime has passed the required R1-R6 gate yet. */
export const VALIDATED_SAFE_PI_VERSIONS = [] as const;

export type PiRuntimeCompatibility =
	| { classification: "SAFE"; code: "pi_newsession_runtime_validated"; version: string }
	| { classification: "KNOWN_UNSAFE"; code: "pi_newsession_rebind_unsafe"; version: string }
	| { classification: "UNVALIDATED"; code: "pi_runtime_version_unavailable"; version: "unknown" }
	| { classification: "UNVALIDATED"; code: "pi_runtime_version_unparsable"; version: string }
	| { classification: "UNVALIDATED"; code: "pi_newsession_runtime_unvalidated"; version: string };

/** Resolve the peer package only when rollover compatibility is evaluated. */
export function detectPiRuntimeVersion(): string {
	try {
		const entry = createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent");
		const packageJson = join(dirname(dirname(entry)), "package.json");
		const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { version?: unknown };
		return typeof parsed.version === "string" ? parsed.version : "";
	} catch {
		return "";
	}
}

/**
 * Only an exact identity in validatedSafeVersions is trusted. Production's
 * list is intentionally empty until a distributed runtime passes R1-R6.
 */
export function classifyPiRuntimeCompatibility(
	version: string,
	validatedSafeVersions: readonly string[] = VALIDATED_SAFE_PI_VERSIONS,
): PiRuntimeCompatibility {
	const normalized = version.trim();
	if (normalized.length === 0) {
		return {
			classification: "UNVALIDATED",
			code: "pi_runtime_version_unavailable",
			version: "unknown",
		};
	}
	if ((KNOWN_UNSAFE_PI_VERSIONS as readonly string[]).includes(normalized)) {
		return {
			classification: "KNOWN_UNSAFE",
			code: "pi_newsession_rebind_unsafe",
			version: normalized,
		};
	}
	if (validatedSafeVersions.includes(normalized)) {
		return {
			classification: "SAFE",
			code: "pi_newsession_runtime_validated",
			version: normalized,
		};
	}
	if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
		return {
			classification: "UNVALIDATED",
			code: "pi_runtime_version_unparsable",
			version: normalized,
		};
	}
	return {
		classification: "UNVALIDATED",
		code: "pi_newsession_runtime_unvalidated",
		version: normalized,
	};
}
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
