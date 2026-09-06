# S05 Live Runtime Integration

**Authority:** this document is the S05 (S05-LIVE-RUNTIME-INTEGRATION) work-package
contract. It is additive over S04 and the S01-S04 frozen contracts
(`docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md`).

## Goal

Wire the proven S03 / S04 data plane to the live Pi runtime
(`@earendil-works/pi-coding-agent@0.85.1`) lifecycle hooks. The wire-up
must:

- preserve every S01-S04 invariant
- introduce no external-project or Pi-core coupling
- use only the public Pi extension API
- persist, virtualize, and recover tool results in real Pi sessions
- be mode-gated (`legacy`, `v3-observe`, `v3`)
- coexist with native Pi compaction (never call `ctx.compact()`)

## S05 surface

The S05 surface is a single extension entrypoint plus four pure
modules. The pure modules are testable in isolation; the entrypoint
is a thin glue layer that adapts them to the Pi runtime.

```
src/pi/
  extension.ts          # ExtensionAPI entrypoint (default export)
  tool-result-live.ts   # virtualizeToolResult + fail-open helper
  recovery-tool.ts      # executePicmRecover (the picm_recover tool)
  pressure-live.ts      # computeLivePressure
  session-init.ts       # resolveLiveRuntime (session_start)
```

`PACKAGE_PHASE = "S05-LIVE-RUNTIME-INTEGRATION"`.

## S05 live hooks

| Event          | Behavior                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `session_start`| resolve mode / profile / projectId / oldSessionId; no side effects beyond per-extension state   |
| `tool_result`  | v3 mode: persist + replace tool result with bounded `cmv3://tool/<id>` ref view                |
| `agent_settled`| v3 mode: compute cap-driven pressure (no hardcoded 32K); observe-only decision for the LLM     |
| `registerTool` | `picm_recover` (NEW) and `picm_prepare_rollover` (S04)                                          |
| `registerCommand` | `/picm-rollover-execute` (S04) — the only `newSession` owner                                 |

### `session_start`

`session_start` is the *only* hook that may mutate the per-extension
state for the active project. The hook:

1. Reads the cwd (project identity seed)
2. Optionally reads the model context window from
   `ctx.getContextUsage().contextWindow`
3. Resolves the active profile (cap-driven: `local_32k`, `tiny`,
   or a materialized `large` profile)
4. Resolves the active mode from `CMV3_MODE` (env) or `configInput`
5. Stores `{ config, profile, projectId, oldSessionId }` in
   per-extension closures

`session_start` does NOT inject historical state into the new
session. Only the S04 fresh-session rollover (via
`/picm-rollover-execute`) hydrates a `MinimalHandoff`. A
manually-started unrelated session receives nothing.

### `tool_result`

`tool_result` is the S05 core live hook. It is a *side effect* of
the LLM's tool call, not a mutation of the Pi runtime. The handler:

1. Returns `void` for `legacy` mode (the runtime keeps the original
   tool result).
2. Returns an observation-only `details` for `v3-observe` mode
   (no persistence; no replacement).
3. Persists the result to the local store and returns a
   `ToolResultEventResult`-shaped value with a bounded active view
   (text + a `cmv3://tool/<id>` ref) for `v3` mode.

The handler never:

- calls `ctx.newSession()` (only the rollover command does)
- calls the native compact entrypoint
- captures a stale `pi` or command `ctx` after rollover
- writes native telemetry

If the store is unavailable (e.g. read-only filesystem), the
handler fails open: it returns the original event content
unchanged, and the diagnostic is recorded as metadata. Pi does not
crash.

### `agent_settled`

`agent_settled` is the live pressure observer. The observer:

1. Reads `ctx.getContextUsage()` for the live `tokens` /
   `contextWindow`.
2. Re-resolves the live profile from the physical cap (so a 16K
   context yields a fitted `local_32k` profile; a 100K cap yields
   a materialized `large` profile).
3. Runs `computeLivePressure` (cap-driven; no hardcoded 32K).
4. Records the decision in a diagnostic slot for operator tooling.

The observer never:

- calls `ctx.newSession()` (only the rollover command does)
- calls the native compact entrypoint
- mutates the active session

### `registerTool` — `picm_recover`

`picm_recover` is the agent-callable recovery surface. The LLM
invokes the tool to load a specific tool result by its opaque
`cmv3://tool/<id>` ref. The tool:

- accepts the ref (REQUIRED; opaque id only; no arbitrary path)
- accepts an optional byte range `[start, end)`
- accepts an optional `full` flag (subject to a safe default cap)
- refuses any input that is not a syntactically valid
  `cmv3://tool/<id>` ref or bare id
- refuses any read for a project that does not own the ref
- bounds the active output (default 64 KiB; hard ceiling 1 MiB)
- returns text only (binary payloads are lossy-decoded into a
  safe printable summary)

The tool does NOT:

- call `ctx.newSession()` (only the rollover command does)
- call the native compact entrypoint
- inject the recovered bytes back into the active context (the
  LLM must decide to use them; the tool is read-only)

## Mode behavior

| Mode        | `tool_result`     | `agent_settled`   | `picm_recover`   |
| ----------- | ----------------- | ----------------- | ---------------- |
| `legacy`    | pass-through      | observe only      | available        |
| `v3-observe`| observation only  | observe only      | available        |
| `v3`        | persist + replace | pressure decision | available        |

In `legacy` mode, the live tool_result hook is a no-op. The store
may be opened but is not written.

In `v3-observe` mode, the live tool_result hook records an
observation but does not persist or replace.

In `v3` mode, the live tool_result hook persists the result and
returns a bounded active view; the LLM may call `picm_recover` to
load the full payload.

## Prompt-injection inertness

The `tool_result` hook is a *side effect* of the LLM's tool call.
It is not a response to a payload. Payload bytes (including
payload bytes that contain text like `SYSTEM:`, `DEVELOPER:`, or
`A2A-v1`) are stored as data. They cannot:

- trigger a rollover
- alter a tool result's `isError` flag
- alter the active mode
- alter the persisted `success` field
- inject a fake ref

These guarantees are tested by `tests/s05-live-runtime.test.ts`
(`INJECTION 15..18`).

## Persistence failure

The `tool_result` hook fails open: when the store is unavailable,
the hook returns the original event content unchanged and records
the diagnostic as metadata. Pi does not crash. The S05 surface
never throws to the runtime.

This is tested by `tests/s05-live-runtime.test.ts` (`FAILURE 11..14`).

## Recovery tool guarantees

The `picm_recover` tool:

- accepts only `cmv3://tool/<id>` refs or bare ids (no paths)
- never reads outside the store
- is bounded (default 64 KiB; hard ceiling 1 MiB)
- is text-only (binary payloads are lossy-decoded)
- cannot inject bytes back into the active context

These guarantees are tested by `tests/s05-live-runtime.test.ts`
(`RECOVERY 19..24`).

## No duplicate hooks

The S05 entrypoint registers:

- exactly two tools (`picm_recover`, `picm_prepare_rollover`)
- exactly one command (`/picm-rollover-execute`)
- exactly three event observers (`session_start`, `tool_result`,
  `agent_settled`)

`registerTool` is called twice (once per tool). `registerCommand` is
called once. The `pi.on(...)` literal is used twice (`session_start`
and `agent_settled`); the `tool_result` subscription is wired
through a typed cast wrapper to navigate the 36-overload set on
`pi.on`, and the cast is the single subscription point.

## Coexistence with native Pi compaction

S05 never calls the native compact entrypoint on the runtime
context. The live tool_result hook, the recovery tool, and the
pressure observer all leave native Pi compaction untouched. Only
the S04 rollover command owns `newSession`; the S05 surface is
strictly additive.

## S05 module exports

| Symbol                          | Source                            | Notes                                |
| ------------------------------- | --------------------------------- | ------------------------------------ |
| `default` (extension entrypoint)| `src/pi/extension.ts`             | S05 surface                          |
| `PACKAGE_NAME`                  | `src/pi/extension.ts`             | unchanged                            |
| `PACKAGE_VERSION`               | `src/pi/extension.ts`             | unchanged                            |
| `PACKAGE_PHASE`                 | `src/pi/extension.ts`             | `S05-LIVE-RUNTIME-INTEGRATION`       |
| `ROLLOVER_TOOL_NAME`            | `src/pi/extension.ts`             | `picm_prepare_rollover` (S04)        |
| `ROLLOVER_COMMAND_NAME`         | `src/pi/extension.ts`             | `picm-rollover-execute` (S04)        |
| `PICM_RECOVER_TOOL_NAME`        | `src/pi/extension.ts`             | `picm_recover` (S05)                 |
| `virtualizeToolResult`          | `src/pi/tool-result-live.ts`      | pure                                 |
| `failOpenForPersistenceError`   | `src/pi/tool-result-live.ts`      | pure                                 |
| `LIVE_TOOL_RESULT_HOOK_NAME`    | `src/pi/tool-result-live.ts`      | `picm-tool-result-live`              |
| `executePicmRecover`            | `src/pi/recovery-tool.ts`         | pure                                 |
| `RECOVERY_TOOL_NAME`            | `src/pi/recovery-tool.ts`         | `picm_recover`                       |
| `DEFAULT_RECOVERY_MAX_BYTES`    | `src/pi/recovery-tool.ts`         | 64 KiB                               |
| `MAX_RECOVERY_RANGE_BYTES`      | `src/pi/recovery-tool.ts`         | 1 MiB hard ceiling                   |
| `computeLivePressure`           | `src/pi/pressure-live.ts`         | pure                                 |
| `LIVE_PRESSURE_HOOK_NAME`       | `src/pi/pressure-live.ts`         | `picm-pressure-live`                 |
| `resolveLiveRuntime`            | `src/pi/session-init.ts`          | pure                                 |
| `LIVE_SESSION_START_HOOK_NAME`  | `src/pi/session-init.ts`          | `picm-session-start`                 |

## Acceptance gates

- `npm run typecheck` clean
- `npm test` 304/304 green
- `npm run build` clean
- `npm run package:check` clean
- `git diff --check` clean

## Test coverage (S05-specific)

`tests/s05-live-runtime.test.ts` (53 tests):

- `LIVE TOOL 1..10` — virtualization behavior
- `FAILURE 11..14` — persistence-failure fail-open
- `INJECTION 15..18` — payload inertness
- `RECOVERY 19..24` — recovery tool guarantees
- `PRESSURE 25..32` — pressure pipeline behavior
- `MODES 33..36` — mode behavior
- `ROLLOVER REGRESSION 37..42` — S04 invariants preserved
- `PACKAGE 43..48` — package identity
- `PORTABILITY 49..51` — portability acceptance
- `END-TO-END 52..53` — end-to-end chain
