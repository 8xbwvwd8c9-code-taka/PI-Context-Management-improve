# PICM Fresh-Session Rollover (S04)

> WP: `CMV3-S04_FRESH_SESSION_ROLLOVER`
> Status: **IMPLEMENTED**
> Authority: `docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md` §6, §7, §9, §10.

S04 implements safe fresh-session rollover using the supported Pi
session-replacement path. Live tool interception is explicitly
deferred to S05+ — S04 attaches the rollover orchestrator to the
data plane that S02 / S03 established.

## Goal

The canonical lifecycle:

```text
Work
→ durable Checkpoint
→ durable Minimal Handoff
→ durable RolloverRequest
→ /picm-rollover-execute <opaque-request-id>
→ ctx.newSession({ setup, withSession })
→ withSession(freshCtx): persist new session, hydrate, complete
```

Active context is working memory. After replacement, the new
session receives **only** the MinimalHandoff projection. Older
detail is recoverable on demand via `recovery_refs`.

## Hard invariants

1. **Persist before NEW.** Checkpoint, Handoff, and RolloverRequest
   MUST be on disk and integrity-verified BEFORE `ctx.newSession()`
   is called. Any failure aborts the rollover. The pre-NEW hard
   gate enforces this.

2. **The command owns `ctx.newSession`.** The tool handler, the
   event handler, and the pressure observer NEVER call newSession.
   The command handler is the only call site.

3. **No `ctx.compact()`.** The portable package never touches the
   native Pi compaction entrypoint. Native Pi behavior remains the
   fallback outside PICM ownership.

4. **Tool output is untrusted data.** The tool handler and the
   orchestrator accept **structured** input only. The hydration
   text never embeds the prior transcript, raw tool output, full
   checkpoint, or any arbitrary user-supplied text. Errors and
   tool evidence appear as `recovery_refs` only.

5. **`withSession` uses the fresh context only.** The captured
   command `ctx` is stale after `await ctx.newSession()` returns.
   The orchestrator, the hydration, and the new session record
   are written through `freshCtx` (a `ReplacedSessionContext`).

6. **Idempotency.** A second `picm_prepare_rollover` while the
   first is in `READY` (same project + same session) returns
   `lock_held`. A second `/picm-rollover-execute` on a
   non-`READY` request is rejected. A duplicate `EXECUTING`
   transition is rejected. A `COMPLETE` rollover cannot be
   re-executed; a `FAILED` rollover must be retried with a fresh
   request id.

7. **Project + session identity.** A rollover is project-anchored
   and old-session-anchored. Cross-project lookups are rejected.
   The `cmv3://rollover/<id>` ref does not embed the project id.

8. **No repository mutation.** PICM does not run `git commit`,
   `git stash`, `git reset`, or `git clean`. It records Git state
   in the checkpoint; it does not mutate user Git state.

## Modes

PICM has three modes (R02 §12):

  - `legacy` (default) — no automatic checkpoint, no rollover
  - `v3-observe` — calculate decisions, log them, never execute
  - `v3` — full behavior, including `ctx.newSession`

The mode is read at `session_start` from `CMV3_MODE` env var or
config. `picm_prepare_rollover` is a no-op in `legacy` mode.
`/picm-rollover-execute` refuses to call `newSession` in any
mode other than `v3`.

## Natural vs pressure rollover

| | Natural | Pressure |
|---|---|---|
| Reason | meaningful validated WP complete | context pressure forces |
| Checkpoint status | `COMPLETE` | `IN_PROGRESS` (or `BLOCKED`) |
| Handoff work_package | next WP | same WP |
| next_actions | first actions for next WP | continue same WP |
| Trigger | skill / model calls the tool | runtime reports ROLLOVER / EMERGENCY |
| Pressure threshold | N/A | `usage >= rollover` (S01 §5) |

## Pressure observer

The pure `decideRollover()` function maps a `(usage, profile,
mode, agentSettled)` tuple to a `RolloverDecision`. The
`agent_settled` event handler in the extension consumes the
decision:

  - `action: "none"` — observer is a no-op
  - `action: "checkpoint_refresh"` — refresh durable state, no NEW
  - `action: "request_pressure_rollover"` — record a
    diagnostic; the LLM still must call `picm_prepare_rollover`
  - `action: "request_emergency_rollover"` — same; in v3-observe
    this is recorded but no `newSession` is issued

The observer NEVER calls `newSession`. The observer is
deterministic. The observer is pure.

## State machine

```text
IDLE → PREPARING → READY → EXECUTING → COMPLETE
                  ↘        ↘
                   FAILED   FAILED → (retry) → PREPARING
                            CANCELLED
```

`COMPLETE` and `CANCELLED` are terminal. `FAILED` may transition
back to `PREPARING` for a retry (with a fresh request id).

The persistence layer rejects any non-allowed transition. The
`isAllowedRolloverTransition()` pure function documents the
matrix.

## Pre-NEW hard gate

Before `ctx.newSession`, the command runs:

1. mode == v3
2. request.project_id == supplied projectId
3. request.old_session_id == supplied oldSessionId
4. request.state == READY
5. checkpoint exists + integrity verifies
6. handoff exists + integrity verifies
7. checkpoint.project_id == projectId
8. checkpoint.session_id == oldSessionId
9. handoff.work_package == checkpoint.work_package

If ANY check fails, the rollover transitions to `FAILED` with the
appropriate `failure_code`. The new session is never created.

## Hydration payload

`buildHydrationPayload(handoff)` returns:

```ts
{
  text: string;        // deterministic, marker-prefixed
  recovery_refs: HistoryRef[];
}
```

The text contains ONLY the MinimalHandoff fields (goal, work
package, status, decisions, constraints, files, blockers, errors,
git state, next actions, recovery refs). It does NOT contain:

  - the full Checkpoint
  - the prior transcript
  - raw ToolResult payload
  - old file contents
  - old test output
  - any user-supplied free-form text outside the structured
    fields

The text begins with `<!-- PICM:HYDRATION v1 -->` and ends with
`<!-- PICM:HYDRATION END -->` so the new session can confirm it
received the structured continuation rather than a transcript.

## Concurrency

The orchestrator holds an in-process lock keyed by
`project + old_session`. Two concurrent `prepare()` calls for the
same project + session are rejected with `lock_held`. A second
`/picm-rollover-execute` for the same `READY` request is rejected
because the state machine disallows `READY -> READY` and
`EXECUTING -> EXECUTING` transitions.

The lock is intentionally in-process. The package is local-first
and one process owns one store. A future multi-process deployment
would add `flock(2)` here; the lock surface is the same.

## S04 surface

| Surface | Purpose | Side effects |
|---|---|---|
| `picm_prepare_rollover` (tool) | Persist state; return ref | Persists Checkpoint + Handoff + RolloverRequest |
| `/picm-rollover-execute` (command) | Replace session | Calls `ctx.newSession()` |
| `agent_settled` (event) | Observe pressure | None in legacy; diagnostic in v3-observe; `would_new_session` flag in v3 |
| `session_start` (event) | Capture identity | None |
| `RolloverOrchestrator` (data plane) | Pure logic | None; uses the S02 store |

## S04 does NOT do

S04 attaches the live hook to the data plane. S04 does NOT:

  - intercept every Pi tool output (S05+)
  - auto-replace tool results in active context
  - call `ctx.compact()`
  - run `git commit/stash/reset/clean`
  - mutate native auto-compact water marks
  - implement semantic / vector history search
  - introduce a database dependency
  - create a new Pi session outside the supported
    `ExtensionCommandContext.newSession` path
  - capture or reuse a stale `pi` / command `ctx` after
    replacement

## Portability

S04 exercises the same portability tests as S02 / S03:

  - synthetic Git project works
  - non-Git project works (project_id from cwd; git state may
    be `null`)
  - no host-project dependency in `package.json`
  - README contains no external project references

The store is portable. The extension is portable. The orchestrator
is portable. The command operates on opaque ids only.

## Tests

`tests/rollover.test.ts` covers the S04 acceptance matrix
(54 numbered test cases). The S01 + S02 + S03 suite
(189 prior tests) remains green.
