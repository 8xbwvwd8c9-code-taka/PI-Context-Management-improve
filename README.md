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

**PICM v1.0** — cross-project portability validated.

PICM v1 is the first stable release. It is the same packaged
artifact, loaded from the same tarball, that drives the
P02 cross-project portability validation: one Node Git
target plus one non-Git Python target, both consuming the
same install, both with zero project-specific PICM
configuration, both with isolated stores and isolated
project ids.

PICM v1 ships:

- a portable Skill + Extension package (S01)
- local 32K models as a first-class runtime (S01 profiles)
- durable checkpoint / handoff / session persistence (S02)
- deterministic recovery without LLM (S02)
- tool-result virtualization (S03)
- natural rollover at work-package boundaries (S04)
- pressure rollover for long unfinished work (S04)
- live Pi runtime integration (S05): `session_start`,
  `tool_result`, `agent_settled`, `picm_recover`
- cross-project portability validated (P01, P02)

PICM v1 does NOT:

- introduce a database dependency
- mutate the user's Git state
- call `ctx.compact()`
- require project-specific configuration
- ship any host-project identifiers in the public surface
- pollute target repositories with copied PICM source

## Installation

PICM v1 is a local-development artifact validated end-to-end
through P02. It is **not published** to npm. The expected
install command, once published, is:

```text
pi install npm:pi-context-management-improve
```

For local development, you can point Pi at the source tree:

```text
pi -e /path/to/PI-Context-Management-improve
```

Or copy the package under `~/.pi/agent/npm/` and add it to your
`settings.json` `packages` list. The P02 cross-project
portability validation proves that the same packaged artifact
works in any target project without source copies or
project-specific configuration.

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

The Pi Runtime Extension hosts lifecycle hooks, tool-result
virtualization, agent_settled pressure observer, the recovery
tool, and fresh-session rollover. The extension is wired to
the live Pi runtime in S05; the S04 orchestrator owns the
`ctx.newSession` call.

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

## Non-goals (v1)

- no host-project identifiers in the public surface
- no database dependency
- no semantic / vector history search
- no automatic LLM-driven cleanup outside the deterministic
  pre-NEW gate
- no project-specific core code (PICM does not know the name
  of any host project)
- no source copy into target repositories

## Roadmap

| WP | Status | Goal |
| --- | --- | --- |
| R01 — research / provenance | done | External repository assimilation + license classification |
| R02 — architecture freeze | done | Frozen contracts: profiles, pressure, checkpoint, handoff, ref, tool-result, storage, modes |
| S01 — portable package skeleton | done | Combined Skill + Extension package, portable core, schemas, tests |
| S02 — checkpoint / handoff / history | done | Durable store: checkpoints, handoffs, sessions, project metadata, history, recovery |
| S03 — tool-result virtualization | done | Refs-backed tool result durability, integrity verification, bounded active view, on-demand recovery |
| S04 — fresh-session rollover | done | Natural + pressure rollover orchestrator, deterministic state machine, pre-NEW hard gate, structured hydration, mode-gated |
| S05 — live runtime integration | done | Wire S03/S04 to Pi runtime lifecycle hooks (session_start, tool_result, agent_settled), additive over S04 |
| P01 — portability pilot | done | First portability acceptance test (controlled runtime pilot) |
| P02 — cross-project portability | done | Final v1 portability gate: same packaged artifact in two unrelated projects (Git + non-Git) |

PICM v1 is complete. The same packaged tarball (v1.0.0) drives
the live Pi runtime, durable store, project adapters, and
cross-project portability without target-specific core code.

## Authoritative documents

- `docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md` — frozen architecture (contract).
- `docs/STORAGE.md` — durable store model, atomicity, integrity, recovery (S02 + S03).
- `docs/CHECKPOINT_RECOVERY.md` — checkpoint recovery contract (S02).
- `docs/TOOL_RESULT_VIRTUALIZATION.md` — tool-result durability contract (S03).
- `docs/FRESH_SESSION_ROLLOVER.md` — fresh-session rollover contract (S04).
- `docs/ARCHITECTURE.md` — public high-level overview.
- `docs/RESEARCH_PROVENANCE.md` — external research license matrix.

## License

MIT (declared in `package.json`).
