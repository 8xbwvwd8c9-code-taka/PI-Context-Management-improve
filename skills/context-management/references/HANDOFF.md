# Minimal Handoff Reference

Detailed contract for the minimal projection injected at the start
of a fresh session. The SKILL.md gives the operational rules; this
reference freezes the field set.

## Discipline

The handoff is a **projection**, not a copy. The fresh session MUST
NOT receive the entire old checkpoint blindly. Old solved
diagnostics, full transcripts, complete test logs, and the entire
checkpoint automatically are explicitly out.

## Field set (R02 §7)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `goal` | string | yes | The current goal. |
| `work_package` | string | yes | Current / next WP id. |
| `status` | enum | yes | `COMPLETE` \| `IN_PROGRESS` \| `BLOCKED` |
| `important_decisions` | string[] | yes (may be empty) | Decisions that bind the next session. |
| `hard_constraints` | string[] | yes (may be empty) | Constraints the next session must respect. |
| `current_files` | string[] | yes (may be empty) | Files currently in scope. |
| `blockers` | string[] | yes (may be empty) | Unresolved blockers. |
| `active_errors` | string[] | yes (may be empty) | Errors the next session must see. |
| `git_state` | object | yes | `{ repository, branch, head, dirty }` — every field nullable. |
| `next_actions` | string[] | yes (may be empty) | Concrete next steps. |
| `recovery_refs` | HistoryRef[] | yes (may be empty) | On-demand recovery handles. |

## What is NOT in the handoff

- full transcript
- entire test logs
- full checkpoint contents
- solved diagnostics
- any other field present in the checkpoint but not named above

Everything else is recoverable on demand via `recovery_refs`.

## Projection

`projectHandoffFromCheckpoint(checkpoint)` in the portable core
computes the projection deterministically. S01 ships the function;
S02 will own the writer.
