# PI Context Management Improve (PICM)

Portable, local-first context management for long-running Pi agents.

PICM is an independent **Pi Skill + Extension package** for keeping active context small while preserving durable, recoverable work state across long-running sessions.

## Core operating model

```text
Work
→ Checkpoint
→ NEW
→ Minimal Handoff
→ Continue
```

Active context is treated as temporary working memory. Durable state lives outside the prompt and can be recovered when needed.

## Goals

- portable Pi Skill + Extension package
- local 32K models as a first-class runtime
- natural rollover at meaningful work boundaries
- pressure rollover for long unfinished work
- durable checkpoints and minimal handoffs
- recoverable session/project history
- tool-result virtualization
- deterministic cleanup before LLM compaction
- explicit output reserve and context budgets
- native Pi compaction retained as an emergency fallback
- zero-config operation with optional project configuration

## Local-first context policy

For a 32K model, PICM treats the physical limit as a safety envelope rather than a steady-state target:

```text
max_context  32768
target       16000
sweep        20000
checkpoint   22000
rollover     26000
emergency    28672
```

The architecture also supports tiny and large/cloud profiles without changing the core state model.

## Architecture

```text
PICM
├── Core
│   ├── profiles
│   ├── budgets
│   ├── pressure
│   ├── checkpoint
│   ├── handoff
│   ├── history
│   └── references
├── Pi Runtime Extension
│   ├── lifecycle hooks
│   ├── telemetry
│   ├── tool-result virtualization
│   └── rollover orchestration
├── Skill
│   └── context-management
└── Project Adapters
    ├── generic
    └── git
```

The **Skill** defines agent behavior. The **Extension** provides runtime mechanics. Portable core remains independent from project-specific application logic.

## Context pressure order

```text
1. source truncation
2. deterministic tool-output sweep
3. retrieval eviction
4. old file-window eviction
5. structured checkpoint refresh
6. fresh-context rollover
7. LLM middle compaction
8. native emergency compaction
```

Repeated whole-context compaction is not the preferred steady-state mechanism.

## Current status

PICM is under active development and is not yet published as a stable package.

Current implementation path:

```text
Architecture
→ Portable package
→ Durable checkpoint / handoff / history
→ Tool-result virtualization
→ Fresh-session rollover
→ Portability validation
```

## Repository layout

```text
src/
  core/
  pi/
  adapters/

skills/
  context-management/

docs/
tests/
```

See:

- `skills/context-management/SKILL.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md` when present

## Design principles

- active context is RAM, not durable storage
- structured state is preferred over narrative memory
- deterministic cleanup comes before LLM compaction
- persistence must succeed before destructive truncation
- recovery should work without an LLM
- fresh-context rollover is preferred over repeated summary-of-summary compaction
- local models are first-class runtimes
- project-specific behavior stays behind adapters

## License

License and release policy will be finalized before public package distribution.
