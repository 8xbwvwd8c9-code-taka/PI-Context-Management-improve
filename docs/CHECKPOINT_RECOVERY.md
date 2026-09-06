# Checkpoint Recovery

## The model

```text
Work
→ durable Checkpoint
→ durable Minimal Handoff
→ recoverable History
```

A checkpoint is **durable project / session state**, not an LLM
narrative summary. It is designed to be loaded into a fresh
context window with no prior knowledge of the conversation.

## What recovery returns

`store.recover(projectId)` returns, in one call:

```ts
{
  projectId: string;
  metadata: ProjectMetadata | null;
  latestCheckpoint: Checkpoint | null;
  latestHandoff: MinimalHandoff | null;
  sessions: SessionSummary[];
  hasHistory: boolean;
  errors: string[];
}
```

All fields are deterministic. Recovery does not throw on
data-plane problems; it records them in `errors[]` and returns a
partial result.

## Recovery rules

| Condition | Behavior |
| --- | --- |
| No history for project | `hasHistory = false`; all fields `null`/empty |
| Ref missing | `errors[]` contains the ref-missing error; field is `null` |
| Record malformed (bad JSON) | `CheckpointIntegrityError` surfaced in `errors[]` |
| Integrity mismatch (hash wrong) | `CheckpointIntegrityError`; field is `null` |
| Unsupported schema_version | `CheckpointIntegrityError`; field is `null` |
| project_id mismatch | `CheckpointIntegrityError`; field is `null` |
| Ref opaque (no project in URI) | Caller must pass `projectId` to `read()` / `readById()` |

## Refs are opaque

A `cmv3://...` URI does **not** embed the project id. This is
explicit in R02 §8: opaque + no payload in id.

The caller MUST know the project id to resolve a ref. In normal
operation the project id is established when the store is opened
for a given project, and it is not derived from the ref.

## Where recovery runs

Recovery is a **library call** in S02. It is invoked by:

- the agent loop (when the user asks "where did I leave off?")
- S04 (the rollover orchestrator) — for natural + pressure rollover
- external automation (CI, scripts) that wants the latest state

It is NOT invoked automatically by any Pi lifecycle hook in S02.

## Sequence: a typical recovery

```text
1. identify project_id
   (from a stable seed — Git remote URL or path)
2. open store
3. call store.recover(projectId)
4. if hasHistory:
     - if status=IN_PROGRESS: hand the latest handoff to a fresh context
     - if status=COMPLETE: load the latest checkpoint + handoff as a resume
5. continue
```

## What is NOT recovered

The store does NOT pull every historical record into active
context. Recovery is **selective**. The caller chooses:

- `latestCheckpoint` (the most recent valid record)
- `latestHandoff` (the most recent valid minimal handoff)
- `sessions` (small summaries; full session records are loaded
  on demand)

Older history is available via `store.history.list(...)` and
`store.history.find(ref, projectId)`. The agent chooses which
references to recover.

## Failure modes

Recovery is fail-safe:

- it never silently substitutes an unrelated record
- it never deletes or rewrites history
- it never calls the LLM
- it never makes a network call
- it never throws on data-plane corruption (it records the error
  in `errors[]` and continues)

A caller that wants strict failure semantics can check
`recovery.errors.length === 0` and treat the result as
authoritative only when there are no errors.
