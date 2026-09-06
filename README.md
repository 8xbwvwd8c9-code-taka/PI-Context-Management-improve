# PI Context Management Improve (CMV3)

Portable, local-first context management for long-running Pi agents.

Core operating model:

```text
Work
→ Checkpoint
→ NEW
→ Minimal Handoff
→ Continue
```

CMV3 treats active context as temporary working memory and durable
project state as external, recoverable storage.

## Status

**S02 — durable checkpoint / handoff / history**

This package is currently in development. It is **not published**
to npm. It is intended to be installed from this repository once
the runtime behavior lands in S04.

S02 adds a local-first filesystem store with:

- durable checkpoints (R02 §6)
- durable minimal handoffs (R02 §7)
- session records (S02)
- project metadata
- deterministic history index (rebuildable)
- deterministic recovery (no LLM, fail-safe)

S02 does NOT yet:

- intercept tool results (S03)
- automatically trigger checkpoints from Pi lifecycle (S04)
- create a new Pi session (S04)
- execute rollover (S04)
- replace native Pi compaction

Initial goals:

- portable Pi Skill + Extension package ✅ (S01)
- local 32K models as a first-class runtime ✅ (S01 profiles)
- durable checkpoint / handoff / session persistence ✅ (S02)
- deterministic recovery without LLM ✅ (S02)
- natural rollover at work-package boundaries (S04)
- pressure rollover for long unfinished work (S04)
- tool-result virtualization (S03)
- deterministic cleanup before LLM compaction (S03)
- native Pi compaction retained as emergency fallback (always)

## Installation

**Not yet published.** S01 is a local-development skeleton.

When the package is published, the expected install command is:

```text
pi install npm:pi-context-management-improve
```

For now, you can point Pi at the local checkout:

```text
pi -e /path/to/PI-Context-Management-improve
```

Or copy the package under `~/.pi/agent/npm/` and add it to your
`settings.json` `packages` list.

## Architecture

```text
CMV3
├── Portable Core        (src/core/)
├── Pi Runtime Extension (src/pi/)
├── Project Adapters     (src/adapters/)
├── Durable Store        (src/store/)  ← S02
└── Skill                (skills/context-management/)
```

The Portable Core is pure / deterministic. No Pi, no host project,
no I/O outside the package's own working area.

The Pi Runtime Extension hosts lifecycle hooks, telemetry,
tool-result interception, checkpoint trigger, and fresh-session
rollover. In S02, the extension is still a no-op entrypoint.

The Durable Store (S02) is a local-first filesystem library. It
lives outside the target Git repo by default and is responsible
for atomic writes, integrity verification, and deterministic
recovery. It does NOT wire into the live Pi lifecycle.

The Skill is the agent-facing behavioral policy.

Project Adapters are pure discovery. The Generic adapter works on
any directory; the Git adapter is a thin wrapper that fills in
Git fields when `.git` is present.

## 32K local-first design

`local_32k` is a first-class profile, not an afterthought.

```text
max_context  32768
target       16000
sweep        20000
checkpoint   22000
rollover     26000
emergency    28672
output_reserve 4096
```

`max_context` and operating `target` are separate concepts.
Output reserve is explicit. Thresholds are frozen — see
`src/core/profiles.ts`.

The frozen profile values are also documented in
`docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md` §3.

## Modes

```text
legacy      — no CMV3 behavioral takeover  (default)
v3-observe  — calculate / record decisions but do not execute rollover
v3          — full CMV3 behavior (S04+)
```

Switch modes via `.cmv3.json` (or `.pi/cmv3.json`):

```json
{
  "mode": "v3-observe"
}
```

Invalid modes fail safely. Missing config is OK; sane defaults apply.

## Development

```text
npm install
npm run typecheck
npm test
npm run build
npm run package:check
```

## Non-goals (S01)

- no live context inspection
- no tool interception
- no checkpoint persistence
- no rollover
- no native-compaction calls
- no live Pi config changes
- no npm publish

## Roadmap

| WP | Status | Goal |
| --- | --- | --- |
| R01 — research / provenance | ✅ | External repository assimilation + license classification |
| R02 — architecture freeze | ✅ | Frozen contracts: profiles, pressure, checkpoint, handoff, ref, tool-result, storage, modes |
| S01 — portable package skeleton | ✅ | Combined Skill + Extension package, portable core, schemas, tests |
| **S02 — checkpoint / handoff / history** | **current** | Durable store: checkpoints, handoffs, sessions, project metadata, history, recovery |
| S03 — tool-result virtualization | next | Refs-backed tool result durability, integrity verification, on-demand recovery |
| S04 — fresh-session rollover | next | Natural + pressure rollover orchestrator, mode-gated |
| P01 — ST_BOT pilot | planned | First portability acceptance test |
| P02 — unrelated second-project pilot | planned | Second portability acceptance test |

## Authoritative documents

- `docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md` — frozen architecture (contract).
- `docs/STORAGE.md` — durable store model, atomicity, integrity, recovery (S02).
- `docs/CHECKPOINT_RECOVERY.md` — checkpoint recovery contract (S02).
- `docs/ARCHITECTURE.md` — public high-level overview.
- `docs/RESEARCH_PROVENANCE.md` — external repository license matrix.
- `docs/research/CMV3_PORTABLE_ASSIMILATION.md` — full R01 research assimilation.

## License

MIT (private during S01; license declared in `package.json`).
