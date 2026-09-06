export const KNOWN_UNSAFE_PI_VERSIONS = ["0.85.1"];
/** No distributed interactive Pi runtime has passed the required R1-R6 gate yet. */
export const VALIDATED_SAFE_PI_VERSIONS = [];
/** Resolve the peer package only when rollover compatibility is evaluated. */
export function detectPiRuntimeVersion() {
    try {
        const entry = createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent");
        const packageJson = join(dirname(dirname(entry)), "package.json");
        const parsed = JSON.parse(readFileSync(packageJson, "utf8"));
        return typeof parsed.version === "string" ? parsed.version : "";
    }
    catch {
        return "";
    }
}
/**
 * Only an exact identity in validatedSafeVersions is trusted. Production's
 * list is intentionally empty until a distributed runtime passes R1-R6.
 */
export function classifyPiRuntimeCompatibility(version, validatedSafeVersions = VALIDATED_SAFE_PI_VERSIONS) {
    const normalized = version.trim();
    if (normalized.length === 0) {
        return {
            classification: "UNVALIDATED",
            code: "pi_runtime_version_unavailable",
            version: "unknown",
        };
    }
    if (KNOWN_UNSAFE_PI_VERSIONS.includes(normalized)) {
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
//# sourceMappingURL=runtime-compatibility.js.map