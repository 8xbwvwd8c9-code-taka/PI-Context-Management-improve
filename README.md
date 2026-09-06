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

CMV3 treats active context as temporary working memory and durable project state as external, recoverable storage.

## Status

**R01 / portable extraction bootstrap**

This repository is intentionally separated from ST_BOT. ST_BOT remains a pilot and knowledge source, not the owner of CMV3.

Initial goals:

- portable Pi Skill + Extension package
- local 32K models as a first-class runtime
- natural rollover at work-package boundaries
- pressure rollover for long unfinished work
- durable checkpoints and on-demand recovery
- tool-result virtualization
- deterministic cleanup before LLM compaction
- native Pi compaction retained as emergency fallback

See `skills/context-management/SKILL.md` and `docs/ARCHITECTURE.md`.
