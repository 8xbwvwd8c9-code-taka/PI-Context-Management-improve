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
export const REF_SCHEME = "cmv3";
export const REF_KINDS = Object.freeze([
    "tool",
    "checkpoint",
    "session",
    "file",
    "handoff",
    "rollover",
]);
/**
 * CMV3-S02 change-control note:
 *
 * The `handoff` family was added in S02 because handoffs are
 * independently recoverable durable records, not sub-records of a
 * checkpoint. The R02 change-control rule allows extension of the
 * frozen ref model if documented; this comment is the
 * documentation. Existing ref syntax (tool / checkpoint / session /
 * file) is unchanged and remains parseable.
 */
/**
 * CMV3-S04 change-control note:
 *
 * The `rollover` family was added in S04 for RolloverRequest
 * records. The same R02 change-control rule applies. The ref is
 * still opaque: cmv3://rollover/<id> with no payload, no project
 * id, no command body. The id alphabet is unchanged.
 */
/**
 * Strict opaque id alphabet: lowercase letters, digits, and `-` or `_`.
 * Length 8..128. No path separators, no whitespace, no slashes, no dots.
 */
const ID_PATTERN = /^[a-z0-9_-]{8,128}$/;
/**
 * Construct a ref URI for a given kind + id. Throws on invalid id.
 * The id is the only variable part; the scheme + kind are not.
 */
export function makeRef(kind, id) {
    assertValidId(id);
    return `${REF_SCHEME}://${kind}/${id}`;
}
/**
 * Parse a ref URI. Returns null on any structural problem; throws
 * only on programmer error (unknown scheme is returned as null to
 * keep the boundary clean for callers).
 */
export function parseRef(uri) {
    if (typeof uri !== "string" || uri.length === 0)
        return null;
    const prefix = `${REF_SCHEME}://`;
    if (!uri.startsWith(prefix))
        return null;
    const rest = uri.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash <= 0)
        return null;
    const kindStr = rest.slice(0, slash);
    const id = rest.slice(slash + 1);
    if (!isRefKind(kindStr))
        return null;
    if (!isValidId(id))
        return null;
    return { kind: kindStr, id, uri };
}
/**
 * Validate a ref URI. Returns true iff the URI parses cleanly.
 */
export function isValidRef(uri) {
    return typeof uri === "string" && parseRef(uri) !== null;
}
/**
 * Throwing variant of `parseRef`. Useful when an invalid ref is
 * a hard error (e.g. when accepting handoffs).
 */
export function requireRef(uri) {
    const parsed = parseRef(uri);
    if (parsed === null) {
        throw new Error(`requireRef: invalid ref URI: ${String(uri)}`);
    }
    return parsed;
}
/**
 * Refs are required to contain no payload by design. This guard is
 * enforced at the ID alphabet level (no path separators, no
 * whitespace, no special characters). It also rejects empty ids and
 * oversize ids.
 */
export function isValidId(id) {
    return typeof id === "string" && ID_PATTERN.test(id);
}
function assertValidId(id) {
    if (!isValidId(id)) {
        throw new Error(`makeRef: id must match ${ID_PATTERN.source} (got ${JSON.stringify(id)})`);
    }
}
function isRefKind(value) {
    return REF_KINDS.includes(value);
}
//# sourceMappingURL=refs.js.map