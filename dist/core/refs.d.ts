/**
 * Portable core — opaque reference model.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §8.
 *
 * Requirements (frozen):
 *   - opaque (no payload in identifier)
 *   - stable (a given ref resolves to the same artifact for its lifetime)
 *   - no secret payload in identifier
 *   - versionable (schema version is recoverable from the artifact)
 *   - integrity-verifiable where appropriate
 *   - distinguish reference type
 *   - deterministic parse / validate
 *
 * No storage. No read(). No semantic search. Reference families:
 *   cmv3://tool/<id>
 *   cmv3://checkpoint/<id>
 *   cmv3://session/<id>
 *   cmv3://file/<id>
 */
export declare const REF_SCHEME = "cmv3";
export type RefKind = "tool" | "checkpoint" | "session" | "file" | "handoff" | "rollover";
export declare const REF_KINDS: readonly RefKind[];
/**
 * Parsed + validated reference. Opaque — only the URI string survives
 * round-trips; the structured fields exist to make validation easier.
 */
export interface ParsedRef {
    readonly kind: RefKind;
    readonly id: string;
    readonly uri: string;
}
/**
 * Construct a ref URI for a given kind + id. Throws on invalid id.
 * The id is the only variable part; the scheme + kind are not.
 */
export declare function makeRef(kind: RefKind, id: string): string;
/**
 * Parse a ref URI. Returns null on any structural problem; throws
 * only on programmer error (unknown scheme is returned as null to
 * keep the boundary clean for callers).
 */
export declare function parseRef(uri: string): ParsedRef | null;
/**
 * Validate a ref URI. Returns true iff the URI parses cleanly.
 */
export declare function isValidRef(uri: unknown): uri is string;
/**
 * Throwing variant of `parseRef`. Useful when an invalid ref is
 * a hard error (e.g. when accepting handoffs).
 */
export declare function requireRef(uri: string): ParsedRef;
/**
 * Refs are required to contain no payload by design. This guard is
 * enforced at the ID alphabet level (no path separators, no
 * whitespace, no special characters). It also rejects empty ids and
 * oversize ids.
 */
export declare function isValidId(id: unknown): id is string;
//# sourceMappingURL=refs.d.ts.map