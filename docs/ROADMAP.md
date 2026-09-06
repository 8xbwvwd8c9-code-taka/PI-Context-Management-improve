# CMV3 Development Roadmap

| WP | Status | Goal |
| --- | --- | --- |
| R01 — research / provenance | ✅ done | External repository assimilation + license classification (`docs/research/CMV3_PORTABLE_ASSIMILATION.md`) |
| R02 — architecture freeze | ✅ done | Frozen contracts: profiles, pressure, checkpoint, handoff, ref, tool-result, storage, modes (`docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md`) |
| S01 — portable package skeleton | ✅ done | Combined Skill + Extension package, portable core, schemas, tests |
| **S02 — checkpoint / handoff / history** | **in progress** | Durable store: checkpoints, handoffs, sessions, project metadata, history, recovery |
| S03 — tool-result virtualization | next | Refs-backed tool result durability, integrity verification, on-demand recovery |
| S04 — fresh-session rollover | next | Natural + pressure rollover orchestrator, mode-gated |
| P01 — ST_BOT pilot | planned | First portability acceptance test |
| P02 — unrelated second-project pilot | planned | Second portability acceptance test |

## WP sequencing rationale

- **R01 → R02** establish what we are building and the frozen contract.
- **S01** turns the contract into a loadable package with no live behavior.
- **S02** lands durable state (the foundation of recovery).
- **S03** lands tool-result virtualization (the foundation of bounded active context).
- **S04** lands the rollover orchestrator (the foundation of long-running continuity).
- **P01 / P02** prove portability in two unrelated repositories.

## Source-of-truth rule

Current code, tests, and configuration override this document.
Historical reports and specs remain useful evidence but do not
override a current state doc.
