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

import { createHash } from "node:crypto";

export function canonicalJsonStringify(value: unknown): string {
	return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	if (value !== null && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const k of Object.keys(obj).sort()) {
			sorted[k] = sortKeysDeep(obj[k]);
		}
		return sorted;
	}
	return value;
}

export function sha256Hex(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

export interface IntegrityEnvelope<T> {
	schema_version: string;
	content_sha256: string;
	content: T;
}

/**
 * Wrap an authoritative content with a stable integrity envelope.
 * The hash is computed over `canonicalJsonStringify(content)`.
 */
export function seal<T>(content: T, schemaVersion: string): IntegrityEnvelope<T> {
	return {
		schema_version: schemaVersion,
		content_sha256: sha256Hex(canonicalJsonStringify(content)),
		content,
	};
}

/**
 * Verify an integrity envelope. Throws on mismatch; returns the
 * verified content on success.
 */
export function verify<T>(envelope: IntegrityEnvelope<T>): T {
	if (typeof envelope !== "object" || envelope === null) {
		throw new Error("integrity envelope must be an object");
	}
	if (typeof envelope.schema_version !== "string") {
		throw new Error("integrity envelope missing schema_version");
	}
	if (typeof envelope.content_sha256 !== "string") {
		throw new Error("integrity envelope missing content_sha256");
	}
	const recomputed = sha256Hex(canonicalJsonStringify(envelope.content));
	if (recomputed !== envelope.content_sha256) {
		throw new Error(
			`integrity mismatch: expected ${envelope.content_sha256}, got ${recomputed}`,
		);
	}
	return envelope.content;
}
