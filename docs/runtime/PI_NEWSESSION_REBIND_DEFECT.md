# Pi 0.85.1 `newSession` rebind defect

## Scope

PICM statically inspected the installed `@earendil-works/pi-coding-agent@0.85.1`
without invoking the Pi executable. The inspected runtime is
`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist`.
The repository-local dependency is also 0.85.1 and is byte-identical for the
three runtime files listed below.

| File | SHA-256 |
| --- | --- |
| `modes/interactive/interactive-mode.js` | `802ff14f5a47710e5a46d8141b238c4d5ffca30e8ca26bad18f838eddbf086bf` |
| `core/agent-session-runtime.js` | `61375f59afc3395940c05832c3f992e8020139a2f4a53065cccacbc370b65f16` |
| `core/session-manager.js` | `ccace64949db25379a43971ecea750c1b7ec6344e1bc31b9d5fe596ac2f1c9f3` |

## Failing lifecycle and exception ownership

`ExtensionCommandContext.newSession` is explicitly command-only and public
(`dist/core/extensions/types.d.ts:250-266`). The interactive binding awaits
`runtimeHost.newSession` and catches any rejection
(`dist/modes/interactive/interactive-mode.js:1408-1417`). Its catch calls
`handleFatalRuntimeError`, which stops the TUI and calls `process.exit(1)`
(`interactive-mode.js:1525-1530`). The exception is not returned to the
extension command.

`AgentSessionRuntime.newSession` performs, in order:

1. `teardownCurrent` (`agent-session-runtime.js:102-113,160`), where agent
   abort, `session_shutdown` hooks, host invalidation, or disposal can throw.
2. `createRuntime` and `apply` (`agent-session-runtime.js:114-119,161-166`),
   where runtime construction can throw. `AgentSession.bindExtensions` awaits
   the `session_start` pipeline at `dist/core/agent-session.js:1906-1927`, but
   individual hook exceptions are caught and reported by
   `dist/core/extensions/runner.js:623-652`.
3. optional extension `setup` (`agent-session-runtime.js:167-170`).
4. `finishSessionReplacement` (`agent-session-runtime.js:120-126,171`). It
   awaits the host's `rebindSession` before invoking the extension's
   `withSession` callback.

The interactive rebind runs `renderCurrentSessionState`, `subscribeToAgent`,
and `bindCurrentSessionExtensions` in that order
(`interactive-mode.js:1505-1524`). Each host operation can throw; extension
binding also awaits `session_start`, whose individual handler failures are
contained by the runner. Therefore an uncaught rebind failure rejects `newSession`
before `withSession` is entered. PICM cannot observe or intercept that error
through the public API because the interactive host owns the catch and exits.

No public deferred session-switch API avoids the lifecycle. Public `newSession`,
`fork`, and `switchSession` all expose `withSession`, and the runtime routes all
three through `finishSessionReplacement` after rebind
(`extensions/types.d.ts:254-306`; `agent-session-runtime.js:128-248`).

## Non-TUI reproduction

The temporary harness `/tmp/picm-runtime-replacement-harness.mjs` imports the
installed `AgentSessionRuntime` and `InteractiveMode` prototypes. It replaces
only external session/UI dependencies and drives the real `newSession`,
`finishSessionReplacement`, and `rebindCurrentSession` methods. It proves:

- healthy rebind invokes `withSession` and resolves;
- throws from render, subscribe, or extension bind skip `withSession`;
- a throwing `session_start` extension hook is reported and contained, so
  rebind and `withSession` continue;
- a PICM `withSession` failure occurs only after successful rebind and is
  distinguishable from the pre-callback failures.

Expected: a documented command-context `newSession` either completes its
replacement callback or returns a recoverable rejection to the caller.
Actual in 0.85.1: an internal rebind rejection is converted into process exit,
after the old runtime is disposed and before the callback can persist PICM's
new `SessionRecord` and `COMPLETE` transition.

## PICM handling

PICM does not mark the rollover `COMPLETE` early, retry, delay, or patch Pi.
Its compatibility model is fail-closed:

- `SAFE`: only an exact distributed runtime explicitly admitted after passing
  the R1-R6 harness may use the `READY -> EXECUTING -> newSession` path.
- `KNOWN_UNSAFE`: 0.85.1 is refused before `READY -> EXECUTING` with
  `pi_newsession_rebind_unsafe`.
- `UNVALIDATED`: every other version, including missing, unparsable, and newer
  semantic versions, is also refused before `READY -> EXECUTING`. A newer
  version is never assumed fixed from its version number alone.

There are currently zero production `SAFE` versions. Automatic fresh-session
rollover is therefore compatibility-blocked while checkpoint, handoff,
recovery, and native/manual fallback remain available. A blocked request stays
`READY`; PICM neither calls `ctx.newSession` nor fabricates a terminal state.
If a process was already lost on the old path, frozen P04 startup reconciliation
still classifies the stale `EXECUTING` request from durable evidence.

A Pi version may enter `SAFE` only when its exact distributed runtime is tested
by the R1-R6 harness and the interactive replacement contract no longer exposes
the fatal pre-`withSession` rebind path, or upstream provides an equivalent
documented guarantee. No minimum safe version is currently proven, and this
report does not claim an upstream fix exists.
