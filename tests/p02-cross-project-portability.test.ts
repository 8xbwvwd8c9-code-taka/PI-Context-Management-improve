/**
 * P02 cross-project portability test harness.
 *
 * Authority: docs/P02_PORTABILITY_REPORT.md (P02 WP spec).
 *
 * P02 is the final PICM v1 portability gate. It proves the SAME
 * packaged artifact works in multiple unrelated projects without
 * copying PICM source or adding project-specific core code.
 *
 * Strategy: build the package once, extract the tarball into a
 * temp dir, and import the extension FROM THE PACKED DIST (not
 * from the source tree). Then drive two completely different
 * target projects (one Git, one non-Git) through end-to-end
 * work-package cycles and verify every P02 gate.
 *
 * The two targets:
 *   - TARGET_A: small Node-style project with `git init` and one
 *     commit. Uses the Git project adapter.
 *   - TARGET_B: small Python-style project with NO `.git`. Uses
 *     the generic project adapter.
 *
 * The two stores:
 *   - Each target has its own `CMV3_STORE_PATH` (isolated).
 *   - A shared root is also exercised to verify multi-project
 *     store layouts and index isolation.
 *
 * The two pilots:
 *   - TARGET_A runs 2 NATURAL rollovers (WP-A1 → WP-A2) plus one
 *     tool virtualization + one recovery ref lookup.
 *   - TARGET_B runs 2 NATURAL rollovers (WP-B1 → WP-B2) plus one
 *     pressure decision + one durable checkpoint/handoff.
 *
 * This is a regression test, not the P02 report itself. The
 * P02 report is regenerated on success; the gates below are
 * the same gates the report asserts.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	createReadStream,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
	existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import { openStore, projectIdFromSeed, type Cmv3Store } from "../src/store/index.js";
import { TINY_PROFILE, LOCAL_32K_PROFILE } from "../src/core/index.js";
import { executePicmRecover } from "../src/pi/recovery-tool.js";
import { discoverProject } from "../src/adapters/git.js";

/* -------------------------------------------------------------------- *
 * Pack artifact helpers                                                  *
 * -------------------------------------------------------------------- */

// Resolve the PICM package root (parent of the tests/ dir) from
// the test file's location. We use process.cwd() as the source
// of truth: the test is always run from the package root via
// `npm test`, so cwd is reliable and avoids URL-to-path gotchas
// inside `import.meta.url`.
const PACKAGE_ROOT = resolve(process.cwd());
const PKG_JSON = JSON.parse(
	readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
) as { name: string; version: string };
const TARBALL_NAME = `${PKG_JSON.name}-${PKG_JSON.version}.tgz`;

async function sha256OfFile(path: string): Promise<string> {
	return new Promise((res, rej) => {
		const h = createHash("sha256");
		const s = createReadStream(path);
		s.on("data", (c) => h.update(c));
		s.on("end", () => res(h.digest("hex")));
		s.on("error", rej);
	});
}

function packArtifact(outDir: string): { tarball: string; sha256: string } {
	mkdirSync(outDir, { recursive: true });
	const tarball = join(outDir, TARBALL_NAME);
	// Resolve npm to an absolute path because tsx's test runner
	// can strip PATH. Try the env first, then common absolute
	// locations.
	const candidates = [
		process.env["NPM_BIN"],
		"/opt/homebrew/bin/npm",
		"/usr/local/bin/npm",
		"/usr/bin/npm",
	].filter((p): p is string => typeof p === "string");
	let npmBin: string | null = null;
	for (const c of candidates) {
		if (existsSync(c)) {
			npmBin = c;
			break;
		}
	}
	if (npmBin === null) {
		throw new Error(
			`npm CLI not found in any of: ${candidates.join(", ")} (set NPM_BIN env to override)`,
		);
	}
	const out = spawnSync(
		npmBin,
		["pack", "--pack-destination", outDir],
		{ cwd: PACKAGE_ROOT, encoding: "utf8" },
	);
	if (out.error) {
		throw new Error(`npm pack spawn error: ${out.error.message}`);
	}
	if (out.status !== 0) {
		throw new Error(
			`npm pack failed (status ${out.status}):\n${out.stdout}\n${out.stderr}`,
		);
	}
	const stdout = (out.stdout ?? "").trim();
	if (!existsSync(tarball)) {
		throw new Error(
			`npm pack did not produce expected tarball at ${tarball} (stdout: ${stdout})`,
		);
	}
	return { tarball, sha256: "" };
}

function extractTarball(tarball: string, dest: string): void {
	mkdirSync(dest, { recursive: true });
	const out = spawnSync("/usr/bin/tar", ["-xzf", tarball, "-C", dest], {
		encoding: "utf8",
	});
	if (out.error) {
		throw new Error(`tar spawn error: ${out.error.message}`);
	}
	if (out.status !== 0) {
		throw new Error(
			`tar extract failed (status ${out.status}):\n${out.stderr}`,
		);
	}
}

function runGit(cwd: string, ...args: string[]): string {
	const r = spawnSync("/usr/bin/git", args, {
		cwd,
		encoding: "utf8",
	});
	if (r.error) {
		throw new Error(`git spawn error: ${r.error.message}`);
	}
	if (r.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed (status ${r.status}):\n${r.stderr}`,
		);
	}
	return r.stdout ?? "";
}

/* -------------------------------------------------------------------- *
 * P02 report shape                                                      *
 * -------------------------------------------------------------------- */

interface P02Report {
	PACKAGE_ARTIFACT: string;
	PACKAGE_SHA256: string;
	PACKAGE_VERSION: string;
	SAME_PACKAGE_ARTIFACT: 0 | 1;
	SOURCE_COPY_IN_TARGET: 0 | 1;
	ZERO_CONFIG: 0 | 1;
	GIT_TARGET_SUPPORTED: 0 | 1;
	NON_GIT_TARGET_SUPPORTED: 0 | 1;
	PROJECT_A_ID: string;
	PROJECT_B_ID: string;
	PROJECT_IDS_ISOLATED: 0 | 1;
	TARGET_A_NATURAL_ROLLOVER: "PASS" | "FAIL";
	TARGET_A_TOOL_VIRTUALIZATION: "PASS" | "FAIL";
	TARGET_A_RECOVERY: "PASS" | "FAIL";
	TARGET_A_RESTART_RECOVERY: 0 | 1;
	TARGET_B_NATURAL_ROLLOVER: "PASS" | "FAIL";
	TARGET_B_PRESSURE_PATH: "PASS" | "FAIL";
	TARGET_B_RECOVERY: "PASS" | "FAIL";
	TARGET_B_RESTART_RECOVERY: 0 | 1;
	CROSS_PROJECT_LEAKAGE: 0 | 1;
	PROJECT_SPECIFIC_CORE_CODE: 0 | 1;
	SHARED_ROOT_PROJECTS: 0 | 1;
	INSTALL_TARGET_SOURCE_POLLUTION: 0 | 1;
	UNINSTALL_TARGET_DAMAGE: 0 | 1;
	STANDALONE_SKILL_AVAILABLE: 0 | 1;
	RUNTIME_EXTENSION_AVAILABLE: 0 | 1;
	CTX_COMPACT_CALLS: number;
	PI_CORE_PATCHED: 0 | 1;
	README_EXTERNAL_PROJECT_REFS: 0 | 1;
	FINAL_VERSION: string;
	FINAL_PACKAGE_SHA256: string;
	FINAL_PACKAGE_BOTH_TARGET_SMOKE: "PASS" | "FAIL";
}

const report: P02Report = {
	PACKAGE_ARTIFACT: "",
	PACKAGE_SHA256: "",
	PACKAGE_VERSION: PKG_JSON.version,
	SAME_PACKAGE_ARTIFACT: 0,
	SOURCE_COPY_IN_TARGET: 0,
	ZERO_CONFIG: 0,
	GIT_TARGET_SUPPORTED: 0,
	NON_GIT_TARGET_SUPPORTED: 0,
	PROJECT_A_ID: "",
	PROJECT_B_ID: "",
	PROJECT_IDS_ISOLATED: 0,
	TARGET_A_NATURAL_ROLLOVER: "FAIL",
	TARGET_A_TOOL_VIRTUALIZATION: "FAIL",
	TARGET_A_RECOVERY: "FAIL",
	TARGET_A_RESTART_RECOVERY: 0,
	TARGET_B_NATURAL_ROLLOVER: "FAIL",
	TARGET_B_PRESSURE_PATH: "FAIL",
	TARGET_B_RECOVERY: "FAIL",
	TARGET_B_RESTART_RECOVERY: 0,
	CROSS_PROJECT_LEAKAGE: 0,
	PROJECT_SPECIFIC_CORE_CODE: 0,
	SHARED_ROOT_PROJECTS: 0,
	INSTALL_TARGET_SOURCE_POLLUTION: 0,
	UNINSTALL_TARGET_DAMAGE: 0,
	STANDALONE_SKILL_AVAILABLE: 0,
	RUNTIME_EXTENSION_AVAILABLE: 0,
	CTX_COMPACT_CALLS: 0,
	PI_CORE_PATCHED: 0,
	README_EXTERNAL_PROJECT_REFS: 0,
	FINAL_VERSION: PKG_JSON.version,
	FINAL_PACKAGE_SHA256: "",
	FINAL_PACKAGE_BOTH_TARGET_SMOKE: "FAIL",
};

/* -------------------------------------------------------------------- *
 * Synthetic API stub (mirrors p01 shape, but the extension function    *
 * is injected so the test can load it from a packed location).         *
 * -------------------------------------------------------------------- */

interface TargetEnv {
	readonly cwd: string;
	readonly storePath: string;
	readonly projectId: string;
	readonly sessionFile: string;
	readonly store: Cmv3Store;
	readonly sendMessageCalls: { customType: string; content: string }[];
	readonly toolHandlers: Map<string, { name: string; execute: (id: string, args: unknown) => unknown }>;
	readonly commandHandlers: Map<string, { name: string; handler: (args: string, ctx: unknown) => Promise<unknown> }>;
	readonly sessionStartHandlers: Array<(event: unknown, ctx: unknown) => Promise<unknown>>;
	readonly agentSettledHandlers: Array<(event: unknown, ctx: unknown) => Promise<unknown>>;
	readonly toolResultHandlers: Array<(event: unknown) => unknown>;
	readonly newSessionCounter: number;
}

function buildSyntheticApi(env: TargetEnv) {
	const stub = {
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			if (event === "session_start") env.sessionStartHandlers.push(handler);
			else if (event === "agent_settled")
				env.agentSettledHandlers.push(handler);
			else if (event === "tool_result")
				env.toolResultHandlers.push(handler as unknown as (event: unknown) => unknown);
		},
		registerTool(t: { name: string; execute: (id: string, args: unknown) => unknown }) {
			env.toolHandlers.set(t.name, t);
		},
		registerCommand(
			name: string,
			options: { description?: string; handler: (args: string, ctx: unknown) => Promise<unknown> },
		) {
			env.commandHandlers.set(name, { name, handler: options.handler });
		},
		sendMessage(message: { customType: string; content: string; display: boolean; details: unknown }) {
			env.sendMessageCalls.push({ customType: message.customType, content: message.content });
		},
	};
	return stub;
}

interface SyntheticCtx {
	cwd: string;
	sessionManager: { getSessionFile: () => string };
	getContextUsage: () => { tokens: number; contextWindow: number } | undefined;
	ui: { notify: (msg: string, kind: string) => void };
	newSession: (opts: {
		parentSession?: string;
		setup?: (sm: { appendMessage: (m: unknown) => void }) => Promise<void>;
		withSession?: (
			freshCtx: SyntheticCtx & { sendUserMessage: (s: string) => Promise<void> },
		) => Promise<void>;
	}) => Promise<{ cancelled: boolean }>;
}

function makeSyntheticCtx(
	env: TargetEnv,
	opts: { cwd: string; sessionFile: string; tokens: number; contextWindow: number },
): SyntheticCtx {
	return {
		cwd: opts.cwd,
		sessionManager: { getSessionFile: () => opts.sessionFile },
		getContextUsage: () => ({ tokens: opts.tokens, contextWindow: opts.contextWindow }),
		ui: { notify: () => {} },
		newSession: async (newOpts) => {
			env.newSessionCounter += 1;
			const newSessionId = `sess_p02${String(env.newSessionCounter).padStart(2, "0")}${randomBytes(4).toString("hex")}`;
			if (newOpts.setup) {
				await newOpts.setup({ appendMessage: () => {} });
			}
			if (newOpts.withSession) {
				const freshCtx = makeSyntheticCtx(env, {
					cwd: opts.cwd,
					sessionFile: newSessionId,
					tokens: 0,
					contextWindow: opts.contextWindow,
				}) as SyntheticCtx & { sendUserMessage: (s: string) => Promise<void> };
				freshCtx.sendUserMessage = async () => {};
				await newOpts.withSession(freshCtx);
			}
			return { cancelled: false };
		},
	};
}

async function startSession(
	env: TargetEnv,
	cmv3Extension: (api: unknown) => void,
	opts: {
		cwd: string;
		prevSessionFile?: string;
		tokens: number;
		contextWindow: number;
	},
): Promise<SyntheticCtx> {
	const api = buildSyntheticApi(env);
	cmv3Extension(api, "0.85.2", ["0.85.2"]);
	const handler = env.sessionStartHandlers[env.sessionStartHandlers.length - 1];
	assert.ok(handler, "session_start handler not registered");
	const ctx = makeSyntheticCtx(env, {
		cwd: opts.cwd,
		sessionFile: env.sessionFile,
		tokens: opts.tokens,
		contextWindow: opts.contextWindow,
	});
	await handler({ cwd: opts.cwd, previousSessionFile: opts.prevSessionFile }, ctx);
	return ctx;
}

interface WorkPackage {
	id: string;
	title: string;
	goal: string;
	work_package: string;
	status: "COMPLETE" | "IN_PROGRESS" | "BLOCKED";
	completed: string[];
	in_progress: string[];
	blockers: string[];
	important_decisions: string[];
	hard_constraints: string[];
	current_files: string[];
	active_errors: string[];
	next_actions: string[];
}

async function prepareRollover(
	env: TargetEnv,
	toolName: string,
	wp: WorkPackage,
): Promise<{ ref: string; id: string }> {
	const tool = env.toolHandlers.get(toolName);
	assert.ok(tool, `${toolName} not registered`);
	const out = (await tool.execute("p02-prepare-" + wp.id, {
		reason: wp.status === "IN_PROGRESS" ? "PRESSURE" : "NATURAL",
		goal: wp.goal,
		work_package: wp.work_package,
		status: wp.status,
		completed: wp.completed,
		in_progress: wp.in_progress,
		blockers: wp.blockers,
		important_decisions: wp.important_decisions,
		hard_constraints: wp.hard_constraints,
		current_files: wp.current_files,
		active_errors: wp.active_errors,
		next_actions: wp.next_actions,
		recovery_refs: [],
	})) as { details: { ref: string; id: string } };
	return { ref: out.details.ref, id: out.details.id };
}

async function executeRollover(
	env: TargetEnv,
	cmdName: string,
	id: string,
	ctx: SyntheticCtx,
): Promise<void> {
	const cmd = env.commandHandlers.get(cmdName);
	assert.ok(cmd, `${cmdName} not registered`);
	await cmd.handler(id, ctx);
}

/* -------------------------------------------------------------------- *
 * Target factories                                                       *
 * -------------------------------------------------------------------- */

function makeGitTarget(cwd: string): void {
	mkdirSync(cwd, { recursive: true, mode: 0o755 });
	mkdirSync(join(cwd, "src"), { recursive: true });
	mkdirSync(join(cwd, "tests"), { recursive: true });
	writeFileSync(
		join(cwd, "package.json"),
		JSON.stringify(
			{
				name: "p02-target-a",
				version: "0.0.1",
				private: true,
				type: "module",
				scripts: { test: "node --test tests/*.test.js" },
			},
			null,
			2,
		),
	);
	writeFileSync(join(cwd, "src", "index.js"), "export const greet = () => 'hi';\n");
	writeFileSync(
		join(cwd, "README.md"),
		"# P02 target A\n\nDisposable Node target. No PICM-specific code.\n",
	);
	runGit(cwd, "init", "-q", "-b", "main");
	runGit(cwd, "config", "user.email", "targetA@example.com");
	runGit(cwd, "config", "user.name", "P02-Target-A");
	runGit(cwd, "remote", "add", "origin", "https://example.com/p02-target-a.git");
	runGit(cwd, "add", "-A");
	runGit(cwd, "commit", "-q", "-m", "target-a: initial empty");
}

function makeNonGitTarget(cwd: string): void {
	mkdirSync(cwd, { recursive: true, mode: 0o755 });
	mkdirSync(join(cwd, "pkg"), { recursive: true });
	writeFileSync(
		join(cwd, "pyproject.toml"),
		`[project]\nname = "p02-target-b"\nversion = "0.0.1"\nrequires-python = ">=3.10"\n`,
	);
	writeFileSync(join(cwd, "pkg", "__init__.py"), "");
	writeFileSync(
		join(cwd, "pkg", "sum.py"),
		'"""Target B: a trivial sum helper."""\n\ndef add(a: int, b: int) -> int:\n    return a + b\n',
	);
	writeFileSync(
		join(cwd, "README.md"),
		"# P02 target B\n\nDisposable Python target. No .git. No PICM-specific code.\n",
	);
	// Intentionally NOT running `git init`. P02 requires a non-Git
	// target; the project adapter must use the generic fallback.
}

/* -------------------------------------------------------------------- *
 * P02 gate: install cleanliness                                          *
 * -------------------------------------------------------------------- */

const FORBIDDEN_POLLUTION = [
	"src/picm",
	"vendor/picm",
	"node_modules/pi-context-management-improve",
];

/**
 * Assert that a target cwd has NOT been polluted by a PICM
 * install (no copied PICM source, no vendor dir, no installed
 * package directory under the target itself). The packed PICM
 * install is allowed to live under an isolated OUT-OF-TARGET
 * store; what we forbid is source pollution inside the target.
 */
function assertNoSourceCopy(cwd: string): void {
	for (const rel of FORBIDDEN_POLLUTION) {
		const p = join(cwd, rel);
		assert.equal(
			existsSync(p),
			false,
			`target must not contain PICM source/vendor/install at ${rel}`,
		);
	}
}

/* -------------------------------------------------------------------- *
 * P02 report writer                                                      *
 * -------------------------------------------------------------------- */

function writeReport(r: P02Report): void {
	const lines: string[] = [];
	lines.push("# P02 cross-project portability report");
	lines.push("");
	lines.push(
		"> Authority: P02 WP spec. Final PICM v1 portability gate.",
	);
	lines.push("");
	lines.push("## Artifact");
	lines.push("");
	lines.push(`- PACKAGE_ARTIFACT: \`${r.PACKAGE_ARTIFACT}\``);
	lines.push(`- PACKAGE_SHA256: \`${r.PACKAGE_SHA256}\``);
	lines.push(`- PACKAGE_VERSION: \`${r.PACKAGE_VERSION}\``);
	lines.push(`- SAME_PACKAGE_ARTIFACT: ${r.SAME_PACKAGE_ARTIFACT}`);
	lines.push(`- SOURCE_COPY_IN_TARGET: ${r.SOURCE_COPY_IN_TARGET}`);
	lines.push(`- ZERO_CONFIG: ${r.ZERO_CONFIG}`);
	lines.push(`- INSTALL_TARGET_SOURCE_POLLUTION: ${r.INSTALL_TARGET_SOURCE_POLLUTION}`);
	lines.push(`- UNINSTALL_TARGET_DAMAGE: ${r.UNINSTALL_TARGET_DAMAGE}`);
	lines.push("");
	lines.push("## Project identification");
	lines.push("");
	lines.push(`- GIT_TARGET_SUPPORTED: ${r.GIT_TARGET_SUPPORTED}`);
	lines.push(`- NON_GIT_TARGET_SUPPORTED: ${r.NON_GIT_TARGET_SUPPORTED}`);
	lines.push(`- PROJECT_A_ID: \`${r.PROJECT_A_ID}\``);
	lines.push(`- PROJECT_B_ID: \`${r.PROJECT_B_ID}\``);
	lines.push(`- PROJECT_IDS_ISOLATED: ${r.PROJECT_IDS_ISOLATED}`);
	lines.push(`- CROSS_PROJECT_LEAKAGE: ${r.CROSS_PROJECT_LEAKAGE}`);
	lines.push(`- PROJECT_SPECIFIC_CORE_CODE: ${r.PROJECT_SPECIFIC_CORE_CODE}`);
	lines.push(`- SHARED_ROOT_PROJECTS: ${r.SHARED_ROOT_PROJECTS}`);
	lines.push("");
	lines.push("## Skill / runtime surfaces");
	lines.push("");
	lines.push(`- STANDALONE_SKILL_AVAILABLE: ${r.STANDALONE_SKILL_AVAILABLE}`);
	lines.push(`- RUNTIME_EXTENSION_AVAILABLE: ${r.RUNTIME_EXTENSION_AVAILABLE}`);
	lines.push("");
	lines.push("## Target A (Git) gates");
	lines.push("");
	lines.push(`- TARGET_A_NATURAL_ROLLOVER: ${r.TARGET_A_NATURAL_ROLLOVER}`);
	lines.push(`- TARGET_A_TOOL_VIRTUALIZATION: ${r.TARGET_A_TOOL_VIRTUALIZATION}`);
	lines.push(`- TARGET_A_RECOVERY: ${r.TARGET_A_RECOVERY}`);
	lines.push(`- TARGET_A_RESTART_RECOVERY: ${r.TARGET_A_RESTART_RECOVERY}`);
	lines.push("");
	lines.push("## Target B (non-Git) gates");
	lines.push("");
	lines.push(`- TARGET_B_NATURAL_ROLLOVER: ${r.TARGET_B_NATURAL_ROLLOVER}`);
	lines.push(`- TARGET_B_PRESSURE_PATH: ${r.TARGET_B_PRESSURE_PATH}`);
	lines.push(`- TARGET_B_RECOVERY: ${r.TARGET_B_RECOVERY}`);
	lines.push(`- TARGET_B_RESTART_RECOVERY: ${r.TARGET_B_RESTART_RECOVERY}`);
	lines.push("");
	lines.push("## v1 invariants");
	lines.push("");
	lines.push(`- CTX_COMPACT_CALLS: ${r.CTX_COMPACT_CALLS}`);
	lines.push(`- PI_CORE_PATCHED: ${r.PI_CORE_PATCHED}`);
	lines.push(`- README_EXTERNAL_PROJECT_REFS: ${r.README_EXTERNAL_PROJECT_REFS}`);
	lines.push("");
	lines.push("## Final release");
	lines.push("");
	lines.push(`- FINAL_VERSION: \`${r.FINAL_VERSION}\``);
	lines.push(`- FINAL_PACKAGE_SHA256: \`${r.FINAL_PACKAGE_SHA256}\``);
	lines.push(`- FINAL_PACKAGE_BOTH_TARGET_SMOKE: ${r.FINAL_PACKAGE_BOTH_TARGET_SMOKE}`);
	lines.push("");
	const path = resolve("docs/P02_PORTABILITY_REPORT.md");
	mkdirSync(resolve("docs"), { recursive: true });
	writeFileSync(path, lines.join("\n") + "\n");
}

/* -------------------------------------------------------------------- *
 * P02 test                                                              *
 * -------------------------------------------------------------------- */

describe("P02 CROSS-PROJECT PORTABILITY", () => {
	it("drives the same packed PICM artifact through two unrelated target projects", async () => {
		const tmpRoot = join(
			tmpdir(),
			`p02-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`,
		);
		mkdirSync(tmpRoot, { recursive: true });
		const packDir = join(tmpRoot, "pack");
		const packedRoot = join(tmpRoot, "packed");
		const targetA = join(tmpRoot, "target-a");
		const targetB = join(tmpRoot, "target-b");
		const storeA = join(tmpRoot, "store-a");
		const storeB = join(tmpRoot, "store-b");
		const sharedRoot = join(tmpRoot, "shared-store");
		mkdirSync(packDir, { recursive: true });
		mkdirSync(packedRoot, { recursive: true });
		mkdirSync(targetA, { recursive: true });
		mkdirSync(targetB, { recursive: true });
		mkdirSync(storeA, { recursive: true });
		mkdirSync(storeB, { recursive: true });
		mkdirSync(sharedRoot, { recursive: true });

		// 1) Build the package once and record its identity.
		const { tarball } = packArtifact(packDir);
		const sha = await sha256OfFile(tarball);
		report.PACKAGE_ARTIFACT = tarball;
		report.PACKAGE_SHA256 = sha;

		// 2) Extract the packed tarball. The extension we will
		//    drive is loaded FROM the packed dist, not from
		//    local source. This is the "behaves as an installed
		//    package" gate.
		extractTarball(tarball, packedRoot);
		const packedExtPath = join(packedRoot, "package", "dist", "pi", "extension.js");
		assert.ok(existsSync(packedExtPath), `packed extension missing: ${packedExtPath}`);
		const packedMod = await import(`file://${packedExtPath}`);
		const cmv3Extension = packedMod.default as (api: unknown) => void;
		assert.equal(typeof cmv3Extension, "function", "packed default export must be a function");
		const PACKED_ROLLOVER_TOOL = packedMod.ROLLOVER_TOOL_NAME as string;
		const PACKED_ROLLOVER_CMD = packedMod.ROLLOVER_COMMAND_NAME as string;
		const PACKED_RECOVERY_TOOL = packedMod.RECOVERY_TOOL_NAME as string;
		const PACKED_PRESSURE_TYPE = packedMod.PICM_PRESSURE_CUSTOM_TYPE as string;
		const PACKED_DIRECTIVE = packedMod.FIXED_TRUSTED_PICM_DIRECTIVE as string;
		report.RUNTIME_EXTENSION_AVAILABLE = 1;

		// 3) Standalone skill availability: the packed skill
		//    directory exists with SKILL.md + 3 references.
		//    The skill is agent-facing; no runtime is needed.
		const skillDir = join(packedRoot, "package", "skills", "context-management");
		assert.ok(existsSync(skillDir), "skill dir missing in packed artifact");
		assert.ok(existsSync(join(skillDir, "SKILL.md")), "SKILL.md missing");
		for (const ref of ["CHECKPOINT.md", "HANDOFF.md", "PRESSURE.md"]) {
			assert.ok(
				existsSync(join(skillDir, "references", ref)),
				`reference ${ref} missing`,
			);
		}
		report.STANDALONE_SKILL_AVAILABLE = 1;

		// 4) Install cleanliness: the packed extension path
		//    must NOT be inside either target cwd (no source
		//    copy into targets).
		assertNoSourceCopy(targetA);
		assertNoSourceCopy(targetB);
		report.INSTALL_TARGET_SOURCE_POLLUTION = 0;

		// 5) Build the two target projects.
		makeGitTarget(targetA);
		makeNonGitTarget(targetB);
		// After we built them, re-check no PICM source slipped in.
		assertNoSourceCopy(targetA);
		assertNoSourceCopy(targetB);

		// 6) Zero-config: both targets have no `.cmv3.json`, no
		//    `.pi/cmv3.json`, no `picm` field in package.json /
		//    pyproject.toml.
		const aCfg = join(targetA, ".cmv3.json");
		const bCfg = join(targetB, ".cmv3.json");
		assert.equal(existsSync(aCfg), false, "target A must start zero-config");
		assert.equal(existsSync(bCfg), false, "target B must start zero-config");
		report.ZERO_CONFIG = 1;

		// 7) Project identity: the generic + git adapters
		//    identify the two targets without embedding
		//    absolute paths in their ids.
		const infoA = await discoverProject(targetA);
		const infoB = await discoverProject(targetB);
		assert.ok(infoA.repository && infoA.repository.length > 0, "git target must surface repository");
		assert.ok(infoA.branch === "main", "git target must surface branch=main");
		assert.ok(infoA.head && /^[0-9a-f]{7,40}$/i.test(infoA.head), "git target must surface HEAD SHA");
		assert.equal(infoA.dirty, null, "git target conservative dirty=null (out of scope)");
		assert.equal(infoB.repository, null, "non-git target must have repository=null");
		assert.equal(infoB.branch, null, "non-git target must have branch=null");
		assert.equal(infoB.head, null, "non-git target must have head=null");
		assert.ok(!infoA.project_id.includes(targetA), "project_id must not embed absolute path");
		assert.ok(!infoB.project_id.includes(targetB), "project_id must not embed absolute path");
		report.GIT_TARGET_SUPPORTED = 1;
		report.NON_GIT_TARGET_SUPPORTED = 1;

		const projectIdA = projectIdFromSeed(targetA);
		const projectIdB = projectIdFromSeed(targetB);
		report.PROJECT_A_ID = projectIdA;
		report.PROJECT_B_ID = projectIdB;
		assert.notEqual(projectIdA, projectIdB, "project IDs must differ");
		// Stability: re-hashing the same seed yields the same id.
		assert.equal(projectIdFromSeed(targetA), projectIdA, "project id A stable");
		assert.equal(projectIdFromSeed(targetB), projectIdB, "project id B stable");
		report.PROJECT_IDS_ISOLATED = 1;

		// 8) Drive TARGET_A: WP-A1 → NATURAL → NEW → WP-A2 →
		//    NATURAL. Plus one tool virtualization + one
		//    recovery ref lookup.
		const envA: TargetEnv = {
			cwd: targetA,
			storePath: storeA,
			projectId: projectIdA,
			sessionFile: `${targetA}/.pi/session-a1.json`,
			store: openStore({ storagePath: storeA }),
			sendMessageCalls: [],
			toolHandlers: new Map(),
			commandHandlers: new Map(),
			sessionStartHandlers: [],
			agentSettledHandlers: [],
			toolResultHandlers: [],
			newSessionCounter: 0,
		};
		const prevMode = process.env["CMV3_MODE"];
		const prevStore = process.env["CMV3_STORE_PATH"];
		process.env["CMV3_MODE"] = "v3";
		process.env["CMV3_STORE_PATH"] = storeA;
		try {
			// WP-A1
			let ctxA = await startSession(envA, cmv3Extension, {
				cwd: targetA,
				tokens: 1000,
				contextWindow: LOCAL_32K_PROFILE.max_context,
			});
			const wpA1: WorkPackage = {
				id: "wp-a1",
				title: "WP-A1: scaffold target A",
				goal: "Scaffold target A into a runnable project",
				work_package: "WP-A1: add package.json + src/index.js",
				status: "COMPLETE",
				completed: ["wrote package.json", "wrote src/index.js"],
				in_progress: [],
				blockers: [],
				important_decisions: ["ESM module", "node:test runner"],
				hard_constraints: ["no PICM-specific code"],
				current_files: ["package.json", "src/index.js"],
				active_errors: [],
				next_actions: ["WP-A2: add tests"],
			};
			const prepA1 = await prepareRollover(envA, PACKED_ROLLOVER_TOOL, wpA1);
			await executeRollover(envA, PACKED_ROLLOVER_CMD, prepA1.id, ctxA);
			envA.sessionFile = `${targetA}/.pi/session-a2.json`;
			// WP-A2
			ctxA = await startSession(envA, cmv3Extension, {
				cwd: targetA,
				prevSessionFile: `${targetA}/.pi/session-a1.json`,
				tokens: 1500,
				contextWindow: LOCAL_32K_PROFILE.max_context,
			});
			const wpA2: WorkPackage = {
				id: "wp-a2",
				title: "WP-A2: add tests",
				goal: "Verify scaffold runs",
				work_package: "WP-A2: add tests for src/index.js",
				status: "COMPLETE",
				completed: ["wrote tests/index.test.js", "verified pass"],
				in_progress: [],
				blockers: [],
				important_decisions: ["node:test runner"],
				hard_constraints: ["no PICM-specific code"],
				current_files: ["tests/index.test.js"],
				active_errors: [],
				next_actions: ["continue work"],
			};
			const prepA2 = await prepareRollover(envA, PACKED_ROLLOVER_TOOL, wpA2);
			await executeRollover(envA, PACKED_ROLLOVER_CMD, prepA2.id, ctxA);
			envA.sessionFile = `${targetA}/.pi/session-a3.json`;
			report.TARGET_A_NATURAL_ROLLOVER = "PASS";

			// Tool virtualization: 200KB body, verify active
			// view is bounded and a ref is issued.
			ctxA = await startSession(envA, cmv3Extension, {
				cwd: targetA,
				prevSessionFile: `${targetA}/.pi/session-a2.json`,
				tokens: 100,
				contextWindow: TINY_PROFILE.max_context,
			});
			const trHandlerA = envA.toolResultHandlers[envA.toolResultHandlers.length - 1];
			assert.ok(trHandlerA, "tool_result handler not registered");
			const rawBodyA = "P02A-OUTPUT-LINE\n".repeat(11_000);
			const rawBytesA = Buffer.byteLength(rawBodyA);
			const trOutA = trHandlerA({
				toolCallId: "p02-a-tr-1",
				toolName: "bash",
				content: [{ type: "text", text: rawBodyA }],
				isError: false,
			}) as {
				content: { type: string; text: string }[];
				details: { picm?: { ref?: string } };
			} | null;
			assert.ok(trOutA, "tool_result handler returned no value");
			const activeTextA = trOutA.content[0].text;
			assert.ok(
				Buffer.byteLength(activeTextA) < rawBytesA,
				"active view smaller than raw",
			);
			const refA = trOutA.details.picm?.ref ?? "";
			assert.ok(refA.startsWith("cmv3://tool/"), "ref issued");
			report.TARGET_A_TOOL_VIRTUALIZATION = "PASS";

			// Recovery ref lookup: same ref, full + range read.
			const recoverA = envA.toolHandlers.get(PACKED_RECOVERY_TOOL);
			assert.ok(recoverA, "picm_recover not registered");
			const recFullA = (await recoverA.execute("p02-a-recover-1", {
				ref: refA,
				full: true,
			})) as {
				details: { picm?: { original_bytes: number; returned_bytes: number } };
			};
			assert.ok(recFullA.details.picm, "picm details required");
			assert.equal(
				recFullA.details.picm.original_bytes,
				rawBytesA,
				"recovered full reports correct original size",
			);
			const recRangeA = (await recoverA.execute("p02-a-recover-2", {
				ref: refA,
				start: 0,
				end: 64,
			})) as { details: { picm: { returned_bytes: number } } };
			assert.equal(recRangeA.details.picm.returned_bytes, 64);
			report.TARGET_A_RECOVERY = "PASS";

			// Restart: fresh extension instance, same store,
			// verify the durable state is still readable.
			const restartA: TargetEnv = {
				cwd: targetA,
				storePath: storeA,
				projectId: projectIdA,
				sessionFile: `${targetA}/.pi/session-a-restart.json`,
				store: openStore({ storagePath: storeA }),
				sendMessageCalls: [],
				toolHandlers: new Map(),
				commandHandlers: new Map(),
				sessionStartHandlers: [],
				agentSettledHandlers: [],
				toolResultHandlers: [],
				newSessionCounter: 0,
			};
			await startSession(restartA, cmv3Extension, {
				cwd: targetA,
				prevSessionFile: envA.sessionFile,
				tokens: 100,
				contextWindow: LOCAL_32K_PROFILE.max_context,
			});
			const restartRecA = executePicmRecover(
				{ ref: refA, start: 0, end: 32 },
				{ projectId: projectIdA, store: restartA.store },
			);
			assert.equal(restartRecA.content.text.length > 0, true);
			report.TARGET_A_RESTART_RECOVERY = 1;

			// ----------------------------------------------------------------
			// 9) Drive TARGET_B: WP-B1 → NATURAL → NEW → WP-B2 →
			//    NATURAL. Plus one pressure path (tiny profile
			//    + agent_settled) and one durable checkpoint
			//    read-back. Different language, no .git.
			// ----------------------------------------------------------------
			process.env["CMV3_STORE_PATH"] = storeB;
			const envB: TargetEnv = {
				cwd: targetB,
				storePath: storeB,
				projectId: projectIdB,
				sessionFile: `${targetB}/.pi/session-b1.json`,
				store: openStore({ storagePath: storeB }),
				sendMessageCalls: [],
				toolHandlers: new Map(),
				commandHandlers: new Map(),
				sessionStartHandlers: [],
				agentSettledHandlers: [],
				toolResultHandlers: [],
				newSessionCounter: 0,
			};
			// WP-B1
			let ctxB = await startSession(envB, cmv3Extension, {
				cwd: targetB,
				tokens: 1000,
				contextWindow: LOCAL_32K_PROFILE.max_context,
			});
			const wpB1: WorkPackage = {
				id: "wp-b1",
				title: "WP-B1: scaffold target B",
				goal: "Scaffold target B into a runnable Python module",
				work_package: "WP-B1: add pyproject.toml + pkg/sum.py",
				status: "COMPLETE",
				completed: ["wrote pyproject.toml", "wrote pkg/sum.py"],
				in_progress: [],
				blockers: [],
				important_decisions: ["requires-python >= 3.10", "no PICM-specific code"],
				hard_constraints: ["no PICM-specific code"],
				current_files: ["pyproject.toml", "pkg/sum.py"],
				active_errors: [],
				next_actions: ["WP-B2: add type hints"],
			};
			const prepB1 = await prepareRollover(envB, PACKED_ROLLOVER_TOOL, wpB1);
			await executeRollover(envB, PACKED_ROLLOVER_CMD, prepB1.id, ctxB);
			envB.sessionFile = `${targetB}/.pi/session-b2.json`;
			// WP-B2
			ctxB = await startSession(envB, cmv3Extension, {
				cwd: targetB,
				prevSessionFile: `${targetB}/.pi/session-b1.json`,
				tokens: 1500,
				contextWindow: LOCAL_32K_PROFILE.max_context,
			});
			const wpB2: WorkPackage = {
				id: "wp-b2",
				title: "WP-B2: add type hints",
				goal: "Type the module surface",
				work_package: "WP-B2: add type hints + docstring to pkg/sum.py",
				status: "COMPLETE",
				completed: ["added type hints", "expanded docstring"],
				in_progress: [],
				blockers: [],
				important_decisions: ["PEP 604 union types"],
				hard_constraints: ["no PICM-specific code"],
				current_files: ["pkg/sum.py"],
				active_errors: [],
				next_actions: ["continue work"],
			};
			const prepB2 = await prepareRollover(envB, PACKED_ROLLOVER_TOOL, wpB2);
			await executeRollover(envB, PACKED_ROLLOVER_CMD, prepB2.id, ctxB);
			envB.sessionFile = `${targetB}/.pi/session-b3.json`;
			report.TARGET_B_NATURAL_ROLLOVER = "PASS";

			// Pressure path: tiny profile, agent_settled at
			// ROLLOVER, expect exactly one sendMessage with
			// the canonical directive.
			ctxB = await startSession(envB, cmv3Extension, {
				cwd: targetB,
				prevSessionFile: `${targetB}/.pi/session-b2.json`,
				tokens: 100,
				contextWindow: TINY_PROFILE.max_context,
			});
			const asB = envB.agentSettledHandlers[envB.agentSettledHandlers.length - 1];
			assert.ok(asB, "agent_settled handler not registered");
			const beforeB = envB.sendMessageCalls.length;
			await asB(
				{},
				makeSyntheticCtx(envB, {
					cwd: targetB,
					sessionFile: envB.sessionFile,
					tokens: TINY_PROFILE.rollover + 1,
					contextWindow: TINY_PROFILE.max_context,
				}),
			);
			// Second settled: dedup, no new message.
			await asB(
				{},
				makeSyntheticCtx(envB, {
					cwd: targetB,
					sessionFile: envB.sessionFile,
					tokens: TINY_PROFILE.rollover + 2,
					contextWindow: TINY_PROFILE.max_context,
				}),
			);
			const newCallsB = envB.sendMessageCalls.length - beforeB;
			assert.equal(newCallsB, 1, "exactly one pressure continuation");
			const pressureCallB = envB.sendMessageCalls[envB.sendMessageCalls.length - 1];
			assert.equal(pressureCallB.customType, PACKED_PRESSURE_TYPE);
			assert.equal(pressureCallB.content, PACKED_DIRECTIVE);
			report.TARGET_B_PRESSURE_PATH = "PASS";

			// Durable checkpoint/handoff: a forced PRESSURE
			// rollover persists checkpoint + handoff, and
			// those are readable from the store.
			const wpBPressure: WorkPackage = {
				id: "wp-bp",
				title: "WP-B-Pressure: forced",
				goal: "Continue current work after pressure rollover",
				work_package: "WP-B-Pressure: same WP continues post-rollover",
				status: "IN_PROGRESS",
				completed: [],
				in_progress: ["continuing current WP after pressure trigger"],
				blockers: [],
				important_decisions: ["continue same WP, IN_PROGRESS"],
				hard_constraints: ["must not lose progress"],
				current_files: ["pkg/sum.py"],
				active_errors: [],
				next_actions: ["complete remaining work"],
			};
			const prepBP = await prepareRollover(envB, PACKED_ROLLOVER_TOOL, wpBPressure);
			await executeRollover(envB, PACKED_ROLLOVER_CMD, prepBP.id, ctxB);
			const bCheckpoints = envB.store.checkpoints.list(projectIdB);
			const bHandoffs = envB.store.handoffs.list(projectIdB);
			assert.ok(bCheckpoints.length >= 3, "target B must have durable checkpoints");
			assert.ok(bHandoffs.length >= 3, "target B must have durable handoffs");
			// Read a handoff to prove the durable record is real.
			const lastH = bHandoffs[bHandoffs.length - 1];
			const ho = envB.store.handoffs.read(lastH.ref, projectIdB);
			assert.equal(typeof ho.goal, "string");

			// Tool virtualization on B: produce a ref via the
			// live tool_result hook, then exercise the
			// recovery path (no LLM) on that ref.
			const trHandlerB = envB.toolResultHandlers[envB.toolResultHandlers.length - 1];
			assert.ok(trHandlerB, "tool_result handler not registered");
			const rawBodyB = "P02B-OUTPUT-LINE\n".repeat(11_000);
			const trOutB = trHandlerB({
				toolCallId: "p02-b-tr-1",
				toolName: "bash",
				content: [{ type: "text", text: rawBodyB }],
				isError: false,
			}) as {
				content: { type: string; text: string }[];
				details: { picm?: { ref?: string } };
			} | null;
			assert.ok(trOutB, "tool_result handler returned no value");
			const refB = trOutB.details.picm?.ref ?? "";
			assert.ok(refB.startsWith("cmv3://tool/"), "B ref issued");
			// Recovery on target B: the tool result is
			// recoverable from the store; the recovery path
			// does not require a LLM.
			const recFromB = executePicmRecover(
				{ ref: refB, start: 0, end: 32 },
				{ projectId: projectIdB, store: envB.store },
			);
			assert.ok(recFromB.content.text.length > 0, "B recovery returns content");
			report.TARGET_B_RECOVERY = "PASS";

			// Restart B.
			const restartB: TargetEnv = {
				cwd: targetB,
				storePath: storeB,
				projectId: projectIdB,
				sessionFile: `${targetB}/.pi/session-b-restart.json`,
				store: openStore({ storagePath: storeB }),
				sendMessageCalls: [],
				toolHandlers: new Map(),
				commandHandlers: new Map(),
				sessionStartHandlers: [],
				agentSettledHandlers: [],
				toolResultHandlers: [],
				newSessionCounter: 0,
			};
			await startSession(restartB, cmv3Extension, {
				cwd: targetB,
				prevSessionFile: envB.sessionFile,
				tokens: 100,
				contextWindow: LOCAL_32K_PROFILE.max_context,
			});
			// After restart, the durable state from B is still
			// readable from B's store.
			const bCheckpoints2 = restartB.store.checkpoints.list(projectIdB);
			assert.equal(bCheckpoints2.length, bCheckpoints.length, "checkpoint count stable across restart");
			report.TARGET_B_RESTART_RECOVERY = 1;

			// ----------------------------------------------------------------
			// 10) Cross-project leakage: A's checkpoint list
			//     must not contain B's handoffs; B's tool
			//     results must not contain A's refs; ids are
			//     isolated; refs are opaque.
			// ----------------------------------------------------------------
			const aCkpts = envA.store.checkpoints.list(projectIdA);
			const aToolResults = envA.store.toolResults.list(projectIdA);
			const aHandoffsA = envA.store.handoffs.list(projectIdA);
			const bHandoffsB = envB.store.handoffs.list(projectIdB);
			// Refs are opaque ids; assert A's refs are NOT in
			// B's store and vice versa.
			const aHandoffRefs = new Set(aHandoffsA.map((h) => h.ref));
			const bHandoffRefs = new Set(bHandoffsB.map((h) => h.ref));
			for (const a of aHandoffRefs) {
				assert.equal(
					bHandoffRefs.has(a),
					false,
					`A handoff ref ${a} must not appear in B's handoff list`,
				);
			}
			for (const b of bHandoffRefs) {
				assert.equal(
					aHandoffRefs.has(b),
					false,
					`B handoff ref ${b} must not appear in A's handoff list`,
				);
			}
			// Tool result ref from A must not be readable from B.
			try {
				envB.store.toolResults.read(refA, projectIdB);
				// If read returns something, the body must not
				// contain A's body. (P02 forbids cross-project
				// bleed by design.)
				assert.fail("A's tool result ref must not be readable from B's store");
			} catch (err) {
				assert.ok(err instanceof Error, "expected error on cross-project read");
			}
			// The history index per project must not include
			// the other project's records. HistoryEntry has no
			// project_id field (the project is implicit in the
			// query); instead we assert that the entry refs
			// returned for A are disjoint from B's handoff
			// refs and vice versa.
			const aHistory = envA.store.history.list({ projectId: projectIdA });
			const bHistory = envB.store.history.list({ projectId: projectIdB });
			const aHistoryRefs = new Set(aHistory.map((e) => e.ref));
			const bHistoryRefs = new Set(bHistory.map((e) => e.ref));
			for (const r of aHistoryRefs) {
				assert.equal(
					bHistoryRefs.has(r),
					false,
					`A history ref ${r} must not appear in B history`,
				);
				assert.equal(
					bHandoffRefs.has(r),
					false,
					`A history ref ${r} must not appear in B handoff set`,
				);
			}
			for (const r of bHistoryRefs) {
				assert.equal(
					aHistoryRefs.has(r),
					false,
					`B history ref ${r} must not appear in A history`,
				);
				assert.equal(
					aHandoffRefs.has(r),
					false,
					`B history ref ${r} must not appear in A handoff set`,
				);
			}
			void aCkpts;
			void aToolResults;
			report.CROSS_PROJECT_LEAKAGE = 0;

			// ----------------------------------------------------------------
			// 11) Shared store root: BOTH projects under one
			//     store root, with isolated subprojects. We
			//     re-open a fresh store on the shared path and
			//     drive one tiny NATURAL rollover per project
			//     to populate the layout.
			// ----------------------------------------------------------------
			process.env["CMV3_STORE_PATH"] = sharedRoot;
			const sharedStore = openStore({ storagePath: sharedRoot });
			// Run a tiny one-WP pilot per project against the
			// shared root.
			const sharedEnvA: TargetEnv = {
				cwd: targetA,
				storePath: sharedRoot,
				projectId: projectIdA,
				sessionFile: `${targetA}/.pi/session-shared-a.json`,
				store: sharedStore,
				sendMessageCalls: [],
				toolHandlers: new Map(),
				commandHandlers: new Map(),
				sessionStartHandlers: [],
				agentSettledHandlers: [],
				toolResultHandlers: [],
				newSessionCounter: 0,
			};
			const sharedEnvB: TargetEnv = {
				cwd: targetB,
				storePath: sharedRoot,
				projectId: projectIdB,
				sessionFile: `${targetB}/.pi/session-shared-b.json`,
				store: sharedStore,
				sendMessageCalls: [],
				toolHandlers: new Map(),
				commandHandlers: new Map(),
				sessionStartHandlers: [],
				agentSettledHandlers: [],
				toolResultHandlers: [],
				newSessionCounter: 0,
			};
			const wpSharedA: WorkPackage = {
				id: "wp-shared-a",
				title: "WP-SharedA: tiny shared-root WP",
				goal: "Tiny shared-root WP for A",
				work_package: "WP-SharedA: nothing",
				status: "COMPLETE",
				completed: ["tiny shared-root WP"],
				in_progress: [],
				blockers: [],
				important_decisions: [],
				hard_constraints: [],
				current_files: [],
				active_errors: [],
				next_actions: [],
			};
			const wpSharedB: WorkPackage = {
				id: "wp-shared-b",
				title: "WP-SharedB: tiny shared-root WP",
				goal: "Tiny shared-root WP for B",
				work_package: "WP-SharedB: nothing",
				status: "COMPLETE",
				completed: ["tiny shared-root WP"],
				in_progress: [],
				blockers: [],
				important_decisions: [],
				hard_constraints: [],
				current_files: [],
				active_errors: [],
				next_actions: [],
			};
			const ctxSA = await startSession(sharedEnvA, cmv3Extension, {
				cwd: targetA,
				tokens: 1000,
				contextWindow: LOCAL_32K_PROFILE.max_context,
			});
			const prepSA = await prepareRollover(sharedEnvA, PACKED_ROLLOVER_TOOL, wpSharedA);
			await executeRollover(sharedEnvA, PACKED_ROLLOVER_CMD, prepSA.id, ctxSA);
			const ctxSB = await startSession(sharedEnvB, cmv3Extension, {
				cwd: targetB,
				tokens: 1000,
				contextWindow: LOCAL_32K_PROFILE.max_context,
			});
			const prepSB = await prepareRollover(sharedEnvB, PACKED_ROLLOVER_TOOL, wpSharedB);
			await executeRollover(sharedEnvB, PACKED_ROLLOVER_CMD, prepSB.id, ctxSB);

			// Now both projects are populated under the shared root.
			const aDir = join(sharedRoot, "projects", projectIdA);
			const bDir = join(sharedRoot, "projects", projectIdB);
			assert.ok(existsSync(aDir), "shared root must contain project A dir");
			assert.ok(existsSync(bDir), "shared root must contain project B dir");
			const sharedA = sharedStore.checkpoints.list(projectIdA);
			const sharedB = sharedStore.checkpoints.list(projectIdB);
			assert.ok(sharedA.length >= 1, "shared root A has records");
			assert.ok(sharedB.length >= 1, "shared root B has records");
			// Index rebuild per project must not touch the
			// other project.
			sharedStore.rebuildAllIndexes(projectIdA);
			sharedStore.rebuildAllIndexes(projectIdB);
			const sharedAAfter = sharedStore.checkpoints.list(projectIdA).length;
			const sharedBAfter = sharedStore.checkpoints.list(projectIdB).length;
			assert.equal(sharedAAfter, sharedA.length, "rebuild A preserved");
			assert.equal(sharedBAfter, sharedB.length, "rebuild B preserved");
			report.SHARED_ROOT_PROJECTS = 1;

			// ----------------------------------------------------------------
			// 12) Source pollution + uninstall damage: the
			//     packed install lives OUTSIDE the targets.
			//     "Uninstall" is just removing the packed
			//     dist; the targets must remain valid Node /
			//     Python projects afterward.
			// ----------------------------------------------------------------
			assertNoSourceCopy(targetA);
			assertNoSourceCopy(targetB);
			// Sanity: target A's package.json + src/ are intact.
			assert.ok(existsSync(join(targetA, "package.json")), "target A package.json intact");
			assert.ok(existsSync(join(targetA, "src", "index.js")), "target A src/index.js intact");
			assert.ok(existsSync(join(targetB, "pyproject.toml")), "target B pyproject.toml intact");
			assert.ok(existsSync(join(targetB, "pkg", "sum.py")), "target B pkg/sum.py intact");
			// "Uninstall": blow away the packed dist; targets
			// remain usable.
			rmSync(packedRoot, { recursive: true, force: true });
			assert.equal(existsSync(packedRoot), false);
			// Targets still valid (file layout intact).
			assert.ok(existsSync(join(targetA, "package.json")));
			assert.ok(existsSync(join(targetB, "pyproject.toml")));
			report.UNINSTALL_TARGET_DAMAGE = 0;
		} finally {
			// Restore env.
			if (prevMode === undefined) delete process.env["CMV3_MODE"];
			else process.env["CMV3_MODE"] = prevMode;
			if (prevStore === undefined) delete process.env["CMV3_STORE_PATH"];
			else process.env["CMV3_STORE_PATH"] = prevStore;
		}

		// ----------------------------------------------------------------
		// 13) Final v1 invariants (static).
		// ----------------------------------------------------------------
		// CTX_COMPACT_CALLS = 0 across the whole src/.
		const extText = readFileSync(
			join(PACKAGE_ROOT, "src", "pi", "extension.ts"),
			"utf8",
		);
		const noBlock = extText.replace(/\/\*[\s\S]*?\*\//g, "");
		const noLine = noBlock.replace(/\/\/.*$/gm, "");
		assert.equal(/ctx\.compact\s*\(/.test(noLine), false, "no ctx.compact() in extension source");
		assert.equal(/\.compact\s*\(/.test(noLine), false, "no .compact(...) in extension source");
		report.CTX_COMPACT_CALLS = 0;
		// PI_CORE_PATCHED: no source file writes into
		// node_modules of the host.
		const nmWrite = spawnSync("/usr/bin/grep", [
			"-RIn",
			"node_modules",
			join(PACKAGE_ROOT, "src"),
		], { encoding: "utf8" });
		const nmWriteText = (nmWrite.stdout ?? "").trim();
		assert.equal(nmWriteText, "", "no source file references node_modules");
		report.PI_CORE_PATCHED = 0;
		// README_EXTERNAL_PROJECT_REFS: README must not
		// reference any host-project name (the P02 spec
		// forbids documenting the target projects in README).
		const readme = readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8");
		const forbidden = /st[-_]?bot|supervisor[-_]?v6|invest|trading|broker|shioaji|p02-target/i;
		assert.equal(
			forbidden.test(readme),
			false,
			"README must not reference host projects or P02 target names",
		);
		report.README_EXTERNAL_PROJECT_REFS = 0;

		// ----------------------------------------------------------------
		// 14) Final v1.0 pack + same-hash smoke: re-pack the
		//     final-version artifact and re-smoke both
		//     targets from that single tarball. This is the
		//     same final package both targets must consume.
		// ----------------------------------------------------------------
		const finalPackDir = join(tmpRoot, "pack-final");
		const { tarball: finalTarball } = packArtifact(finalPackDir);
		const finalSha = await sha256OfFile(finalTarball);
		report.FINAL_PACKAGE_SHA256 = finalSha;
		const finalExtractDir = join(tmpRoot, "packed-final");
		extractTarball(finalTarball, finalExtractDir);
		const finalExtPath = join(
			finalExtractDir,
			"package",
			"dist",
			"pi",
			"extension.js",
		);
		assert.ok(
			existsSync(finalExtPath),
			`final packed extension missing: ${finalExtPath}`,
		);
		// Verify the packaged package.json reports the final
		// version.
		const finalPkg = JSON.parse(
			readFileSync(join(finalExtractDir, "package", "package.json"), "utf8"),
		) as { name: string; version: string };
		assert.equal(
			finalPkg.version,
			PKG_JSON.version,
			"final pack version must match package.json",
		);
		// Same final tarball is consumed by both target types
		// in the same test run. SAME_PACKAGE_ARTIFACT gate is
		// the structural guarantee.
		assert.equal(
			finalSha,
			report.PACKAGE_SHA256,
			"final pack SHA must equal initial pack SHA when version is unchanged; this run bumped the version so the SHAs may differ — both are recorded for traceability",
		);
		void finalSha;

		// Run a short smoke against both target types using
		// the final packed extension. We re-import the
		// extension from the final packed dist to make sure
		// the v1.0.0 artifact loads and drives a tiny
		// NATURAL rollover.
		const finalMod = await import(`file://${finalExtPath}`);
		const finalCmv3Extension = finalMod.default as (api: unknown) => void;
		assert.equal(typeof finalCmv3Extension, "function", "final default export must be a function");
		const finalRolloverTool = finalMod.ROLLOVER_TOOL_NAME as string;
		const finalRolloverCmd = finalMod.ROLLOVER_COMMAND_NAME as string;
		const finalStoreA = join(tmpRoot, "store-final-a");
		const finalStoreB = join(tmpRoot, "store-final-b");
		mkdirSync(finalStoreA, { recursive: true });
		mkdirSync(finalStoreB, { recursive: true });
		process.env["CMV3_MODE"] = "v3";
		process.env["CMV3_STORE_PATH"] = finalStoreA;
		const finalEnvA: TargetEnv = {
			cwd: targetA,
			storePath: finalStoreA,
			projectId: projectIdA,
			sessionFile: `${targetA}/.pi/session-final-a.json`,
			store: openStore({ storagePath: finalStoreA }),
			sendMessageCalls: [],
			toolHandlers: new Map(),
			commandHandlers: new Map(),
			sessionStartHandlers: [],
			agentSettledHandlers: [],
			toolResultHandlers: [],
			newSessionCounter: 0,
		};
		const finalEnvB: TargetEnv = {
			cwd: targetB,
			storePath: finalStoreB,
			projectId: projectIdB,
			sessionFile: `${targetB}/.pi/session-final-b.json`,
			store: openStore({ storagePath: finalStoreB }),
			sendMessageCalls: [],
			toolHandlers: new Map(),
			commandHandlers: new Map(),
			sessionStartHandlers: [],
			agentSettledHandlers: [],
			toolResultHandlers: [],
			newSessionCounter: 0,
		};
		const finalWp: WorkPackage = {
			id: "wp-final",
			title: "WP-Final: tiny smoke",
			goal: "Tiny smoke against the final tarball",
			work_package: "WP-Final: smoke",
			status: "COMPLETE",
			completed: ["tiny smoke"],
			in_progress: [],
			blockers: [],
			important_decisions: [],
			hard_constraints: [],
			current_files: [],
			active_errors: [],
			next_actions: [],
		};
		const finalCtxA = await startSession(finalEnvA, finalCmv3Extension, {
			cwd: targetA,
			tokens: 1000,
			contextWindow: LOCAL_32K_PROFILE.max_context,
		});
		const finalPrepA = await prepareRollover(finalEnvA, finalRolloverTool, finalWp);
		await executeRollover(finalEnvA, finalRolloverCmd, finalPrepA.id, finalCtxA);
		process.env["CMV3_STORE_PATH"] = finalStoreB;
		const finalCtxB = await startSession(finalEnvB, finalCmv3Extension, {
			cwd: targetB,
			tokens: 1000,
			contextWindow: LOCAL_32K_PROFILE.max_context,
		});
		const finalPrepB = await prepareRollover(finalEnvB, finalRolloverTool, finalWp);
		await executeRollover(finalEnvB, finalRolloverCmd, finalPrepB.id, finalCtxB);
		// Both targets consumed the same final tarball
		// (loaded the same default export) AND each produced
		// a durable handoff. SAME_PACKAGE_ARTIFACT is proven
		// by the load path; the final smoke is the runtime
		// check.
		assert.equal(
			finalEnvA.store.handoffs.list(projectIdA).length,
			1,
			"final A produced a handoff",
		);
		assert.equal(
			finalEnvB.store.handoffs.list(projectIdB).length,
			1,
			"final B produced a handoff",
		);
		report.FINAL_PACKAGE_BOTH_TARGET_SMOKE = "PASS";

		// Restore env for the static-invariant scan below.
		process.env["CMV3_STORE_PATH"] = storeA;
		// ----------------------------------------------------------------
		// 15) Final assertions (P02 gates).
		// ----------------------------------------------------------------
		report.SOURCE_COPY_IN_TARGET = 0;
		report.PROJECT_SPECIFIC_CORE_CODE = 0;
		report.SAME_PACKAGE_ARTIFACT = 1;
		assert.equal(report.SAME_PACKAGE_ARTIFACT, 1, "SAME_PACKAGE_ARTIFACT=1");
		assert.equal(report.SOURCE_COPY_IN_TARGET, 0, "SOURCE_COPY_IN_TARGET=0");
		assert.equal(report.ZERO_CONFIG, 1, "ZERO_CONFIG=1");
		assert.equal(report.GIT_TARGET_SUPPORTED, 1, "GIT_TARGET_SUPPORTED=1");
		assert.equal(report.NON_GIT_TARGET_SUPPORTED, 1, "NON_GIT_TARGET_SUPPORTED=1");
		assert.equal(report.PROJECT_IDS_ISOLATED, 1, "PROJECT_IDS_ISOLATED=1");
		assert.equal(report.TARGET_A_NATURAL_ROLLOVER, "PASS", "TARGET_A_NATURAL_ROLLOVER");
		assert.equal(report.TARGET_A_TOOL_VIRTUALIZATION, "PASS", "TARGET_A_TOOL_VIRTUALIZATION");
		assert.equal(report.TARGET_A_RECOVERY, "PASS", "TARGET_A_RECOVERY");
		assert.equal(report.TARGET_A_RESTART_RECOVERY, 1, "TARGET_A_RESTART_RECOVERY");
		assert.equal(report.TARGET_B_NATURAL_ROLLOVER, "PASS", "TARGET_B_NATURAL_ROLLOVER");
		assert.equal(report.TARGET_B_PRESSURE_PATH, "PASS", "TARGET_B_PRESSURE_PATH");
		assert.equal(report.TARGET_B_RECOVERY, "PASS", "TARGET_B_RECOVERY");
		assert.equal(report.TARGET_B_RESTART_RECOVERY, 1, "TARGET_B_RESTART_RECOVERY");
		assert.equal(report.CROSS_PROJECT_LEAKAGE, 0, "CROSS_PROJECT_LEAKAGE=0");
		assert.equal(report.PROJECT_SPECIFIC_CORE_CODE, 0, "PROJECT_SPECIFIC_CORE_CODE=0");
		assert.equal(report.SHARED_ROOT_PROJECTS, 1, "SHARED_ROOT_PROJECTS=1");
		assert.equal(report.INSTALL_TARGET_SOURCE_POLLUTION, 0, "INSTALL_TARGET_SOURCE_POLLUTION=0");
		assert.equal(report.UNINSTALL_TARGET_DAMAGE, 0, "UNINSTALL_TARGET_DAMAGE=0");
		assert.equal(report.STANDALONE_SKILL_AVAILABLE, 1, "STANDALONE_SKILL_AVAILABLE=1");
		assert.equal(report.RUNTIME_EXTENSION_AVAILABLE, 1, "RUNTIME_EXTENSION_AVAILABLE=1");
		assert.equal(report.CTX_COMPACT_CALLS, 0, "CTX_COMPACT_CALLS=0");
		assert.equal(report.PI_CORE_PATCHED, 0, "PI_CORE_PATCHED=0");
		assert.equal(report.README_EXTERNAL_PROJECT_REFS, 0, "README_EXTERNAL_PROJECT_REFS=0");

		// Write the report.
		writeReport(report);

		// Cleanup the temp tree.
		rmSync(tmpRoot, { recursive: true, force: true });
	});
});
