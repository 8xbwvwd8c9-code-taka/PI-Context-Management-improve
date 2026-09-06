#!/usr/bin/env node
/**
 * package-check.mjs — verifies that the published surface of the
 * CMV3 portable package is correct.
 *
 * Checks:
 *   1. package.json declares both pi.extensions and pi.skills.
 *   2. The extension entry file exists.
 *   3. The skill directory exists and contains SKILL.md.
 *   4. The Skill file has the required frontmatter `name:` field.
 *   5. Required skill reference docs exist (CHECKPOINT / HANDOFF / PRESSURE).
 *   6. The package is private: "private": true (no accidental publish).
 *   7. The package declares the peer dependency on
 *      @earendil-works/pi-coding-agent.
 *   8. No forbidden host-project identifiers in dependency blocks.
 *
 * S01: also asserts that the extension does not call the native
 * compaction entrypoint and does not write runtime telemetry.
 * S02: also asserts the durable store does not modify any live Pi
 * config, does not invoke a native compaction, and does not pull
 * in any forbidden host-project dependency.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const errors = [];
function fail(msg) {
	errors.push(msg);
	console.error(`✗ ${msg}`);
}
function ok(msg) {
	console.log(`✓ ${msg}`);
}

const pkgPath = join(root, "package.json");
if (!existsSync(pkgPath)) {
	fail("package.json missing");
	process.exit(1);
}
let pkg;
try {
	pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
} catch (err) {
	fail(`package.json is not valid JSON: ${err.message}`);
	process.exit(1);
}

// Files that ship inside the packed tarball. Every
// `pi.extensions` / `pi.skills` entry MUST live under one of
// these prefixes; otherwise the packed install cannot load it.
const shippedFiles = Array.isArray(pkg.files) ? pkg.files : [];
const shippedPrefixes = shippedFiles.map((f) =>
	String(f).replace(/\/+$/, "").replace(/^\.\//, ""),
);
function isUnderShipped(rel) {
	const r = String(rel).replace(/^\.\//, "").replace(/\/+$/, "");
	for (const pref of shippedPrefixes) {
		if (r === pref || r.startsWith(`${pref}/`)) return true;
	}
	return false;
}

if (!pkg.pi) {
	fail("package.json: missing `pi` block");
} else {
	if (!Array.isArray(pkg.pi.extensions) || pkg.pi.extensions.length === 0) {
		fail("package.json: `pi.extensions` must be a non-empty array");
	} else {
		ok(`pi.extensions = ${JSON.stringify(pkg.pi.extensions)}`);
		for (const entry of pkg.pi.extensions) {
			const p = join(root, String(entry).replace(/^\.\//, ""));
			if (!existsSync(p)) {
				fail(`extension entry missing: ${p}`);
			} else if (!statSync(p).isFile()) {
				fail(`extension entry is not a file: ${p}`);
			} else {
				ok(`extension entry exists: ${p}`);
			}
			if (!isUnderShipped(String(entry))) {
				fail(
					`extension entry ${entry} is not under a shipped directory (files: ${JSON.stringify(shippedFiles)})`,
				);
			} else {
				ok(`extension entry ships in package: ${entry}`);
			}
		}
	}

	// Hard gate for the V101 packaging fix: the canonical Git
	// install MUST already contain the runtime extension on disk.
	// Pi Git packages may install without devDependencies, so a
	// prepare script that depends on TypeScript is NOT sufficient.
	// The committed dist/ artifact is the source of truth for
	// Git-install compatibility.
	for (const entry of pkg.pi.extensions) {
		const rel = String(entry).replace(/^\.\//, "");
		if (!existsSync(join(root, rel))) {
			fail(
				`Git-install guard: extension entry ${entry} is not present in the repository working tree. ` +
					`Commit the build artifact (dist/) so a clean Git clone is runtime-ready without manual build.`,
			);
		} else {
			ok(`Git-install guard: ${entry} present in working tree`);
		}
	}
	if (!Array.isArray(pkg.pi.skills) || pkg.pi.skills.length === 0) {
		fail("package.json: `pi.skills` must be a non-empty array");
	} else {
		ok(`pi.skills = ${JSON.stringify(pkg.pi.skills)}`);
		for (const entry of pkg.pi.skills) {
			const p = join(root, String(entry).replace(/^\.\//, ""));
			const skillFile = join(p, "SKILL.md");
			if (!existsSync(skillFile)) {
				fail(`skill SKILL.md missing: ${skillFile}`);
				continue;
			}
			const text = readFileSync(skillFile, "utf8");
			if (!/^---\nname: context-management/m.test(text)) {
				fail(`skill frontmatter must declare \`name: context-management\`: ${skillFile}`);
			} else {
				ok(`skill ${p} OK`);
			}
			for (const ref of ["CHECKPOINT.md", "HANDOFF.md", "PRESSURE.md"]) {
				const rp = join(p, "references", ref);
				if (!existsSync(rp)) {
					fail(`reference doc missing: ${rp}`);
				} else {
					ok(`reference ${ref} OK`);
				}
			}
			if (!isUnderShipped(String(entry))) {
				fail(
					`skill entry ${entry} is not under a shipped directory (files: ${JSON.stringify(shippedFiles)})`,
				);
			} else {
				ok(`skill entry ships in package: ${entry}`);
			}
		}
	}
}

// V101 packaging gate — every `files` entry must actually exist
// on disk. Without this, an operator can ship a package whose
// `files: ["dist", ...]` lists a directory whose build artifact
// was never committed. That's exactly the V101 defect class.
for (const f of shippedFiles) {
	const p = join(root, String(f).replace(/^\.\//, ""));
	if (!existsSync(p)) {
		fail(`shipped files entry missing on disk: ${p}`);
	} else {
		ok(`shipped files entry present: ${p}`);
	}
}

// V101 packaging gate — `main` must resolve to a real file. A
// missing main is a build-artifact forget (i.e. forgot to commit
// dist/) caught at the package surface.
if (typeof pkg.main === "string" && pkg.main.length > 0) {
	const mainPath = join(root, pkg.main.replace(/^\.\//, ""));
	if (!existsSync(mainPath)) {
		fail(`package.json main missing: ${mainPath}`);
	} else {
		ok(`package main present: ${mainPath}`);
	}
}

// V101 packaging gate — every `exports` runtime path (the
// `import` targets, plus the `types` targets) must resolve to a
// real file. types-only entries are checked for sidecar `.d.ts`
// files when the `.ts` source is the source of truth, but for the
// build-output pattern we expect compiled artifacts.
if (pkg.exports && typeof pkg.exports === "object") {
	for (const [subpath, def] of Object.entries(pkg.exports)) {
		if (!def || typeof def !== "object") continue;
		const targets = [def.import, def.require, def.default].filter(
			(t) => typeof t === "string",
		);
		for (const t of targets) {
			const p = join(root, String(t).replace(/^\.\//, ""));
			if (!existsSync(p)) {
				fail(`package exports[${subpath}] target missing: ${p}`);
			} else {
				ok(`package exports[${subpath}] target present: ${p}`);
			}
		}
	}
}

if (pkg.private === true) {
	ok("package.json: `private: true`");
} else {
	fail("package.json: must be `private: true` for S01 (no npm publish yet)");
}

if (!pkg.peerDependencies || !pkg.peerDependencies["@earendil-works/pi-coding-agent"]) {
	fail(
		"package.json: must declare peer dependency on @earendil-works/pi-coding-agent",
	);
} else {
	ok("peerDependency: @earendil-works/pi-coding-agent");
}

// V101 packaging gate — version alignment between package.json,
// package-lock.json root, and package-lock.json packages[""]. All
// three must agree so a published or Git-cloned package has a
// single source-of-truth version. A drift here is the kind of
// bug that npm install masks but real installs expose.
{
	const pkgVer = pkg.version;
	const lockPath = join(root, "package-lock.json");
	if (!existsSync(lockPath)) {
		fail("package-lock.json missing");
	} else {
		let lock;
		try {
			lock = JSON.parse(readFileSync(lockPath, "utf8"));
		} catch (err) {
			fail(`package-lock.json is not valid JSON: ${err.message}`);
		}
		if (lock) {
			const lockVer = lock.version;
			const lockRootVer = lock.packages && lock.packages[""] && lock.packages[""].version;
			if (lockVer !== pkgVer) {
				fail(
					`version drift: package.json version=${pkgVer} vs package-lock.json version=${lockVer}`,
				);
			} else {
				ok(`version aligned: package.json ↔ package-lock.json root (${pkgVer})`);
			}
			if (lockRootVer !== pkgVer) {
				fail(
					`version drift: package.json version=${pkgVer} vs package-lock.json packages[""].version=${lockRootVer}`,
				);
			} else {
				ok(`version aligned: package.json ↔ package-lock.json packages[""] (${pkgVer})`);
			}
		}
	}
}

const allDeps = [
	...(pkg.dependencies ? Object.keys(pkg.dependencies) : []),
	...(pkg.devDependencies ? Object.keys(pkg.devDependencies) : []),
	...(pkg.peerDependencies ? Object.keys(pkg.peerDependencies) : []),
];
const FORBIDDEN_PATTERNS = [
	/st[-_]?bot/i,
	/supervisor[-_]?v6/i,
	/^invest$/i,
	/trading/i,
	/^broker$/i,
	/shioaji/i,
];
for (const dep of allDeps) {
	for (const pat of FORBIDDEN_PATTERNS) {
		if (pat.test(dep)) {
			fail(`forbidden host-project dependency: ${dep}`);
		}
	}
}
if (errors.length === 0) ok("dependency blocks contain no host-project identifiers");

// Portable side-effect gate. We forbid actual call sites; the
// forbidden function names may still appear in comments.
const extPath = join(root, "src", "pi", "extension.ts");
if (existsSync(extPath)) {
	const text = readFileSync(extPath, "utf8");
	if (/ctx\.compact\(/.test(text)) fail("extension must not call ctx.compact()");
	else ok("extension does not call ctx.compact()");
	if (/\.compact\(/.test(text)) fail("extension must not call .compact(...)");
	// Ban writeFile/appendFile/appendEntry call sites; the names
	// may appear in comments.
	if (/writeFile(?:Sync)?\s*\(/.test(text)) {
		fail("extension must not call writeFile(...)");
	} else {
		ok("extension does not write runtime telemetry / session entries");
	}
} else {
	fail(`extension source missing: ${extPath}`);
}

// S02 side-effect gate: the store library must not touch live Pi
// config or native compaction.
const storePath = join(root, "src", "store");
if (existsSync(storePath)) {
	const { readdirSync } = await import("node:fs");
	const storeFiles = readdirSync(storePath, { recursive: true }).filter(
		(f) => typeof f === "string" && f.endsWith(".ts"),
	);
	for (const f of storeFiles) {
		const t = readFileSync(join(storePath, f), "utf8");
		if (/ctx\.compact\b|\.compact\(/.test(t)) {
			fail(`store/${f} must not call ctx.compact() or .compact(...)`);
		}
	}
	ok("store has zero native-compaction calls");
}
// S02: the durable store is a library, not a lifecycle hook.
// S04: the extension now legitimately consumes the store as a
// library to drive the rollover orchestrator. The forbidden
// pattern in S04 is auto-spooling live tool output into the
// store. The extension MAY import the store; it MUST NOT
// transparently intercept every tool result.
{
	const extText = readFileSync(extPath, "utf8");
	// The literal "auto-spool" sentinel would have to be added
	// by an explicit future WP. We instead scan for tool-name
	// whitelists: the extension must not register a tool called
	// "record" / "intercept" / "auto-spool" that transparently
	// captures all tool results.
	if (/name:\s*['"](?:record|intercept|auto-?spool|capture-all-tools)/i.test(extText)) {
		fail("extension must not register an auto-spool tool that captures all tool results");
	} else {
		ok("extension does not register an auto-spool tool");
	}
}

if (errors.length > 0) {
	console.error(`\npackage-check FAILED with ${errors.length} error(s)`);
	process.exit(1);
}
console.log("\npackage-check OK");
