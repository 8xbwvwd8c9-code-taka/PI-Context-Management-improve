export declare const KNOWN_UNSAFE_PI_VERSIONS: readonly ["0.85.1"];
/** No distributed interactive Pi runtime has passed the required R1-R6 gate yet. */
export declare const VALIDATED_SAFE_PI_VERSIONS: readonly [];
export type PiRuntimeCompatibility = {
    classification: "SAFE";
    code: "pi_newsession_runtime_validated";
    version: string;
} | {
    classification: "KNOWN_UNSAFE";
    code: "pi_newsession_rebind_unsafe";
    version: string;
} | {
    classification: "UNVALIDATED";
    code: "pi_runtime_version_unavailable";
    version: "unknown";
} | {
    classification: "UNVALIDATED";
    code: "pi_runtime_version_unparsable";
    version: string;
} | {
    classification: "UNVALIDATED";
    code: "pi_newsession_runtime_unvalidated";
    version: string;
};
/** Resolve the peer package only when rollover compatibility is evaluated. */
export declare function detectPiRuntimeVersion(): string;
/**
 * Only an exact identity in validatedSafeVersions is trusted. Production's
 * list is intentionally empty until a distributed runtime passes R1-R6.
 */
export declare function classifyPiRuntimeCompatibility(version: string, validatedSafeVersions?: readonly string[]): PiRuntimeCompatibility;
//# sourceMappingURL=runtime-compatibility.d.ts.map