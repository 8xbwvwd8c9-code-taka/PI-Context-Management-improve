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

export type RefKind = "tool" | "checkpoint" | "session" | "file";

export const REF_KINDS: readonly RefKind[] = Object.freeze([
	"tool",
	"checkpoint",
	"session",
	"file",
]);

/**
 * Strict opaque id alphabet: lowercase letters, digits, and `-` or `_`.
 * Length 8..128. No path separators, no whitespace, no slashes, no dots.
 */
const ID_PATTERN = /^[a-z0-9_-]{8,128}$/;

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
export function makeRef(kind: RefKind, id: string): string {
	assertValidId(id);
	return `${REF_SCHEME}://${kind}/${id}`;
}

/**
 * Parse a ref URI. Returns null on any structural problem; throws
 * only on programmer error (unknown scheme is returned as null to
 * keep the boundary clean for callers).
 */
export function parseRef(uri: string): ParsedRef | null {
	if (typeof uri !== "string" || uri.length === 0) return null;
	const prefix = `${REF_SCHEME}://`;
	if (!uri.startsWith(prefix)) return null;
	const rest = uri.slice(prefix.length);
	const slash = rest.indexOf("/");
	if (slash <= 0) return null;
	const kindStr = rest.slice(0, slash);
	const id = rest.slice(slash + 1);
	if (!isRefKind(kindStr)) return null;
	if (!isValidId(id)) return null;
	return { kind: kindStr, id, uri };
}

/**
 * Validate a ref URI. Returns true iff the URI parses cleanly.
 */
export function isValidRef(uri: unknown): uri is string {
	return typeof uri === "string" && parseRef(uri) !== null;
}

/**
 * Throwing variant of `parseRef`. Useful when an invalid ref is
 * a hard error (e.g. when accepting handoffs).
 */
export function requireRef(uri: string): ParsedRef {
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
export function isValidId(id: unknown): id is string {
	return typeof id === "string" && ID_PATTERN.test(id);
}

function assertValidId(id: string): void {
	if (!isValidId(id)) {
		throw new Error(
			`makeRef: id must match ${ID_PATTERN.source} (got ${JSON.stringify(id)})`,
		);
	}
}

function isRefKind(value: string): value is RefKind {
	return (REF_KINDS as readonly string[]).includes(value);
}
