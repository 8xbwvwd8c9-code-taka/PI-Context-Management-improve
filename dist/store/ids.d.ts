/**
 * Opaque, collision-resistant ID generation for CMV3 store records.
 *
 * Per R02 §8 / §10:
 *  - opaque (no secret, no raw cwd, no path in the id)
 *  - stable (a given ref resolves to the same artifact for its lifetime)
 *  - no payload in the id
 *  - fits the S01 ref ID alphabet [a-z0-9_-]{8,128}
 *
 * We compose 16 hex-encoded bytes (128 bits) of CSPRNG entropy with
 * an 8-char base36 timestamp prefix. Both halves are lower-case +
 * alphanumerics + underscore, so the joined form is always within
 * the S01 ref ID alphabet.
 *
 * NOTE: we deliberately do NOT use a monotonic counter, file path,
 * PID, hostname, or session id. The id must be:
 *   1. non-secret
 *   2. collision-free across processes / restarts
 *   3. portable (the same id can be computed on any host)
 * The first two are satisfied by CSPRNG + 128 bits; the third is
 * satisfied by avoiding any host-specific input.
 */
/**
 * Generate a new opaque id with the timestamp prefix as a stable
 * secondary key. The id is suitable for use as the S01 ref id
 * component (matches `[a-z0-9_-]{8,128}`) and for use as a
 * filename (only `a-z0-9_-`, no path separators).
 */
export declare function generateId(): string;
/**
 * Generate a project-id that is stable across sessions.
 *
 * Strategy: hash the supplied seed bytes with SHA-256 and emit the
 * hex digest lower-cased. We deliberately do NOT use any host-
 * specific prefix so the id is portable.
 *
 * For Git projects the seed is the canonical remote URL (or
 * origin-equivalent). For non-Git projects the seed is a stable,
 * caller-supplied identity string (e.g. normalized absolute path
 * with secrets stripped).
 */
export declare function projectIdFromSeed(seed: string): string;
export declare function projectIdFromSeedFull(seed: string): string;
//# sourceMappingURL=ids.d.ts.map