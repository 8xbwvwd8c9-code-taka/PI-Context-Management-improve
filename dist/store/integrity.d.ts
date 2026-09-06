/**
 * Integrity helpers for CMV3 authoritative records.
 *
 * Per R02 §6 / §10: a checkpoint/handoff/session artifact must carry
 * a SHA-256 of its canonical serialized authoritative content, and
 * recovery must reject a record whose integrity hash does not match.
 *
 * Canonicalization rules:
 *  - JSON.stringify on a stable shape (no key order dependence; we
 *    recursively sort object keys before serialization)
 *  - the integrity hash is computed over the canonical bytes of
 *    the AUTHORITATIVE content. The on-disk wrapper carries the
 *    hash as a sibling field but the hash input does NOT include
 *    itself.
 *  - line endings must be stable; we use \n only and we round-trip
 *    parse the hash input to make sure no whitespace drift slips in.
 */
export declare function canonicalJsonStringify(value: unknown): string;
export declare function sha256Hex(input: string): string;
export interface IntegrityEnvelope<T> {
    schema_version: string;
    content_sha256: string;
    content: T;
}
/**
 * Wrap an authoritative content with a stable integrity envelope.
 * The hash is computed over `canonicalJsonStringify(content)`.
 */
export declare function seal<T>(content: T, schemaVersion: string): IntegrityEnvelope<T>;
/**
 * Verify an integrity envelope. Throws on mismatch; returns the
 * verified content on success.
 */
export declare function verify<T>(envelope: IntegrityEnvelope<T>): T;
//# sourceMappingURL=integrity.d.ts.map