# PI Context Management Improve (PICM)

Portable, local-first context management for long-running Pi agents.

PICM is an independent **Pi Skill + optional Runtime Extension** designed to keep active context small while preserving durable, recoverable work state across long-running sessions.

## Status

**PICM v1.0 is feature-complete.**

Validated capabilities include:

- standalone Context Management Skill
- optional Pi Runtime Extension
- durable checkpoints and minimal handoffs
- natural fresh-session rollover
- pressure-triggered rollover
- live tool-result virtualization
- bounded on-demand recovery
- restart-safe project/session history
- Git and non-Git project support
- zero-config generic operation
- cross-project isolation and portability
- no PICM-owned `ctx.compact()` calls
- no Pi core patches
- no automatic Git mutation

Final v1.0 validation completed with **355 passing tests** across unit, integration, controlled runtime, packaging, and portability coverage.

Package publication and repository tagging may still be pending.

## Core operating model

```text
Work
→ Checkpoint
→ NEW Session
→ Minimal Handoff
→ Continue
```

Active context is treated as temporary working memory. Durable state lives outside the prompt and can be recovered when needed.

The goal is to avoid carrying an ever-growing transcript forward when only a small amount of structured state is required to continue useful work.

## Tool-result virtualization

Large tool results are persisted before the active representation is reduced.

```text
Large Tool Result
        ↓
Durable Full Copy
        +
Bounded Active View
        ↓
Recover on Demand
```

PICM preserves the authoritative result and exposes an opaque recovery reference such as:

```text
cmv3://tool/<opaque-id>
```

The active context receives only a bounded deterministic representation, while the complete result remains available for exact or ranged recovery.

## Skill and Runtime

PICM has two independent layers:

```text
PICM
├── Skill
│   └── context-management
│
└── Runtime Extension
    ├── durable state
    ├── pressure tracking
    ├── tool-result virtualization
    ├── recovery
    └── session rollover
```

### Skill

The Skill can be used independently.

It teaches the agent to:

- work in meaningful work packages
- create structured checkpoints
- keep handoffs minimal
- start fresh context instead of repeatedly compressing old context
- continue the same work package after pressure rollover
- avoid copying the entire previous conversation into the next session

### Runtime Extension

The Runtime Extension adds automation:

- durable checkpoint / handoff / session storage
- tool-result persistence and virtualization
- context-pressure classification
- natural and pressure rollover orchestration
- fresh-session hydration
- bounded historical recovery

The Runtime Extension is optional; the Skill does not require it for basic behavioral guidance.

## Runtime modes

PICM supports three modes:

| Mode | Behavior |
| --- | --- |
| `legacy` | Default. PICM does not change normal runtime behavior. |
| `v3-observe` | Calculates pressure and diagnostics without replacing tool results or creating new sessions. |
| `v3` | Enables durable tool virtualization, pressure handling, and fresh-session rollover. |

The default remains:

```text
legacy
```

This makes installation non-invasive until PICM automation is explicitly enabled.

## Local-first context policy

PICM treats the physical context limit as a safety envelope, not a steady-state target.

For a 32K local model:

```text
max_context  32768
target       16000
sweep        20000
checkpoint   22000
rollover     26000
emergency    28672
```

PICM also supports tiny and larger-context profiles without changing the core state model.

A typical pressure strategy is:

```text
NORMAL
→ TARGET
→ SWEEP
→ CHECKPOINT
→ ROLLOVER
→ EMERGENCY
```

Fresh-context rollover is preferred before repeated whole-context compaction becomes the primary operating mode.

## Architecture

```text
PICM
├── Core
│   ├── profiles
│   ├── pressure
│   ├── references
│   ├── checkpoint
│   ├── handoff
│   ├── hydration
│   └── rollover
│
├── Durable Store
│   ├── projects
│   ├── checkpoints
│   ├── handoffs
│   ├── sessions
│   ├── rollovers
│   ├── tool results
│   └── rebuildable indexes
│
├── Pi Runtime Extension
│   ├── session lifecycle
│   ├── tool-result virtualization
│   ├── pressure trigger
│   ├── recovery tool
│   └── fresh-session orchestration
│
├── Skill
│   └── context-management
│
└── Project Adapters
    ├── generic
    └── git
```

The portable core remains independent from application-specific project logic.

## Durable storage

PICM is local-first.

The default durable store is outside the target project:

```text
~/.pi/cmv3/
```

Authoritative records are stored separately from derived indexes.

Important properties:

- atomic writes
- SHA-256 integrity verification
- opaque references
- project isolation
- rebuildable indexes
- recovery without an LLM
- Git and non-Git project support
- no database dependency required

PICM does not claim encryption at rest.

## Recovery

PICM keeps historical evidence outside active context and retrieves it only when needed.

Supported recovery concepts include:

- checkpoint recovery
- handoff recovery
- session linkage
- tool-result metadata
- bounded byte/range reads
- restart recovery
- index rebuild

Large historical payloads are not blindly reinserted into context.

## Safety and isolation

PICM follows these invariants:

- persist before destructive bounding
- never fabricate recoverable refs after persistence failure
- tool output is treated as untrusted data
- tool payload text cannot become PICM control instructions
- project A cannot read project B's durable records
- PICM does not automatically commit, reset, stash, clean, or checkout Git state
- PICM does not patch Pi core
- PICM does not call `ctx.compact()`
- native Pi compaction remains available as an emergency fallback

## Zero-config portability

PICM is designed to work without project-specific core code.

Validated project shapes include:

- generic Git projects
- non-Git directories
- different language/tooling layouts

Project-specific behavior, if ever required, belongs behind adapters rather than inside the portable core.

## Package

Current version:

```text
1.0.1
```

PICM v1.0.1 is a packaging corrective over v1.0: the build artifact (`dist/`) is now committed, so a clean `pi install https://github.com/8xbwvwd8c9-code-taka/PI-Context-Management-improve` is runtime-ready without any manual `npm install` / `npm run build` step.

The package exposes both:

- the standalone `context-management` Skill
- the Pi Runtime Extension

The v1.0.1 package has passed same-artifact cross-project installation and smoke validation, including a clean Git-install gate that loads the extension from the committed `dist/`.

Public package publication may still be pending.

## Repository layout

```text
src/
  core/
  store/
  pi/
  adapters/

skills/
  context-management/

docs/
tests/
```

Key documentation:

- `skills/context-management/SKILL.md`
- `docs/ARCHITECTURE.md`
- `docs/STORAGE.md`
- `docs/CHECKPOINT_RECOVERY.md`
- `docs/LIVE_RUNTIME.md`
- `docs/TOOL_VIRTUALIZATION.md`
- `docs/ROADMAP.md`

## Design principles

- active context is working memory, not durable storage
- structured state is preferred over narrative memory
- minimal handoff is preferred over transcript carryover
- deterministic cleanup comes before LLM compaction
- persistence must succeed before destructive truncation
- recovery should work without an LLM
- fresh-session rollover is preferred over summary-of-summary degradation
- local models are first-class runtimes
- project-specific behavior stays behind adapters
- installation should not modify a target project's source tree

## v1.0 completion

PICM v1.0 has completed:

```text
Architecture
→ Portable package
→ Durable checkpoint / handoff / history
→ Tool-result virtualization
→ Fresh-session rollover
→ Live runtime integration
→ Controlled runtime validation
→ Cross-project portability validation
→ v1.0 COMPLETE
```

Further work after v1.0 is considered post-v1 improvement rather than required completion work.

## License

License and public distribution policy should be finalized before broad public package publication.
