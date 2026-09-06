# CMV3 Portable Architecture Freeze

> WP: `CMV3-R02_PORTABLE_ARCHITECTURE_FREEZE`
> Status: **FROZEN** (architecture authority)
> Supersedes the high-level outline in `docs/ARCHITECTURE.md` for all
> implementation decisions. `docs/ARCHITECTURE.md` remains as the
> high-level public overview; this document is the binding contract.
> R01 source: `docs/research/CMV3_PORTABLE_ASSIMILATION.md`.

This document is the **canonical architecture authority** for CMV3.
Every implementation WP (S01..S04) MUST conform to the layer
ownership, contracts, and invariants declared here. The architecture
must be re-frozen (not silently amended) to change any frozen section.

## 0. Scope and authority

* CMV3 is a **portable Pi package**. It is intentionally separate from ST_BOT.
* ST_BOT is a pilot and a knowledge source. ST_BOT-specific logic MUST NOT enter portable core.
* This document is the contract. Source code, tests, and configuration MUST conform to it.
* Conflicts between this document and `docs/ARCHITECTURE.md` resolve in favor of this document until `docs/ARCHITECTURE.md` is amended to match.

## 1. Product boundary (TASK 2)

```text
CMV3
├── Portable Core
├── Pi Runtime Extension
├── Context Management Skill
└── Project Adapters
```

* **Portable Core** — pure / deterministic contracts. No Pi, no host project, no I/O outside the package's own working area.
* **Pi Runtime Extension** — Pi lifecycle, telemetry, tool-result interception, checkpoint trigger, fresh-session rollover, native-compaction fallback integration.
* **Context Management Skill** — agent-facing behavioral policy. Teaches the NEW-session-first model.
* **Project Adapters** — repository-specific discovery (repo root, branch, HEAD, dirty state, project instructions, test commands, important paths, optional WP/task metadata).

A single installed CMV3 package is expected to expose both an
extension and a skill, per the `pi-context` combined-packaging
pattern, and to be project-independent: the SAME installed package
must operate in at least two unrelated repositories (P01 ST_BOT
pilot + P02 second unrelated pilot) without copying CMV3
implementation into either repository.

## 2. Layer ownership (TASK 3)

### A. PORTABLE CORE

Owns pure / deterministic contracts:

* `ContextProfile`
* `ContextBudget`
* `ContextUsage`
* `ContextPressure`
* `Checkpoint`
* `Handoff`
* `HistoryRef`
* `ToolResultRef`
* pressure evaluation
* threshold validation
* handoff schema validation
* reference formats

Portable core **MUST NOT** know about:

* ST_BOT (any reference to ST_BOT, supervisor_v6, or any host product is a defect)
* trading
* broker
* Python application semantics
* specific repository paths
* any host product's internal naming, layout, or runtime

Portable core MAY depend on:

* language stdlib (e.g. `node:fs`, `node:path`, `node:crypto`, `node:os`)
* its own internal modules (e.g. `core/profile.ts` may import from `core/refs.ts`)

Portable core MAY NOT depend on:

* Pi extension types (no `@earendil-works/pi-coding-agent` import in core)
* host-project code
* any external network service

### B. PI RUNTIME

Owns:

* Pi lifecycle hooks
* context telemetry
* session lifecycle
* tool-result interception
* checkpoint trigger
* fresh-session rollover
* native compaction fallback integration

PI runtime MAY depend on:

* portable core
* Pi extension types (`@earendil-works/pi-coding-agent`)

PI runtime MUST NOT:

* contain project-specific logic (delegate to adapters)
* register as the **sole** owner of `session_before_compact` if a downstream consumer already has another compaction extension
* call `ctx.compact()` itself in the default path
* modify live `auto-compact.ts` `HIGH_WATER` / `LOW_WATER`

### C. SKILL

Owns agent behavioral policy:

```text
Work
→ Validate
→ Checkpoint
→ NEW
→ Minimal Handoff
→ Continue
```

The Skill instructs behavior.
The Extension supplies mechanical capability.
**Neither replaces the other.**

The Skill is plain prose (Markdown) consumed by the agent. It does not
execute code. It MAY reference tools and concepts provided by the
Extension, but its authority is behavioral guidance, not runtime
control.

### D. PROJECT ADAPTER

Owns repository-specific discovery:

* repo root
* branch
* HEAD
* dirty state
* project instructions
* test commands
* important paths
* optional WP / task metadata

Provide a **generic Git adapter** first. It MUST work on any
repository with a `.git` directory and no host-specific configuration.

A host-specific adapter (e.g. ST_BOT-specific) is **optional and
must remain separate** from the generic Git adapter. It MUST NOT
modify the generic Git adapter or portable core.

Adapters MAY depend on:

* portable core (for ref formats, schema validation)
* Pi runtime (for hook points)

Adapters MUST NOT depend on:

* other adapters (no cross-adapter coupling)
* host product code that is not inside the adapter itself

## 3. Frozen context profiles (TASK 5)

These are policy defaults, not Pi native compaction thresholds.
Physical context limit and operating target MUST remain separate
concepts. Explicit output reserve is mandatory.

### tiny

```text
max_context = 4096
target      = 2200
sweep       = 2600
checkpoint  = 2900
rollover    = 3200
emergency   = 3600
output_reserve = 512
```

### local_32k

```text
max_context = 32768
target      = 16000
sweep       = 20000
checkpoint  = 22000
rollover    = 26000
emergency   = 28672
output_reserve = 4096
```

### large / cloud

Materialize thresholds from capability using ratios. Targets are
ratios of `max_context` (or fitted cap when physical cap < requested
profile max); `output_reserve` is a ratio, capped at 4096.

```text
target_ratio       = 0.45
sweep_ratio        = 0.60
checkpoint_ratio   = 0.68
rollover_ratio     = 0.78
emergency_ratio    = 0.88
output_reserve_ratio = 0.10   (cap 4096)
```

Profile selection is **cap-driven** (no model-id map, no LLM call):

```text
max_context <= 4096        → tiny
max_context <= 32768       → local_32k
otherwise                  → large (ratio-derived)
```

When the physical cap is smaller than the requested profile's
`max_context`, a **fitted profile** MUST be derived: thresholds are
scaled down preserving ratios; `output_reserve` is preserved up to
its cap. Selection remains deterministic.

## 4. Frozen rollover model (TASK 4)

Natural rollover is the preferred path. Whole-context LLM
compaction is **not** the normal steady-state mechanism.

### Natural rollover

```text
meaningful WP / task complete
→ validation
→ durable checkpoint (status = COMPLETE)
→ minimal handoff
→ fresh session
→ next WP
```

Trigger: the agent (via the Skill) recognizes a meaningful WP / task
boundary and the work is **COMPLETE**.

### Pressure rollover

```text
WP incomplete
→ context pressure (≥ rollover threshold)
→ durable IN_PROGRESS checkpoint
→ minimal handoff
→ fresh session
→ same WP continues
```

Trigger: the agent is mid-WP and context pressure (see §5) reaches
`ROLLOVER`. The Skill instructs the agent to checkpoint, start
`NEW`, and continue the same WP from the handoff.

### Emergency fallback

```text
normal cleanup / rollover failed
→ native Pi compaction fallback
```

Trigger: natural and pressure rollover both failed or were skipped.
Native Pi compaction (`auto-compact.ts` `HIGH_WATER=110_000` /
`LOW_WATER=70_000`) is the silent emergency fallback. CMV3 MUST NOT
change those thresholds.

**Hard invariant.** Repeated whole-context compaction MUST NOT
become the normal steady-state path. If repeated emergency
compaction is observed during a pilot, that is a signal that
rollover is not firing as designed and is a portability / adoption
defect, not a tuning target.

## 5. Frozen pressure states (TASK 6)

Canonical semantic states, in order of escalation:

```text
NORMAL
TARGET_EXCEEDED
SWEEP
CHECKPOINT
ROLLOVER
EMERGENCY
```

Each transition fires at a named threshold from the active profile
(`target`, `sweep`, `checkpoint`, `rollover`, `emergency`).

| State | Threshold | What it means | What the Skill tells the agent to do |
| --- | --- | --- | --- |
| `NORMAL` | `usage < target` | Active context is within target. | Continue normal work. |
| `TARGET_EXCEEDED` | `target <= usage < sweep` | Target exceeded; tighten new work. | Prefer short tool results; defer non-essential reads. |
| `SWEEP` | `sweep <= usage < checkpoint` | Deterministic sweep should run. | Sweep low-value tool output, stale file windows, redundant diagnostics. |
| `CHECKPOINT` | `checkpoint <= usage < rollover` | A durable checkpoint is due. | Persist a checkpoint; record current WP status. |
| `ROLLOVER` | `rollover <= usage < emergency` | Fresh-session rollover is due. | Persist IN_PROGRESS checkpoint, minimal handoff, start NEW. |
| `EMERGENCY` | `usage >= emergency` | Native fallback territory. | Hold NEW; let native Pi compaction land if it fires; retry rollover on the next opportunity. |

Pressure calculation is **deterministic** and **MUST NOT** call the
LLM. It accepts only the aggregate `tokens` from `ContextUsage`
(per-category breakdown is `NOT_AVAILABLE` in Pi). Thresholds are
taken from the active profile; no runtime re-derivation except for
fitted profiles (§3).

## 6. Frozen checkpoint contract (TASK 7)

At minimum support these fields. The schema is versioned via
`schema_version`. The schema distinguishes `COMPLETE`, `IN_PROGRESS`,
`BLOCKED` via the `status` field. Not every field must be populated;
omission is a valid value (e.g. `tests: []`).

```text
schema_version          string
checkpoint_id           string
project_id              string
session_id              string
created_at              ISO-8601

goal                    string
work_package            string
status                  COMPLETE | IN_PROGRESS | BLOCKED

completed               string[]
in_progress             string[]
blockers                string[]

decisions               string[]
constraints             string[]

files_read              string[]
files_modified          string[]
relevant_versions       string[]

tests                   string[]
validation_results      string[]
active_errors           string[]

git_repository          string | null
git_branch              string | null
git_head                string | null
git_dirty               boolean | null

next_actions            string[]

recovery_refs           HistoryRef[]

handoff_summary         string
```

A checkpoint is **durable project / session state**. It is NOT an
LLM narrative summary. Validation of the schema (required fields,
enum membership, types) is portable core's responsibility.

## 7. Frozen minimal handoff contract (TASK 8)

A fresh session MUST NOT receive the entire old checkpoint blindly.
A minimal handoff is a **projection** of the checkpoint:

```text
goal
current / next WP
status
important decisions
hard constraints
current files
unresolved blockers / errors
git state
next actions
selected recovery refs
```

The following are explicitly **out** of the handoff (recoverable on
demand via `recovery_refs`):

* solved diagnostics
* complete test logs
* stale file windows
* old tool transcripts
* complete prior conversation

## 8. Frozen history / reference model (TASK 9)

Define opaque reference families. Conceptually:

```text
cmv3://tool/<id>
cmv3://checkpoint/<id>
cmv3://session/<id>
cmv3://file/<id>
```

Exact syntax may differ after evaluation; the families and the
requirements are frozen.

Requirements:

* **opaque** — ref strings are not parsed by the consumer beyond the URI scheme + kind + id
* **stable** — a given ref resolves to the same artifact for its lifetime
* **no secret payload in identifier** — the id is not derived from secrets, raw commands, cwd, API keys, or payload contents
* **recoverable** — the URI resolves to a durable artifact, or raises
* **versioned** — schema / format version is recoverable from the artifact
* **integrity-verifiable** where appropriate — the artifact carries a SHA-256 over its content; mismatch raises

Semantic search is explicitly **NOT** in MVP. SQLite FTS5 is a
candidate for a later index layer but is not required for MVP and
must not become mandatory merely for MVP.

## 9. Frozen tool-result lifecycle (TASK 10)

Canonical rule:

```text
full tool result
→ durable persistence
→ integrity verification / reference
→ bounded active representation
→ recover on demand
```

**Hard invariant.** The portable package MUST NOT destroy the only
copy of a tool result before persistence succeeds. On persistence
failure, the caller MUST receive an error; recovery to legacy mode
is a valid response.

**Supersedes** the R01-era assumption that durable tool-result
virtualization belongs inside any host project's supervisor package.
The implementation belongs to the **portable Pi runtime
infrastructure**, not to any one host project.

## 10. Frozen storage model (TASK 11)

Define conceptual storage categories:

```text
session
checkpoint
tool-results
history / index
project metadata
```

Requirements:

* local-first
* outside the target Git repo by default
* no secrets in filenames
* safe permissions (no world-readable files containing project state)
* atomic writes where appropriate (temp file + flush + rename)
* schema-versioned artifacts
* recoverable without LLM

PostgreSQL is explicitly excluded. SQLite MAY be evaluated for
indexes later but MUST NOT become mandatory merely for MVP; the
default storage is the filesystem.

## 11. Frozen configuration (TASK 12)

Evaluate one optional configuration surface. Preferred concept:

```text
.cmv3.json
or
.pi/cmv3.json
```

But **zero-config generic Git operation is required**. A repository
with `.git` present and no configuration file MUST be operable with
sane defaults.

Configuration MAY override:

* active profile (`tiny` | `local_32k` | `large`)
* rollover policy
* project adapter selection
* storage path
* feature flags

Invalid configuration MUST fail safely. Defaults MUST be applied
for unrecognized keys; missing required keys are not a failure when
zero-config operation is possible.

## 12. Frozen modes / rollback (TASK 13)

Require:

```text
legacy     — no CMV3 behavioral takeover
v3-observe — calculate / record decisions but do not execute rollover
v3         — full CMV3 behavior (when later implemented)
```

The `v3` mode is gated; the package is shipped with `legacy` as
default and `v3-observe` as the only enabled opt-in. The full `v3`
mode becomes available only after S01..S04 land.

Native Pi compaction MUST remain available as the emergency
fallback in every mode. Rollback to `legacy` MUST NOT require
deleting user history.

## 13. Package shape (TASK 14)

Frozen package shape:

```text
src/
  core/
  pi/
  adapters/

skills/
  context-management/
    SKILL.md
    references/

docs/

tests/

package.json
```

A single Pi package MUST be capable of exposing both:

* extensions
* skills

The `package.json` `pi` field declares both, per the
`ttttmr/pi-context` combined-packaging pattern.

Do not implement the full extension yet. A no-op extension
entrypoint is allowed only if needed to validate package structure
(in `CMV3-S01_PORTABLE_PACKAGE_SKELETON`).

## 14. Acceptance strategy (TASK 15)

```text
P01 — ST_BOT pilot
P02 — second unrelated repository pilot
```

Portable PASS requires the **SAME installed CMV3 package** to
operate in both pilots without copying CMV3 implementation into
either project.

Primary KPI:

```text
long-running task continuity with small active context
and recoverable durable state
```

Secondary measurements (deferred to P01 / P02):

```text
median active context
p95 active context
rollover count
compaction count
compaction duration
checkpoint recovery success
tool-result recovery success
task continuity
duplicate context reduction
```

The primary KPI is NOT "maximum context compressed".

## 15. Validation answers

The architecture explicitly answers:

1. **What is portable core?**
   Pure / deterministic contracts: `ContextProfile`, `ContextBudget`,
   `ContextUsage`, `ContextPressure`, `Checkpoint`, `Handoff`,
   `HistoryRef`, `ToolResultRef`, pressure evaluation, threshold
   validation, handoff schema validation, reference formats. No Pi, no
   host project, no I/O outside the package's own working area.

2. **What belongs to Pi runtime?**
   Pi lifecycle hooks, context telemetry, session lifecycle,
   tool-result interception, checkpoint trigger, fresh-session
   rollover, native-compaction fallback integration.

3. **What belongs to Skill?**
   Agent behavioral policy. `Work → Validate → Checkpoint → NEW →
   Minimal Handoff → Continue`. The Skill instructs behavior; the
   Extension supplies mechanical capability.

4. **What belongs to adapters?**
   Repository-specific discovery: repo root, branch, HEAD, dirty
   state, project instructions, test commands, important paths,
   optional WP / task metadata. Generic Git adapter first.

5. **What triggers natural rollover?**
   A meaningful WP / task is COMPLETE. The agent validates,
   persists a durable checkpoint, builds a minimal handoff, starts
   NEW, and continues with the next WP.

6. **What triggers pressure rollover?**
   The agent is mid-WP and context pressure reaches `ROLLOVER`. The
   agent persists an `IN_PROGRESS` checkpoint, builds a minimal
   handoff, starts NEW, and continues the same WP.

7. **What survives NEW?**
   Only the minimal handoff: goal, current / next WP, status,
   important decisions, hard constraints, current files, unresolved
   blockers / errors, git state, next actions, selected recovery
   refs. Everything else is recoverable on demand via `recovery_refs`.

8. **What is retrieved on demand?**
   Anything addressed by a `HistoryRef`: full tool results, prior
   checkpoints, prior sessions, full file content. The agent uses
   the recovery tool, not eager restoration.

9. **What is emergency fallback?**
   Native Pi compaction (`auto-compact.ts` `HIGH_WATER=110_000` /
   `LOW_WATER=70_000`). CMV3 MUST NOT change those thresholds.

10. **How is tool output recoverable?**
    Full tool result → durable persistence → integrity verification
    / reference (`cmv3://tool/<id>`) → bounded active representation
    in context → recover on demand via the ref. The only copy is
    never destroyed before persistence succeeds.

11. **How is output reserve protected?**
    `output_reserve` is part of every profile. It is a documented
    configurable policy, never silently dropped. The large/cloud
    profile computes it as `0.10 * max_context`, capped at 4096.

12. **How does zero-config operation work?**
    A repository with `.git` present and no `.cmv3.json` /
    `.pi/cmv3.json` is operable with sane defaults. Configuration
    MAY override; it is never required.

13. **How does rollback work?**
    `legacy` mode disables CMV3 behavioral takeover while preserving
    the durable state on disk. Native Pi compaction remains
    available. Switching mode does not delete history.

14. **How do we prove portability?**
    P01 (ST_BOT pilot) + P02 (second unrelated pilot) install the
    SAME package and operate it without copying CMV3 implementation
    into either project. PASS requires both pilots to demonstrate
    long-running task continuity with small active context and
    recoverable durable state.

## 16. What this WP does NOT do (explicit non-goals)

* does not implement fresh rollover yet
* does not intercept live tool output yet
* does not implement persistent history runtime
* does not change Pi `HIGH=110_000` / `LOW=70_000`
* does not modify `auto-compact.ts`
* does not modify `pi-cmv3-telemetry.ts`
* does not touch ST_BOT production code
* does not touch TMF_BOT
* does not copy unlicensed source code
* does not add trading-specific contracts
* does not make cloud context mandatory

## 17. Change-control rule

To change any frozen section (§1..§15), the change MUST be made in
a new WP that:

1. cites the exact section(s) being changed;
2. records the alternative considered;
3. re-validates the 14 questions in §15 against the new contract;
4. does not silently edit this document.

`docs/ARCHITECTURE.md` is a public overview; this document is the
contract. Where they diverge, this document wins until
`docs/ARCHITECTURE.md` is amended to match.
