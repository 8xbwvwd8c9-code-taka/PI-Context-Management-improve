---
name: context-management
description: Portable context-management rules for long-running Pi agent work. Use this skill to keep active context small, checkpoint durable state, create fresh sessions at work-package boundaries, and recover prior evidence on demand.
---

# PICM Context Management Skill

## Purpose

Keep long-running agent work reliable on small local context windows
without depending on repeated whole-conversation compaction.

Primary model:

```text
Work
→ Checkpoint
→ NEW
→ Minimal Handoff
→ Continue
```

Active context is working memory. It is not durable project state.

## S04 fresh-session rollover

PICM now owns a safe fresh-session rollover lifecycle. The model
must call the rollover tool when a meaningful validated work
package is complete (natural rollover) and must prepare a pressure
rollover when the runtime reports rollover pressure.

Tool:

  picm_prepare_rollover (returns an opaque request id)

Command (only the runtime, never the LLM, calls this):

  /picm-rollover-execute <opaque-request-id>

### When to call picm_prepare_rollover (NATURAL)

Call the tool after a meaningful validated work package is
complete. The completion is **semantic**, not based on the agent
idling. Validate:

  - the work actually achieves the WP goal
  - tests / validation are green where applicable
  - the next WP is known and identified
  - the durable recovery refs you want to carry are in scope

Then call the tool with reason=NATURAL.

Do **not** call the tool:

  - mid-turn, mid-tool-execution
  - when validation is incomplete
  - speculatively before the work is done
  - when the next WP is unknown

### When to call picm_prepare_rollover (PRESSURE)

If the runtime reports ROLLOVER or EMERGENCY pressure, the work
package is unfinished but context pressure requires a fresh
session. Call the tool with reason=PRESSURE. The status field
must be IN_PROGRESS (or BLOCKED). The new session continues the
same work package from the persisted state.

### How to call the tool

Pass structured state only. The tool accepts a typed object with
goal, work_package, status, completed, in_progress, blockers,
important_decisions, hard_constraints, current_files,
active_errors, next_actions, optional recovery_refs.

Do **not**:

  - paste your prior conversation into any field
  - paste raw tool output into any field
  - fabricate next_actions you did not actually plan
  - claim status=COMPLETE for unfinished work
  - include secrets in any field

### What happens after the tool returns

The tool persists the checkpoint, projects the minimal handoff,
persists the handoff, persists the RolloverRequest, and returns
the opaque request id. The runtime then issues
/picm-rollover-execute on your behalf. You do not need to call
the command.

### What the new session receives

Only the MinimalHandoff projection. No full checkpoint, no
transcript, no raw tool output, no old file contents. Older
detail is recoverable on demand via the recovery_refs.

## Modes

PICM has three modes: legacy, v3-observe, v3. Default is legacy.
The mode controls whether picm_prepare_rollover actually
persists (v3) or only reports decisions (v3-observe). In
legacy mode the tool is a no-op.

## Core rules

1. Prefer natural rollover at a completed work-package boundary.
2. Use pressure rollover when a work package is unfinished but context pressure is high.
3. Persist durable state before starting a fresh session.
4. Carry only the minimum handoff needed for the next action.
5. Recover older detail on demand instead of eagerly restoring whole history.
6. Remove low-value context deterministically before using LLM compaction.
7. Preserve native Pi compaction as emergency fallback.
8. Never discard the only copy of a tool result before durable persistence succeeds.
9. Keep project-specific behavior behind adapters.
10. Do not make large cloud context windows an architectural requirement.

## Local 32K profile

Treat 32K as a safety envelope, not a steady-state target.

```text
max_context  32768
target       16000
sweep        20000
checkpoint   22000
rollover     26000
emergency    28672
```

Always preserve explicit output reserve.

For the full profile matrix, pressure states, and threshold
semantics, see `references/PRESSURE.md`.

## Pressure handling order

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

## Natural rollover

When a meaningful work package is complete:

1. Validate the work.
2. Record current branch / HEAD / dirty state where relevant.
3. Record completed work.
4. Record important decisions and constraints.
5. Record test / validation results.
6. Record the next goal.
7. Persist recovery references.
8. Start a fresh context.
9. Inject only the minimal handoff needed for the next work package.

Do not carry solved diagnostics, old test logs, stale file windows,
or the entire prior conversation into the new context.

For the full checkpoint contract, see `references/CHECKPOINT.md`.

## Pressure rollover

When context approaches rollover pressure before the work package is complete:

1. Persist all required recoverable evidence.
2. Create an `IN_PROGRESS` checkpoint.
3. Record done / current / blocked / next.
4. Preserve exact recovery references for unresolved errors or evidence.
5. Start a fresh context.
6. Continue the same work package from the checkpoint.

For the full handoff contract, see `references/HANDOFF.md`.

## Minimum checkpoint contract (summary)

A checkpoint should contain, when applicable:

- goal
- current work package
- status (`COMPLETE` | `IN_PROGRESS` | `BLOCKED`)
- completed work
- work in progress
- blockers
- important decisions
- constraints
- files read
- files modified
- relevant versions / hashes
- tests run
- test results
- active errors
- git branch / HEAD / dirty
- next actions
- recovery references
- handoff summary

Prefer structured state over narrative summaries. The full field
set lives in `references/CHECKPOINT.md`.

## Tool-result policy

Large tool results such as pytest, git diff, grep, build logs,
package-manager output, stack traces, and diagnostics should not
remain verbatim in active context.

Target lifecycle:

```text
full tool result
→ durable persistence
→ integrity/reference metadata
→ bounded active representation
→ recover on demand
```

Do not claim recoverability unless persistence succeeded.

## Project portability

CMV3 core must not depend on ST_BOT, trading code, Python, or any
one repository layout.

Project adapters may expose:

- repository root
- branch
- HEAD
- dirty state
- project instructions
- test commands
- important paths

A generic Git repository should work with sane defaults.

## Do not

- do not treat max context as the desired operating size
- do not repeatedly summarize summaries as the primary strategy
- do not keep giant tool outputs in active context
- do not couple durable state to the current prompt
- do not make an LLM call when a deterministic operation is sufficient
- do not overwrite or clean unrelated user work when establishing checkpoints
- do not silently mix project-specific rules into portable core

## Success criterion

A session is healthy when the agent can continue long-running work
across fresh contexts while preserving correctness, with active
context remaining small and important state remaining recoverable.
