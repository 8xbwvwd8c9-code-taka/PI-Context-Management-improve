# CMV3 Development Roadmap

| WP | Status | Goal |
| --- | --- | --- |
| R01 — research / provenance | ✅ done | External repository assimilation + license classification (`docs/research/CMV3_PORTABLE_ASSIMILATION.md`) |
| R02 — architecture freeze | ✅ done | Frozen contracts: profiles, pressure, checkpoint, handoff, ref, tool-result, storage, modes (`docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md`) |
| S01 — portable package skeleton | ✅ done | Combined Skill + Extension package, portable core, schemas, tests |
| S02 — checkpoint / handoff / history | ✅ done | Durable store: checkpoints, handoffs, sessions, project metadata, history, recovery |
| S03 — tool-result virtualization | ✅ done | Refs-backed tool result durability, integrity verification, on-demand recovery |
| S04 — fresh-session rollover | ✅ done | Natural + pressure rollover orchestrator, mode-gated |
| **S05 — live runtime integration** | **done** | Wire S03/S04 to Pi runtime lifecycle hooks (tool_result, agent_settled, session_start), additive over S04 |
| P01 — portability pilot | planned | First portability acceptance test (unrelated repository) |
| P02 — unrelated second-project pilot | planned | Second portability acceptance test |

## WP sequencing rationale

- **R01 → R02** establish what we are building and the frozen contract.
- **S01** turns the contract into a loadable package with no live behavior.
- **S02** lands durable state (the foundation of recovery).
- **S03** lands tool-result virtualization (the foundation of bounded active context).
- **S04** lands the rollover orchestrator (the foundation of long-running continuity).
- **S05** wires the proven S03/S04 surface to the live Pi runtime
  (session_start, tool_result, agent_settled). S05 is **additive
  over S04** — it does not change the rollover command, the
  fresh-session lifecycle, or any of the S01-S04 frozen contracts.
  The S05 surface is the `src/pi/extension.ts` entrypoint plus
  the four pure modules in `src/pi/` (`tool-result-live`,
  `recovery-tool`, `pressure-live`, `session-init`).
- **P01 / P02** prove portability in two unrelated repositories.

## Source-of-truth rule

Current code, tests, and configuration override this document.
Historical reports and specs remain useful evidence but do not
override a current state doc.
