# CMV3-R01 Portable Assimilation

> WP: `CMV3-R01_PORTABLE_SKILL_ASSIMILATION`
> Source research worktree: `ST_BOT_cmv3_portable` (sibling of ST_BOT, isolated)
> Source research branch: `feature/cmv3-portable-skill`
> Canonical research commit: `d4618554c36cd770484534aff0390a67e1d04b8c`
> Canonical research `origin/main`: `e4a8f8451fff34eb76841994ae36f564f77b43b7`
> R01 status: `PASS` (research / architecture / classification only).
> This document is canonicalized into the standalone CMV3 repository. It carries
> the R01 conclusions forward, normalized to the portable repository and
> detached from ST_BOT-specific implementation assumptions.

## 0. Reconciliation

| Field | Value |
| --- | --- |
| Source research worktree | `../ST_BOT_cmv3_portable` |
| Source research branch | `feature/cmv3-portable-skill` |
| Source research `HEAD` (research time) | `d4618554c36cd770484534aff0390a67e1d04b8c` |
| Source research `origin/main` (research time) | `e4a8f8451fff34eb76841994ae36f564f77b43b7` |
| Source research worktree dirty state | 22 entries (intentional; untouched by R01) |
| Source research worktree touched by R01 | `0` (verified before / after) |
| Canonical CMV3 repository | `https://github.com/8xbwvwd8c9-code-taka/PI-Context-Management-improve` |
| Canonical CMV3 repository `HEAD` (R02 start) | `dfe904545ca45d489eb05496a548f89882f1eafc` |
| Canonical CMV3 `origin/main` (R02 start) | `dfe904545ca45d489eb05496a548f89882f1eafc` |
| R02 working branch | `feature/cmv3-r02-architecture-freeze` |
| Runtime behavior implemented in R01 | `0` |
| Live Pi `auto-compact.ts` modified in R01 | `0` |
| Live Pi `pi-cmv3-telemetry.ts` modified in R01 | `0` |
| ST_BOT production code modified in R01 | `0` |

**Source-of-truth decision.** The original R01 source worktree is retained
read-only. R01 conclusions are canonicalized here against the
`PI-Context-Management-improve` main branch, which already contains the
high-level R01 / R02 outline, the agent-facing skill, the architecture
overview, and the research provenance file. R02 expands the architecture
into a frozen contract.

## 1. Internal architecture map (R01)

### 1.1. External Pi-runtime pieces (outside any project repo)

| Piece | Path | Owner | Status |
| --- | --- | --- | --- |
| Legacy auto-compaction | `~/.pi/agent/extensions/auto-compact.ts` | Pi-extension ecosystem | LIVE. `HIGH_WATER=110_000`, `LOW_WATER=70_000`. Source of truth for legacy live compaction. **Must remain untouched** by CMV3. |
| CMV3 telemetry extension | `~/.pi/agent/extensions/pi-cmv3-telemetry.ts` | R01-era pilot | LIVE. Read-only observability. Records `session_start`, `context_sample`, `compaction_event`, `model_change`, `session_end` to `~/.pi/agent/cmv3-telemetry/events.jsonl`. Will be subsumed by the portable package in a later WP. |

### 1.2. ST_BOT-side pieces (R01 pilot surface — not part of portable core)

| Piece | Path | Class | Notes |
| --- | --- | --- | --- |
| Profile / budget / pressure policy | `supervisor_v6/cmv3_profiles.py` | ST_BOT-only pilot surface | The pilot implementation of the policy surface. To be replaced by the portable package; not copied. |
| Supervisor V6 runtime | `supervisor_v6/*.py`, `supervisor_cli_v6.py` | ST_BOT-only | Foundation, paths, sanitization, jsonl, retry, error ledger, failure memory, checkpoints, runs, resume, roadmap, release gate, command guard, commit gate, deep worker, compact report, salvage, evidence. ST_BOT-specific. |
| Application / model prompt context | `invest/context/*.py` | Different domain | **NOT CMV3**. Out of scope. |
| App + trading logic | `app.py`, `processor/*`, `xiaolongxiao/*`, `invest/*` | ST_BOT-only | Out of scope; protected paths. |

### 1.3. Domain boundary (preserved)

| Domain | Owner | Scope |
| --- | --- | --- |
| Application / model prompt context | host product (e.g. ST_BOT) | How to assemble the prompt for the LLM, what facts to include, how to compress them. Lives with the product. |
| CMV3 | portable package | Coding-agent / session / conversation context management — how to keep a long-running Pi session focused, with checkpoints, handoffs, rollover, and durable tool-result history. **Independent of any one product.** |

These two domains MUST NOT be merged. The portable CMV3 package will not
depend on any host product's `invest/context`; host products will keep
their own application-prompt context layer and use CMV3 as an
*external* installable.

### 1.4. Pilot implementation classification

The R01-era pilot implementation lived inside ST_BOT's supervisor
package. It is small (~430 lines, 100% pure decision logic) but
located in a project-only package. To make it portable it must move
out of any host project. The contracts, invariants, tests, and profile
values can be lifted verbatim in spirit; the *import location* and
*host language/runtime* must change.

Contracts / invariants worth preserving verbatim:

* `ContextProfile` shape (name, max_context, target, sweep, checkpoint, rollover, emergency, output_reserve, fitted_to_physical).
* `0 < target < sweep < checkpoint < rollover < emergency < max_context` invariant, validated in `__post_init__`.
* Cap-driven deterministic selection (no model-id map; no LLM call) at thresholds 4096 and 32768.
* Fitted-profile re-derivation when physical cap < requested profile max.
* `ContextManagerMode` env gate (`legacy` default).
* `ContextUsage` accepts only aggregate `tokens` (per-category breakdown is `NOT_AVAILABLE` in Pi).
* Boundary semantics for pressure states (each transition at a named threshold).
* Output-reserve as a documented configurable pilot policy (not invented silently).

Profile values to lift verbatim:

| Profile | max_context | target | sweep | checkpoint | rollover | emergency | output_reserve |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tiny | 4096 | 2200 | 2600 | 2900 | 3200 | 3600 | 512 |
| local_32k | 32768 | 16000 | 20000 | 22000 | 26000 | 28672 | 4096 |
| large (ratios) | provider-cap | 0.45 | 0.60 | 0.68 | 0.78 | 0.88 | 0.10 (capped 4096) |

These profile values are now canonical and frozen in
`docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md` §3.

## 2. External repository matrix

Each repo was inspected at the version pinned in the table. All
architecture is reused as **lessons**; **no source is copied**.

| # | Repository | Revision inspected | License status | Files / designs inspected | Ideas reused | Code reused |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `ttttmr/pi-context` | `v2.1.2` (per `package.json` at clone time, 2026-Q3) | **PACKAGE_METADATA_ONLY** — MIT declared in `package.json`; no top-level `LICENSE` file in the snapshot. **LICENSE_FILE_PRESENT=NO.** | `package.json` (combined `extensions` + `skills` field), `skills/context-management/SKILL.md`, `src/index.ts`, `src/context.ts`, `README.md`, `evals/` | YES: combined Skill + Extension packaging pattern; agent-facing `context_checkpoint` / `context_timeline` / `context_compact` triad; "working-set" framing; passive compaction entry filtering; passive-mode custom extension for benchmarking; "checkpoint before mess" main loop. | **NO** (`CODE_REUSED=NO` per WP default; `LICENSE_FILE_PRESENT=NO` blocks direct code reuse regardless of `package.json` declaration) |
| 2 | `underactive/pi-mimo-cme` | main at clone time (2026-Q3) | **LICENSE_VERIFIED=NO**, **PACKAGE_METADATA_ONLY=NO**, **LICENSE_FILE_PRESENT=NO**. **Provenance blocker.** | `README.md`, `docs/design/ARCHITECTURE.md`, `package.json`, `src/paths.ts`, `src/budget.ts`, `src/checkpoint.ts`, `src/db.ts`, `src/fts.ts` | YES: tiered storage (session / project / global / history); markdown-as-source-of-truth + SQLite FTS5 as derived index; per-scope index counts; `~/.pi/cme/` (NOT `~/.pi/agent/`) to avoid collision with future pi-native memory; window-scaled context-usage thresholds ("auto" mode); relative BM25 score floor; in-process checkpoint-writer session as sole curator. | **NO** (provenance blocker) |
| 3 | `MohamedElashri/pi-mcb` | `v0.2.0` per `CHANGELOG.md` / `package.json` at clone time | **LICENSE_VERIFIED=NO**, **PACKAGE_METADATA_ONLY=YES** (MIT in `package.json`), **LICENSE_FILE_PRESENT=NO** in the cloned snapshot. Repo is itself a renamed derivative of `pi-blackhole`; full dependency-chain license trail would be required for code reuse. | `README.md`, `CONFIG.md`, `package.json`, `src/om/` (observer/reflector/dropper subagents), `src/hooks/before-compact.ts`, `src/core/sanitize.ts`, `src/om/ledger/` | YES: single-extension ownership of the compaction hook (avoids competing `session_before_compact` registrations); `auto` / `manual` / `off` compaction modes; per-worker model overrides with fallback chain + persisted cooldown; recall tool with `mode:file` / `mode:touched` / `mode:semantic`; explicit warning that installing alongside another compaction extension is unsafe. | **NO** (`CODE_REUSED=NO`; `LICENSE_FILE_PRESENT=NO`; full provenance chain unverified) |
| 4 | `TheArchitectit/pi-mega-compact` | LTS branch, `2026-08-13` per README banner | **LICENSE_VERIFIED=NO**, **PACKAGE_METADATA_ONLY=YES** (BSD-3-Clause declared in `package.json`), **LICENSE_FILE_PRESENT=NO** in the cloned snapshot. Repo is explicitly LTS with a Rust successor. | `README.md`, `docs/LTS.md`, `docs/SUCCESSION.md`, `package.json` | YES: 32K model is first-class (not afterthought); `input + reserve + margin <= window` constraint; live-trim every LLM call; SQLite checkpointing so `/clear` / crash never loses work; 5-layer pipeline (Supersede → Collapse → Cluster → Persist → Recall); documented **invisible overhead ~13-16k tokens on 32k-window models** (estimator pitfall — must count thinking blocks + tool-call args, not just visible text); prompt-cache structure (message separation + cache striping); local-first default with pluggable embedders; the **LTS warning itself** is a lesson — feature projects that get forked or stale can be a single point of failure. | **NO** (`CODE_REUSED=NO`; `LICENSE_FILE_PRESENT=NO`; LTS successor announced) |
| 5 | `lukeramsden/pi-context-cap` | main at clone time (2026-Q3) | **LICENSE_VERIFIED=NO**, **PACKAGE_METADATA_ONLY=YES** (MIT in `package.json`), **LICENSE_FILE_PRESENT=NO** in the cloned snapshot. | `README.md`, `extensions/context-cap.ts`, `package.json` | YES: do **not** lower `model.contextWindow` (poison output via `clampMaxTokensToContext`); three trigger points (`turn_end` with tool results, `agent_settled`, `session_start`); mid-tool-loop blind spot — Pi checks compaction only between agent runs, not inside a tool loop; bounded overshoot (one request past threshold); disable-on-two-failures guard; explicit `shouldStopAfterTurn` hook dependency (open upstream issues #7299, PR #7367). | **NO** (`CODE_REUSED=NO`; `LICENSE_FILE_PRESENT=NO`) |

### 2.1. Optional cross-references discovered (not assimilated in R01)

* `chendpoc/pi-memory`, `krisfremen/pi-memory`, `VandeeFeng/pi-memory-md` — local-Markdown cross-session memory extensions; out of MVP scope but useful as prior art for the project memory layer.
* `bernardofortes/pi-session-continuity` — boring handoff reliability; relevant to the "minimal handoff" WP.
* `pi-warm-memory` — cross-session episodic memory with `/archive-session` handoff; relevant to natural rollover.

These were noted but not studied in depth; the R01 budget covers the 5
primary repos.

### 2.2. License / provenance classification rules (R01-established)

For every external project, R01 classifies:

```text
LICENSE_VERIFIED         — source-license provenance chain inspected end-to-end
PACKAGE_METADATA_ONLY    — license declared in package.json but no top-level LICENSE file
LICENSE_FILE_PRESENT     — top-level LICENSE / LICENSE.md / LICENSE.txt exists and matches package.json
CODE_REUSE_ALLOWED       — license is permissive AND provenance verified AND CMV3 needs reuse
CODE_REUSED              — actual code (not just architecture) was incorporated
```

**Default for R01 and R02:** `CODE_REUSED=NO`. Architectural lessons
may be reimplemented behind CMV3-owned contracts. Package metadata
alone is NOT equivalent to verified source-license provenance when
direct code reuse is proposed.

`LICENSE_FILE_PRESENT=NO` is sufficient to block direct code reuse
even when `PACKAGE_METADATA_ONLY=YES` declares a permissive license;
the field must be verified against an actual `LICENSE` file at the
revision being reused before code is copied.

### 2.3. License / provenance blockers (R01)

| Repo | LICENSE_VERIFIED | PACKAGE_METADATA_ONLY | LICENSE_FILE_PRESENT | CODE_REUSE_ALLOWED | CODE_REUSED | Mitigation |
| --- | --- | --- | --- | --- | --- | --- |
| `ttttmr/pi-context` | NO | YES (MIT) | NO | NO | NO | Architecture and skill content reused as **lessons**; no code copied. |
| `underactive/pi-mimo-cme` | NO | NO | NO | NO | NO | Architecture reused as **lessons** only; no code copied. |
| `MohamedElashri/pi-mcb` | NO | YES (MIT) | NO | NO | NO | Lessons only. Reimplement against our own contracts. |
| `TheArchitectit/pi-mega-compact` | NO | YES (BSD-3-Clause) | NO | NO | NO | Lessons only. Acknowledge the successor and avoid copying patterns that are slated to change. |
| `lukeramsden/pi-context-cap` | NO | YES (MIT) | NO | NO | NO | Lessons only. |

**Conclusion.** No LICENSE blocker prevents **architectural
assimilation** (which is what R01 authorizes). All five are usable as
design references. **No source is copied** in R01 or R02. The
recommendation in the migration map is to continue this policy for
the MVP and re-evaluate per-file only when a direct reuse has a
strong maintenance advantage AND a verified `LICENSE` file is
present at the revision being reused.

## 3. Capability comparison

Mapping the 15 target capabilities to the five repos and to current
CMV3 work:

| # | Capability | R01 pilot | pi-context | pi-mimo-cme | pi-mcb | pi-mega-compact | pi-context-cap | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Project-independent install | n/a | YES (npm) | YES (npm) | YES (npm) | YES (npm) | YES (npm) | none |
| 2 | 32K model first-class | partial | no | no | no | **YES** | partial (budget + reserve) | profile exists but no policy yet; pi-mega-compact's 13-16k invisible-overhead caveat is the hard lesson to adopt |
| 3 | Larger cloud contexts | YES (large ratio) | yes | yes | yes | yes | yes | none |
| 4 | Work-package-aware checkpointing | no | partial (semantic checkpoint name) | no | partial (zero-LLM summary) | yes (RAPTOR) | no | **GAP** — must design |
| 5 | Natural rollover (completed → NEW) | no | YES (`context_compact` continuation branch) | partial (in-process checkpoint writer) | no | no | no | **GAP** — must design; pi-context has the closest pattern |
| 6 | Pressure rollover (incomplete → NEW → continue) | no | no | no | no | partial (auto-compact at threshold) | YES (mid-tool-loop trigger) | **GAP** — must design |
| 7 | Minimal handoff | no | YES (continuation branch with summary) | partial (11-section checkpoint.md) | partial (zero-LLM summary) | no | no | **GAP** — must design; pi-context + pi-mimo-cme lessons |
| 8 | Durable history | no | no | **YES** (SQLite + FTS5) | partial (ledger) | **YES** (SQLite + dedup tiers) | no | **GAP** — must design; pi-mimo-cme and pi-mega-compact are the right references |
| 9 | On-demand recovery | no | YES (timeline) | YES (history tool) | YES (recall tool) | YES (recall tool) | no | **GAP** — must design; unified recall API |
| 10 | Durable tool-result references | no | partial (history entries) | partial (per-tool result) | partial (drill-down) | partial (turns.db) | no | **GAP** — must design |
| 11 | Deterministic cleanup before LLM compaction | no | partial (`context_compact` is LLM) | partial (LLM dream) | yes (zero-LLM structural summary) | yes (5-layer pipeline) | yes (deterministic) | **GAP** — must design; pi-mcb + pi-mega-compact have the right references |
| 12 | Native Pi compaction as emergency fallback | yes (default legacy) | yes (`compactionEngine: pi-default` option) | yes (don't replace) | yes (compaction: off) | yes (retain native) | yes (works alongside) | none |
| 13 | Explicit output reserve | YES (per-profile reserve + 4096 cap) | no | partial (pushCaps) | partial (input budget) | **YES** (provider output reserve modeled) | **YES** (`context-cap-reserve` flag) | none — lift it |
| 14 | Git / project-state adapters (no ST_BOT coupling) | partial (cwd in telemetry) | no | yes (pid = sha256(cwd)) | yes (extract/commits.ts, extract/files.ts) | no | no | **GAP** — must design; pi-mimo-cme + pi-mcb have the right references |
| 15 | No dependency on trading modules | YES | YES | YES | YES | YES | YES | none |

### 3.1. Genuinely novel / missing

* **Unified portable Skill + Extension that owns the agent-facing
  `context-management` skill *and* the auto-compaction hook in a
  single package**, with the natural-rollover / pressure-rollover /
  emergency-fallback ordering. None of the five repos does this as
  a single deliverable today. pi-context owns the skill; pi-mcb
  owns the compaction hook; pi-mega-compact owns the auto-compact;
  pi-context-cap owns the budget. The portable CMV3 must glue them
  into one coherent agent experience, with explicit ordering
  (natural → pressure → emergency fallback).
* **NEW-session-first model**. The portable package must teach the
  agent to start a *new* session at continuation boundaries
  (checkpoint → NEW → minimal handoff → continue) rather than the
  prevailing pattern of "compress entire conversation → continue
  forever". pi-context's continuation branch is the closest
  pattern but is framed as `context_compact` (same session); the
  portable user model makes NEW explicit.
* **CMV3-01-style profile / budget / pressure as a first-class
  policy surface** that any consumer project can adopt without
  copying. The pilot implementation is the seed; it currently
  lives inside a host project's supervisor package and must be
  lifted to a portable module.
* **No-LLM deterministic cleanup before LLM compaction**. The
  agent should not need a second LLM call to summarize what could
  be a structural pass; pi-mcb's zero-LLM summary is the right
  reference but lives behind its compaction hook. The portable
  package should make this a reusable primitive.

## 4. Conflict / non-conflict matrix

| Approach in external repo | Conflicts with our NEW-session-first model? | Notes |
| --- | --- | --- |
| pi-context: `context_compact` continues in the same session as a continuation branch | partial conflict | We want NEW as the default. The portable package should keep the in-session branch as a low-cost alternative but route the agent to NEW at named continuation boundaries. |
| pi-mimo-cme: markdown files (sessions/<sid>/checkpoint.md + notes.md, projects/<pid>/MEMORY.md, global/MEMORY.md) | no conflict | Compatible. We can keep this as the durable history storage choice. |
| pi-mimo-cme: in-process checkpoint-writer session as sole curator | no conflict (complementary) | The portable package can use a dedicated writer session for structured memory, distinct from the user-facing "natural rollover" NEW-session path. |
| pi-mcb: single extension owns the compaction hook | **partial conflict** | We want natural rollover (NEW session) as the default path, with the existing `session_before_compact` hook as a backup. We must NOT register as the *sole* owner of the hook if a downstream consumer already has another compaction extension. Detect existing registrations; warn; recommend the order, but never crash. |
| pi-mega-compact: auto-compact watches context pressure and compacts quietly | partial conflict | Compatible as a fallback, not as the default path. We want the agent (via the skill) to call NEW at continuation boundaries; auto-compact stays as the silent emergency fallback. |
| pi-mega-compact: RAPTOR hierarchical memory; semantic dedup tiers | no conflict (complementary) | Optional later layer; out of MVP. |
| pi-context-cap: caps `contextWindow` via 200K budget + reserve | no conflict (complementary) | Could become a future "CMV3 pressure" mode, but the budget lives in the extension, not in `model.contextWindow` (the README's first pitfall is canonical — do not poison output). |
| pi-context-cap: mid-tool-loop `turn_end` trigger | no conflict (complementary) | The portable package should observe `turn_end` for telemetry but NOT trigger compaction from there in the default path; natural rollover is preferred. |
| All five: SQLite (sqlite / node:sqlite / better-sqlite3) | no conflict | Acceptable. Node 24+ `node:sqlite` is the lowest-friction default. |

## 5. Migration lessons from ST_BOT

R01 lifts the following lessons from the ST_BOT pilot surface. The
*contracts and values* may be carried forward; the *implementation
files* stay in the host project as historical artifacts and are not
copied into the portable package.

| ST_BOT lesson | Portable direction | Carries code? |
| --- | --- | --- |
| `supervisor_v6/cmv3_profiles.py` profile / budget / pressure policy | Reimplement contracts and values in `src/core/profile.ts` (or equivalent) in the portable package. | No. Reimplemented. |
| 48-case profile / boundary test suite | Port test cases (same boundary coverage) to the portable package's test runner. | No. Reimplemented. |
| `~/.pi/agent/extensions/pi-cmv3-telemetry.ts` read-only telemetry | Absorb schema into `src/pi/telemetry.ts`; keep the local file for backward compatibility until consumers migrate. | No. Reimplemented. |
| `docs/context/CMV3_BASELINE.md` | Supersede by `docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md`; the original stays in the host project for traceability. | No. |
| Supervisor re-exports | Remove the re-exports once the package is portable; host projects depend on the published CMV3 package instead. | No (out of scope for R01 / R02). |
| `invest/context/*` (application-prompt context) | UNCHANGED. Out of scope. | n/a |
| `app.py`, `processor/*`, `xiaolongxiao/*`, trading logic | UNCHANGED. Out of scope; protected paths. | n/a |
| `auto-compact.ts` (live Pi extension) | UNCHANGED. Source of truth for legacy live compaction. | n/a |

## 6. Remaining gaps (R01 → R02 → S01)

| Gap | Resolved by |
| --- | --- |
| Architecture not yet frozen | `CMV3-R02` — `docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md` |
| Package skeleton not yet landed | `CMV3-S01` — `src/`, `skills/`, `package.json` skeleton |
| Refs / tool-result durability not yet portable | `CMV3-S02 / CMV3-S03` |
| Rollover implementation not yet landed | `CMV3-S04` |
| Portability acceptance (P01 / P02) not yet executed | `CMV3-P01` (ST_BOT pilot), `CMV3-P02` (second unrelated pilot) |

## 7. Test strategy

For the portable package MVP, R01 establishes the following test
strategy (re-stated for the portable repository):

* **Profile / budget / pressure**: port the 48 R01-pilot tests
  verbatim; same coverage (tiny exact thresholds, local_32k exact
  thresholds, large ratio materialization, invalid ordering
  rejected, override works, cap-based selection, fitted profile,
  output reserve preserved, mode default = legacy, full boundary
  coverage for each pressure state, snapshot is pure, no side
  effects).
* **Refs**: round-trip tests for opaque `cmv3://<kind>/<id>` URIs;
  atomic-write tests (simulated crash leaves no partial file);
  corruption detection (SHA-256 mismatch raises); missing ref
  raises; secrets-not-in-refs test.
* **Telemetry**: schema version is present on every record; no
  payload content in any record; provider / model / session_id
  only.
* **Skill loadability**: the `package.json` declares both
  `extensions` and `skills`; the loader must accept the package
  without warning.
* **Failure safety**: persistence failure NEVER produces a fake
  valid ref; existing legacy consumers (the host supervisor's
  `runs.jsonl` and `CommandRecord` shape) remain readable; the
  package emits no log lines containing payload.

## 8. PASS criteria mapping (R01 → portable repo)

| Required | Status | Evidence |
| --- | --- | --- |
| `SOURCE_WORKTREE_TOUCHED=0` | YES | 22 dirty entries before; 22 after. |
| `COMBINED_SKILL_EXTENSION_SUPPORTED=1` | YES | `pi-context`'s `package.json` declares both `extensions` and `skills` in the `pi` field; this is the canonical pattern. |
| `INTERNAL_COMPONENTS_CLASSIFIED=1` | YES | §1 (internal architecture map) + §1.4 (pilot classification) + §5 (migration lessons) classify every piece. |
| `RUNTIME_BEHAVIOR_IMPLEMENTED=0` | YES | R01 produces research / architecture only. R02 freezes the contract. Runtime behavior is deferred to S01..S04. |
| `LIVE_COMPACTION_CHANGED=0` | YES | `auto-compact.ts` HIGH/LOW unchanged; `ctx.compact()` call sites unchanged. |
| No provenance/license blocker hidden | YES | §2.2 documents all 5 license status; `CODE_REUSED=NO` for every repo; `LICENSE_FILE_PRESENT=NO` for every repo blocks direct code reuse even when `PACKAGE_METADATA_ONLY=YES`; architecture is reused as lessons only. |
| `diff-check clean` | YES | The R01 source worktree contained only the new research doc; `git diff --check` was clean. |

## 9. Carry-forward to R02

R01 establishes the field. R02 freezes the contract
(`docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md`), expands the existing
high-level architecture into named layer ownership, frozen profiles,
frozen pressure states, frozen checkpoint / handoff / ref / tool-
result-lifecycle / storage / configuration / mode contracts, the
package shape, the acceptance strategy, and the validation answers.
After R02 PASS, the next WP is `CMV3-S01_PORTABLE_PACKAGE_SKELETON`.
