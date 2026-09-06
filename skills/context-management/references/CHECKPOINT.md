# Checkpoint Reference

Detailed contract for the `cmv3_checkpoint` artifact. The SKILL.md
gives the operational rules; this reference freezes the field set.

## When to write a checkpoint

| Trigger | Status |
| --- | --- |
| A meaningful WP / task is COMPLETE | `COMPLETE` |
| Context pressure reaches `CHECKPOINT` mid-WP | `IN_PROGRESS` |
| The WP cannot make forward progress | `BLOCKED` |

## Field set (R02 §6)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `schema_version` | string (literal `"1.0.0"`) | yes | Frozen for the S01 contract. |
| `checkpoint_id` | string | yes | Opaque id (see refs alphabet). |
| `project_id` | string | yes | Stable per project (e.g. sha256(root)). |
| `session_id` | string | yes | The current session. |
| `created_at` | ISO-8601 string | yes | UTC. |
| `goal` | string | yes | One sentence. |
| `work_package` | string | yes | Stable WP id. |
| `status` | enum | yes | `COMPLETE` \| `IN_PROGRESS` \| `BLOCKED` |
| `completed` | string[] | yes (may be empty) | Done items. |
| `in_progress` | string[] | yes (may be empty) | Active items. |
| `blockers` | string[] | yes (may be empty) | What is blocking forward progress. |
| `decisions` | string[] | yes (may be empty) | Important decisions made. |
| `constraints` | string[] | yes (may be empty) | Hard constraints in effect. |
| `files_read` | string[] | yes (may be empty) | Files inspected. |
| `files_modified` | string[] | yes (may be empty) | Files written. |
| `relevant_versions` | string[] | yes (may be empty) | Pinned versions, hashes, or refs. |
| `tests` | string[] | yes (may be empty) | Tests run. |
| `validation_results` | string[] | yes (may be empty) | Pass/fail/skip lines. |
| `active_errors` | string[] | yes (may be empty) | Unresolved errors. |
| `git_repository` | string \| null | yes | Null when not a Git project. |
| `git_branch` | string \| null | yes | Null when detached / not Git. |
| `git_head` | string \| null | yes | Null when not Git. |
| `git_dirty` | boolean \| null | yes | Null when unknown. |
| `next_actions` | string[] | yes (may be empty) | Concrete next steps. |
| `recovery_refs` | HistoryRef[] | yes (may be empty) | On-demand recovery handles. |
| `handoff_summary` | string | yes | One or two sentences; the projection seed. |

## Status semantics

| Status | Meaning |
| --- | --- |
| `COMPLETE` | The WP is done. Natural rollover is appropriate. |
| `IN_PROGRESS` | The WP is unfinished. Pressure or natural rollover may be appropriate. |
| `BLOCKED` | The WP cannot progress without external input. |

## Validation

A runtime writer (S02) MUST call `validateCheckpoint` from the
portable core before persisting. S01 ships the validator only.
