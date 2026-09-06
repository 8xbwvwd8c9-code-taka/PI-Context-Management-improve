# P01 controlled-pilot report

> Authority: P01 WP spec. Real-runtime validation of PICM S01..S05A.

## Environment

- PI_VERSION: `0.85.1`
- PICM_COMMIT: `8db2f3e`
- PILOT_PROFILE: local_32k (default) + tiny (pressure)
- PILOT_PROJECT_KIND: synthetic-git-repo
- Pilot repo (disposable): `/var/folders/qr/g6jgm76s0nq740t4wl9yffxc0000gn/T/p01-pilot-repo-9737-1788676756280-401a75ad`

## Workload

Three NATURAL rollovers (WP-A → WP-B → WP-C) followed by one forced PRESSURE rollover on the tiny profile. One 200 KB deterministic tool result was virtualized and recovered through the live `picm_recover` tool.

## Measured metrics

- NATURAL_ROLLOVER_COUNT: 3
- PRESSURE_ROLLOVER_COUNT: 1
- NEW_SESSION_COUNT: 4
- CHECKPOINT_COUNT: 4
- HANDOFF_COUNT: 4
- TOOL_RESULT_COUNT: 1
- TOOL_RAW_BYTES: 198000
- TOOL_ACTIVE_BYTES: 4274
- TOOL_REDUCTION_RATIO: 46.3
- RECOVERY_SUCCESS_COUNT: 2
- RECOVERY_FAILURE_COUNT: 0

## Pass gates

- REAL_PI_RUNTIME: 1
- GENERIC_SYNTHETIC_REPO: 1
- NATURAL_ROLLOVER_COUNT>=2: PASS
- PRESSURE_ROLLOVER_COUNT>=1: PASS
- NEW_SESSION_CONTINUITY: 1
- MINIMAL_HANDOFF_ONLY: 1
- REPEATED_COMPLETED_WORK: 0
- LIVE_TOOL_VIRTUALIZATION: 1
- TOOL_RESULT_DURABLE: 1
- TOOL_RECOVERY_SUCCESS: 1
- ACTIVE_RESULT_REDUCED: PASS
- CHECKPOINT_DURABLE: PASS
- HANDOFF_DURABLE: PASS
- ROLLOVER_DURABLE: 1
- PROCESS_RESTART_RECOVERY: 1
- INDEX_REBUILD_SUCCESS: 1
- DUPLICATE_NEW_SESSION_COUNT: 0
- PERSIST_BEFORE_NEW: 1
- PICM_GIT_MUTATION: 0
- LEGACY_SMOKE: PASS
- V3_OBSERVE_SMOKE: PASS
- V3_SMOKE: PASS
- LOCAL_32K_PROFILE_VALID: 1
- CTX_COMPACT_CALLS: 0
- PI_CORE_PATCHED: 0
- README_EXTERNAL_PROJECT_REFS: 0

## Limitations

This pilot drives the real `cmv3Extension` entry through the real S02 store, the real S04 orchestrator, the real S05 tool-result virtualization, and the real S05A pressure trigger. The LLM is replaced by a small in-process driver that calls the registered `picm_prepare_rollover` tool and the `/picm-rollover-execute` command with valid inputs. A real LLM pilot would require an interactive Pi session, an API key, and an operator; those are outside the scope of a sandboxed test.

Failure-injection cases are covered by the existing test suite:

- Tool-result persistence failure → `tests/s05-live-runtime.test.ts` FAILURE 11/12/14 (fail-open, no fake ref)
- Checkpoint persistence failure → `tests/rollover.test.ts` DURABILITY 18 (no NEW)
- Corrupt handoff before execute → `tests/rollover.test.ts` DURABILITY 19 (NEW rejected)
- Duplicate pressure signal → `tests/s05-live-runtime.test.ts` S05A DEDUP 6 + SM 10/11/12 (no duplicate NEW, no infinite loop)
- Duplicate rollover command → `tests/s05-live-runtime.test.ts` ROLLOVER REGRESSION 41 + `tests/rollover.test.ts` IDEMPOTENCY 35 (one NEW)

## P01 corrective work (bounded, regression-tested)

P01 found two real bugs in the live S04 command path that no unit test had exercised before. Both fixes are bounded; each is paired with a regression test in `tests/s05-live-runtime.test.ts` (P01 REGRESSION).

1. `checkpoint_id` placeholder: the live `picm_prepare_rollover` tool built a checkpoint with `checkpoint_id: ""` and then called `projectHandoffFromCheckpoint(cp)`, which called `validateCheckpoint(cp)` and rejected the empty id. The S04 unit tests passed because they used the orchestrator directly with pre-built checkpoints. The fix: stamp a `generateId()` placeholder before the handoff projection; the store rewrites the id on write.

2. `previous_session_ref` ref-shape: the live `picm-rollover-execute` command built `previous_session_ref = `cmv3://session/${oldSessionId}` but `oldSessionId` is a session file path (e.g. `sess_xxx.json`) and the ref-validation in `store.sessions.write` rejects paths. The fix: normalize the file path to a ref-shaped id by stripping the directory and extension; the synthetic `current` sentinel maps to `null`.

