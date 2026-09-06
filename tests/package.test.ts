/**
 * Package + config + portability tests.
 *
 * Covers test IDs 1..5, 29..35, plus the side-effect gate.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	parseConfig,
	resolveConfig,
	defaultResolvedConfig,
	DEFAULT_MODE,
	CMV3_MODES,
} from "../src/core/config.js";
import {
	discoverGenericProject,
	GenericProjectAdapter,
} from "../src/adapters/generic.js";
import { discoverProject } from "../src/adapters/git.js";
import {
	PACKAGE_NAME,
	PACKAGE_VERSION,
	PACKAGE_PHASE,
} from "../src/pi/extension.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

describe("package: exposes a Pi extension entry (test 1)", () => {
	it("package.json declares pi.extensions", () => {
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
		assert.ok(pkg.pi, "package.json must declare a `pi` block");
		assert.ok(Array.isArray(pkg.pi.extensions));
		assert.ok(pkg.pi.extensions.length > 0);
	});
	it("the extension entry file exists", () => {
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
		const entry = pkg.pi.extensions[0].replace(/^\.\//, "");
		const entryPath = join(REPO_ROOT, entry);
		assert.ok(existsSync(entryPath), `extension entry must exist: ${entryPath}`);
	});
});

describe("package: exposes context-management Skill (test 2)", () => {
	it("package.json declares pi.skills", () => {
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
		assert.ok(Array.isArray(pkg.pi.skills));
		assert.ok(pkg.pi.skills.length > 0);
	});
});

describe("package: Skill path exists (test 3)", () => {
	it("SKILL.md exists at the conventional path", () => {
		const skillPath = join(REPO_ROOT, "skills", "context-management", "SKILL.md");
		assert.ok(existsSync(skillPath));
		const text = readFileSync(skillPath, "utf8");
		assert.match(text, /^---\nname: context-management/m);
	});
});

describe("package: extension loads without side effects (test 4)", () => {
	it("extension function is callable with a no-op stub", async () => {
		// We don't have a real ExtensionAPI in tests; we verify the
		// function does not throw on a stub object and returns void.
		// S04 registers a tool, a command, and an event observer,
		// so the stub must at least expose the relevant hooks.
		const mod = await import("../src/pi/extension.js");
		const fn = mod.default;
		assert.equal(typeof fn, "function");
		const stub = {
			on: () => {},
			registerTool: () => {},
			registerCommand: () => {},
		};
		assert.doesNotThrow(() => fn(stub as unknown as Parameters<typeof fn>[0]));
	});
});

describe("package: metadata is valid (test 5)", () => {
	it("package identity is exposed at runtime", () => {
		assert.equal(PACKAGE_NAME, "pi-context-management-improve");
		assert.equal(typeof PACKAGE_VERSION, "string");
		assert.equal(PACKAGE_VERSION.length > 0, true);
		// S05 owns the live extension. The phase tag reflects the
		// current capability surface.
		assert.equal(PACKAGE_PHASE, "S05-LIVE-RUNTIME-INTEGRATION");
	});
});

describe("config: default mode = legacy (test 29)", () => {
	it("DEFAULT_MODE is legacy", () => {
		assert.equal(DEFAULT_MODE, "legacy");
	});
	it("defaultResolvedConfig returns mode = legacy", () => {
		assert.equal(defaultResolvedConfig().mode, "legacy");
	});
});

describe("config: v3-observe accepted (test 30)", () => {
	it("accepts v3-observe", () => {
		assert.equal(resolveConfig({ mode: "v3-observe" }).mode, "v3-observe");
	});
});

describe("config: v3 accepted (test 31)", () => {
	it("accepts v3 (deferred to S04; parse-only in S01)", () => {
		assert.equal(resolveConfig({ mode: "v3" }).mode, "v3");
	});
});

describe("config: invalid mode rejected (test 32)", () => {
	it("rejects an unknown mode at runtime", () => {
		// The static type already rejects unknown modes; the runtime
		// test casts to bypass the type system and verifies that the
		// resolver still raises on an unknown string at the boundary.
		assert.throws(() => resolveConfig({ mode: "v9" as unknown as "legacy" }));
	});
});

describe("config: zero-config defaults valid (test 33)", () => {
	it("empty config resolves to legacy defaults", () => {
		const c = resolveConfig({});
		assert.equal(c.mode, "legacy");
		assert.equal(c.profile, "auto");
		assert.equal(c.storage_path, ".cmv3");
		assert.equal(c.project_adapter, "generic");
		assert.equal(c.rollover_policy, "natural-then-pressure");
	});
	it("parseConfig tolerates missing input", () => {
		assert.deepEqual(parseConfig(undefined), {});
	});
	it("parseConfig rejects invalid JSON", () => {
		assert.throws(() => parseConfig("{not json}"));
	});
	it("parseConfig rejects a non-object root", () => {
		assert.throws(() => parseConfig("[]"));
		assert.throws(() => parseConfig("42"));
		assert.throws(() => parseConfig("null"));
	});
	it("CMV3_MODES is the frozen set", () => {
		assert.deepEqual([...CMV3_MODES], ["legacy", "v3-observe", "v3"]);
	});
});

describe("portability: importing portable core does not require a Git repo (test 34)", () => {
	it("GenericProjectAdapter works on a non-Git directory", () => {
		// /tmp is not a Git repo. /tmp itself may not exist on every
		// platform; pick the repo's own docs/ directory which is
		// definitely not a .git dir and contains no .git of its own.
		const docs = join(REPO_ROOT, "docs");
		assert.ok(existsSync(docs));
		const info = discoverGenericProject(docs);
		assert.equal(info.repository, null);
		assert.equal(info.branch, null);
		assert.equal(info.head, null);
		assert.equal(info.dirty, null);
	});
	it("discoverProject falls back to generic when no .git", () => {
		const docs = join(REPO_ROOT, "docs");
		return discoverProject(docs).then((info) => {
			assert.equal(info.repository, null);
		});
	});
	it("GenericProjectAdapter: constructor + discover round-trip", async () => {
		const docs = join(REPO_ROOT, "docs");
		const info = await new GenericProjectAdapter(docs).discover();
		assert.equal(info.root, docs);
		assert.ok(info.project_id.length > 0);
	});
});

describe("portability: zero ST_BOT dependencies (test 35)", () => {
	it("production source contains no ST_BOT coupling", () => {
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
		const raw = JSON.stringify(pkg);
		// Allow the historical mention in the description; it is
		// documentation context, not a dependency.
		for (const forbidden of [
			"supervisor_v6",
			"invest/",
			"@st-bot",
			"trading",
			"broker",
			"Shioaji",
		]) {
			assert.ok(
				!raw.includes(forbidden),
				`package.json must not reference ${forbidden}`,
			);
		}
		// dependency / devDependency / peerDependency blocks: zero
		// for any of the forbidden host-project identifiers.
		const blocks = [
			...(pkg.dependencies ? Object.keys(pkg.dependencies) : []),
			...(pkg.devDependencies ? Object.keys(pkg.devDependencies) : []),
			...(pkg.peerDependencies ? Object.keys(pkg.peerDependencies) : []),
		];
		for (const dep of blocks) {
			assert.ok(
				!/st[-_]?bot|supervisor[-_]?v6|invest|trading|broker|shioaji/i.test(dep),
				`dependency must not be a host-project identifier: ${dep}`,
			);
		}
	});
});

describe("side-effect gate (portable contract)", () => {
	it("the extension does not call ctx.compact()", () => {
		const text = readFileSync(
			join(REPO_ROOT, "src", "pi", "extension.ts"),
			"utf8",
		);
		// The portable contract forbids actual call sites. A
		// comment that mentions the forbidden function is allowed
		// (and useful for documentation). We scan for the call
		// form: `ctx.compact(` or `.compact(`.
		assert.equal(
			/ctx\.compact\(/.test(text),
			false,
			"must not call ctx.compact()",
		);
		assert.equal(/\.compact\(/.test(text), false, "must not call .compact(...)");
	});
	it("the package does not write runtime telemetry in portable code", () => {
		const text = readFileSync(
			join(REPO_ROOT, "src", "pi", "extension.ts"),
			"utf8",
		);
		// Ban writeFile / appendFile call sites. Comments that
		// mention the names are allowed.
		assert.equal(
			/writeFile(?:Sync)?\s*\(/.test(text),
			false,
			"must not call writeFile*",
		);
		assert.equal(
			/appendFile(?:Sync)?\s*\(/.test(text),
			false,
			"must not call appendFile*",
		);
		assert.equal(
			/appendEntry\s*\(/.test(text),
			false,
			"must not call appendEntry()",
		);
	});
	it("no live Pi config is modified", () => {
		const text = readFileSync(
			join(REPO_ROOT, "src", "pi", "extension.ts"),
			"utf8",
		);
		assert.equal(/['"]HIGH['"]/.test(text), false, "must not write HIGH");
		assert.equal(/['"]LOW['"]/.test(text), false, "must not write LOW");
	});
});
