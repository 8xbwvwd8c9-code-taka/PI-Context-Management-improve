# CMV3 Portable Architecture

## 1. Product boundary

CMV3 is a portable Pi Context Management package.

It is intentionally separate from ST_BOT.

ST_BOT provides pilot evidence and reusable lessons, but CMV3 core must remain project-independent.

## 2. Primary behavior

```text
Work
→ Checkpoint
→ NEW
→ Minimal Handoff
→ Continue
```

Two rollover modes exist:

- **Natural rollover** — preferred; a meaningful work package completes, then a fresh session begins for the next package.
- **Pressure rollover** — fallback; the current package is unfinished, but context pressure requires a fresh session.

Whole-context LLM compaction is not the normal steady-state mechanism.

## 3. Layering

```text
CMV3
├── Core
│   ├── profiles
│   ├── budgets
│   ├── pressure
│   ├── checkpoint schema
│   ├── handoff schema
│   ├── history references
│   └── recovery contracts
├── Pi Runtime Extension
│   ├── usage telemetry
│   ├── lifecycle hooks
│   ├── tool-result virtualization
│   ├── checkpoint trigger
│   └── rollover orchestration
├── Skill
│   └── agent behavioral rules
└── Project Adapters
    ├── generic Git
    ├── generic filesystem
    └── optional project-specific adapters
```

## 4. Local-first operating profiles

### Tiny

```text
max_context = 4096
target = 2200
sweep = 2600
checkpoint = 2900
rollover = 3200
emergency = 3600
```

### Local 32K

```text
max_context = 32768
target = 16000
sweep = 20000
checkpoint = 22000
rollover = 26000
emergency = 28672
```

### Large / cloud

Materialize thresholds from capability using ratios:

```text
target      0.45
sweep       0.60
checkpoint  0.68
rollover    0.78
emergency   0.88
```

Large context changes budgets, not the state model.

## 5. Core invariants

- active context is temporary working memory
- durable project state lives outside the prompt
- no context category may grow without limit
- output reserve is explicit
- persistence precedes destructive truncation
- structured checkpoints are preferred over narrative memory
- retrieval is on-demand
- deterministic cleanup precedes LLM compaction
- native Pi compaction remains emergency fallback
- project-specific behavior stays behind adapters
- local 32K support is first-class

## 6. Migration from ST_BOT pilot

ST_BOT pilot findings currently contribute:

- observed external Pi HIGH/LOW compaction ownership
- telemetry hook lessons
- durable Supervisor checkpoint/run/failure surfaces
- ContextRef-style reversible-reference concepts
- confirmed destructive subprocess-output truncation problem
- initial tiny/local32k/large profile thresholds

These are design inputs, not a mandate to copy ST_BOT module structure.

## 7. Planned phases

- R01 — repository assimilation and provenance
- R02 — portable architecture freeze
- S01 — portable Skill + Extension skeleton
- S02 — checkpoint / handoff / history
- S03 — tool-result virtualization
- S04 — fresh-session rollover
- P01 — ST_BOT pilot
- P02 — unrelated second-project pilot

## 8. Portability acceptance

CMV3 is not considered portable until the same package works in at least two unrelated repositories without copying CMV3 implementation into either repository.
