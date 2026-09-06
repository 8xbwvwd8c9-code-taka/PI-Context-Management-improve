# Pressure States Reference

Detailed contract for the `cmv3_pressure` state machine. The
SKILL.md gives the operational rules; this reference freezes the
boundary semantics.

## States (R02 §5)

In order of escalation:

```text
NORMAL
TARGET_EXCEEDED
SWEEP
CHECKPOINT
ROLLOVER
EMERGENCY
```

## Boundary semantics

Let `usage` be the aggregate `tokens` reported by Pi and let the
profile thresholds be `target`, `sweep`, `checkpoint`, `rollover`,
`emergency`, `max_context`. The state is:

| Condition | State |
| --- | --- |
| `usage < target` | `NORMAL` |
| `target <= usage < sweep` | `TARGET_EXCEEDED` |
| `sweep <= usage < checkpoint` | `SWEEP` |
| `checkpoint <= usage < rollover` | `CHECKPOINT` |
| `rollover <= usage < emergency` | `ROLLOVER` |
| `usage >= emergency` | `EMERGENCY` |
| `usage >= max_context` | `EMERGENCY` (defensive cap) |

## What the agent should do at each state

| State | Action |
| --- | --- |
| `NORMAL` | Continue normal work. |
| `TARGET_EXCEEDED` | Prefer short tool results; defer non-essential reads. |
| `SWEEP` | Deterministic sweep of low-value tool output, stale file windows, redundant diagnostics. |
| `CHECKPOINT` | Persist a durable checkpoint; record current WP status. |
| `ROLLOVER` | Persist an `IN_PROGRESS` checkpoint, build a minimal handoff, start NEW. |
| `EMERGENCY` | Hold NEW; let native Pi compaction land if it fires; retry rollover on the next opportunity. |

## Profiles

Profiles freeze the threshold values per R02 §3:

| Profile | target | sweep | checkpoint | rollover | emergency |
| --- | --- | --- | --- | --- | --- |
| tiny | 2200 | 2600 | 2900 | 3200 | 3600 |
| local_32k | 16000 | 20000 | 22000 | 26000 | 28672 |
| large (ratios) | 0.45 | 0.60 | 0.68 | 0.78 | 0.88 |

`max_context` and operating `target` are separate concepts.

## Determinism

Pressure classification is deterministic. No LLM call. The
classifier is `classifyPressure(usage, profile)` in the portable
core. The output reserve is part of every profile.
