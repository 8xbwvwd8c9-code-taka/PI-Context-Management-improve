# CMV3 Development Roadmap

| WP | Status | Goal |
| --- | --- | --- |
| R01 — research / provenance | ✅ done | External repository assimilation + license classification (`docs/research/CMV3_PORTABLE_ASSIMILATION.md`) |
| R02 — architecture freeze | ✅ done | Frozen contracts: profiles, pressure, checkpoint, handoff, ref, tool-result, storage, modes (`docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md`) |
| S01 — portable package skeleton | ✅ done | Combined Skill + Extension package, portable core, schemas, tests |
| S02 — checkpoint / handoff / history | ✅ done | Durable store: checkpoints, handoffs, sessions, project metadata, history, recovery |
| S03 — tool-result virtualization | ✅ done | Refs-backed tool result durability, integrity verification, on-demand recovery |
| S04 — fresh-session rollover | ✅ done | Natural + pressure rollover orchestrator, mode-gated |
| S05 — live runtime integration | ✅ done | Wire S03/S04 to Pi runtime lifecycle hooks (tool_result, agent_settled, session_start), additive over S04 |
| S05A — pressure trigger hardening | ✅ done | Dedup + loop guard on the live `agent_settled` pressure trigger; no fake payload / no duplicate rollover |
| P01 — portability pilot | ✅ done | First portability acceptance test (controlled runtime pilot, `docs/P01_PILOT_REPORT.md`) |
| P02 — cross-project portability | ✅ done | Final v1 portability gate: same packaged artifact in two unrelated projects (`docs/P02_PORTABILITY_REPORT.md`) |

## PICM v1

PICM v1 is complete. The same packaged artifact (v1.0.0) drives
the live Pi runtime, durable store, project adapters, and
cross-project portability without target-specific core code. See
`docs/P02_PORTABILITY_REPORT.md` for the v1 portability evidence.

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
- **S05A** adds the pressure-trigger dedup / loop guard without
  changing the S04 contract. One rollover per (project, session)
  per pressure window; no payload-driven trigger; no duplicate NEW.
- **P01** runs the real S01..S05A pipeline through a synthetic
  Git repository (3 WPs, 1 pressure rollover, 1 oversized tool
  result, 1 recovery, 1 process restart, 1 index rebuild).
- **P02** proves the same packed tarball (v1.0.0) drives two
  unrelated projects (one Git Node target, one non-Git Python
  target) end-to-end with isolated stores, isolated project ids,
  and zero project-specific core code.

## Source-of-truth rule

Current code, tests, and configuration override this document.
Historical reports and specs remain useful evidence but do not
override a current state doc.
