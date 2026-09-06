# PI Context Management Improve (PICM)

Portable, local-first context management for long-running Pi agents.

PICM is an independent **Pi Skill + Extension package** for keeping
active context small while preserving durable, recoverable work
state across long-running sessions.

## Core operating model

```text
Work
→ Checkpoint
→ NEW
→ Minimal Handoff
→ Continue
```

PICM treats active context as temporary working memory and durable
project state as external, recoverable storage.

## Status

**S03 — tool-result virtualization**

This package is currently in development. It is **not published**
to npm. It is intended to be installed from this repository once
the runtime behavior lands in S04.

S03 adds tool-result durability on top of S02:

- opaque tool-result refs (`cmv3://tool/<id>`)
- durable full-byte persistence (UTF-8 text + arbitrary binary)
- SHA-256 integrity verification on every read
- bounded active view with head/tail preservation
- byte-range recovery without reloading oversized payloads
- derived `kind=tool` history index (metadata only, no raw payload)
- index rebuild from authoritative records
- prompt-injection-safe persistence (payload treated as inert data)
- persistence-failure-safe active view (no ref on failure)

S03 does NOT yet:

- intercept live Pi tool output
- automatically replace tool results in active context
- create a new Pi session
- execute rollover
- call native Pi compaction

Prior WPs:

- portable Pi Skill + Extension package (S01)
- local 32K models as a first-class runtime (S01 profiles)
- durable checkpoint / handoff / session persistence (S02)
- deterministic recovery without LLM (S02)
- tool-result virtualization (S03, current)
- natural rollover at work-package boundaries (S04)
- pressure rollover for long unfinished work (S04)
- deterministic cleanup before LLM compaction (post-S04)
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
PICM
├── Portable Core        (src/core/)
├── Pi Runtime Extension (src/pi/)        ← S01 no-op, S04+ live hooks
├── Project Adapters     (src/adapters/)
├── Durable Store        (src/store/)      ← S02 + S03 tool-result layer
└── Skill                (skills/context-management/)
```

The Portable Core is pure / deterministic. No Pi, no host project,
no I/O outside the package's own working area.

The Pi Runtime Extension hosts lifecycle hooks, telemetry,
tool-result interception, checkpoint trigger, and fresh-session
rollover. Through S03, the extension remains a no-op entrypoint;
live hook wiring is deferred to S04+.

The Durable Store (S02 + S03) is a local-first filesystem library.
It lives outside the target Git repo by default and is responsible
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
| S02 — checkpoint / handoff / history | done | Durable store: checkpoints, handoffs, sessions, project metadata, history, recovery |
| **S03 — tool-result virtualization** | **current** | Refs-backed tool result durability, integrity verification, bounded active view, on-demand recovery |
| S04 — fresh-session rollover | next | Natural + pressure rollover orchestrator, mode-gated |
| P01 — pilot 1 | planned | First portability acceptance test (separate downstream project) |
| P02 — pilot 2 | planned | Second portability acceptance test (separate downstream project) |

## Authoritative documents

- `docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md` — frozen architecture (contract).
- `docs/STORAGE.md` — durable store model, atomicity, integrity, recovery (S02 + S03).
- `docs/CHECKPOINT_RECOVERY.md` — checkpoint recovery contract (S02).
- `docs/TOOL_RESULT_VIRTUALIZATION.md` — tool-result durability contract (S03).
- `docs/ARCHITECTURE.md` — public high-level overview.
- `docs/RESEARCH_PROVENANCE.md` — external research license matrix.

## License

MIT (private during S03; license declared in `package.json`).
