/**
 * Reference model tests.
 *
 * Covers test IDs 24..28.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
	makeRef,
	parseRef,
	isValidRef,
	requireRef,
	REF_KINDS,
	REF_SCHEME,
} from "../src/core/refs.js";

describe("refs: each family parses (test 24)", () => {
	for (const kind of REF_KINDS) {
		it(`parses cmv3://${kind}/<id>`, () => {
			const id = `ref_${kind}_12345678`;
			const uri = makeRef(kind, id);
			assert.equal(uri, `${REF_SCHEME}://${kind}/${id}`);
			const parsed = parseRef(uri);
			assert.ok(parsed !== null);
			assert.equal(parsed.kind, kind);
			assert.equal(parsed.id, id);
			assert.equal(parsed.uri, uri);
		});
	}
});

describe("refs: invalid scheme rejected (test 25)", () => {
	it("rejects a non-cmv3 scheme", () => {
		assert.equal(parseRef("https://tool/abc"), null);
		assert.equal(parseRef("file:///etc/passwd"), null);
		assert.equal(parseRef(""), null);
	});
	it("rejects a ref carrying a query string (payload-by-design avoidance)", () => {
		assert.equal(parseRef("cmv3://tool/abc?secret=1"), null);
	});
});

describe("refs: unknown type rejected (test 26)", () => {
	it("rejects an unknown family", () => {
		assert.equal(parseRef("cmv3://bogus/abcd1234"), null);
	});
});

describe("refs: unsafe/invalid ID rejected (test 27)", () => {
	it("rejects ids with path separators", () => {
		assert.equal(parseRef("cmv3://tool/path/to/x"), null);
	});
	it("rejects ids with whitespace", () => {
		assert.equal(parseRef("cmv3://tool/with space"), null);
	});
	it("rejects ids that are too short", () => {
		assert.throws(() => makeRef("tool", "short"));
	});
	it("rejects ids that are too long", () => {
		assert.throws(() => makeRef("tool", "a".repeat(129)));
	});
	it("rejects ids with illegal characters", () => {
		assert.throws(() => makeRef("tool", "with.dot"));
		assert.throws(() => makeRef("tool", "with/slash"));
	});
});

describe("refs: contain no payload by design (test 28)", () => {
	it("ids are restricted to the safe alphabet", () => {
		const safe = makeRef("tool", "abcdefghij");
		assert.ok(isValidRef(safe));
	});
	it("URI scheme is fixed; the id is the only variable part", () => {
		const a = makeRef("tool", "ident1234");
		const b = makeRef("tool", "ident1234");
		assert.equal(a, b);
		assert.ok(a.startsWith("cmv3://tool/"));
	});
	it("requireRef throws on invalid input", () => {
		assert.throws(() => requireRef("not-a-ref"));
	});
});
