import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	classifyPiRuntimeCompatibility,
	KNOWN_UNSAFE_PI_VERSIONS,
	VALIDATED_SAFE_PI_VERSIONS,
} from "../src/pi/runtime-compatibility.js";

describe("Pi newSession runtime compatibility", () => {
	it("refuses the installed 0.85.1 runtime before session replacement", () => {
		assert.deepEqual(classifyPiRuntimeCompatibility("0.85.1"), {
			classification: "KNOWN_UNSAFE",
			code: "pi_newsession_rebind_unsafe",
			version: "0.85.1",
		});
		assert.deepEqual(KNOWN_UNSAFE_PI_VERSIONS, ["0.85.1"]);
	});

	it("classifies an unknown future version as UNVALIDATED", () => {
		assert.deepEqual(classifyPiRuntimeCompatibility("0.85.2"), {
			classification: "UNVALIDATED",
			code: "pi_newsession_runtime_unvalidated",
			version: "0.85.2",
		});
		assert.deepEqual(VALIDATED_SAFE_PI_VERSIONS, []);
	});

	it("classifies missing or unparsable versions as UNVALIDATED", () => {
		assert.deepEqual(classifyPiRuntimeCompatibility(""), {
			classification: "UNVALIDATED",
			code: "pi_runtime_version_unavailable",
			version: "unknown",
		});
		assert.deepEqual(classifyPiRuntimeCompatibility("not a version"), {
			classification: "UNVALIDATED",
			code: "pi_runtime_version_unparsable",
			version: "not a version",
		});
	});

	it("allows only an explicitly injected validated-safe fixture", () => {
		assert.deepEqual(classifyPiRuntimeCompatibility("test-safe", ["test-safe"]), {
			classification: "SAFE",
			code: "pi_newsession_runtime_validated",
			version: "test-safe",
		});
	});
});
