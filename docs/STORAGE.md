# CMV3 Storage

## Overview

The CMV3 store is a **local-first filesystem library** that gives
the portable package durable state outside the active prompt.

It implements:

- durable **checkpoints** (R02 §6)
- durable **minimal handoffs** (R02 §7)
- durable **session records** (S02)
- durable **project metadata**
- a deterministic **history index** (rebuildable)
- a deterministic **recovery** API

It does **not**:

- intercept Pi tool calls (S03)
- automatically trigger checkpoints (Pi integration comes later)
- create a new Pi session (S04)
- call `ctx.compact()` or otherwise replace native Pi compaction

## Default location

The store lives outside any target Git repository by default.

```text
~/.pi/cmv3/
  projects/<opaque-project-id>/
    metadata.json
    checkpoints/<id>.json
    handoffs/<id>.json
    sessions/<id>.json
    index/
      checkpoints.jsonl
      handoffs.jsonl
      sessions.jsonl
```

`<opaque-project-id>` is a SHA-256-derived identifier (no absolute
path, no host info). The store root never embeds the target
project's absolute path.

## Override

The store path can be overridden via:

- `openStore({ storagePath })` (programmatic)
- `CMV3_STORE_PATH` (env var)
- `config.storage_path` (config file, future)

## File formats

Authoritative records are **JSON envelopes**:

```json
{
  "schema_version": "1.0.0",
  "content_sha256": "<sha256-hex>",
  "content": { ... }
}
```

The hash is computed over `canonicalJsonStringify(content)`.
Canonicalization sorts object keys recursively to make the hash
stable across serialization orderings.

Index files are **JSONL** (one entry per line). Each line is a
small record with `ref`, `id`, and kind-specific metadata. Index
files are derived data: they can be deleted and rebuilt from the
authoritative records.

## Atomicity

Authoritative writes are atomic via the standard
**temp-write + rename** pattern:

```text
serialize canonical content
→ write to <path>.<pid>.<ts>.<rand>.tmp (exclusive create)
→ fsync
→ fs.renameSync(tmp, final)
```

If any step throws, no authoritative file is created and no ref
is issued.

A failed write never leaves a record that appears valid.

## Integrity

Every authoritative record carries a `content_sha256` over the
canonicalized `content`. Recovery verifies the hash before
returning the record. A mismatch raises a typed
`CheckpointIntegrityError` / `HandoffIntegrityError` /
`SessionIntegrityError` / `ProjectMetadataIntegrityError`.

## Refs

Refs are the S01 opaque URIs. The S02 store introduces one new
family:

```text
cmv3://handoff/<id>
```

Justification (per R02 change-control rule, §17): handoffs are
independently recoverable durable records, not sub-records of a
checkpoint. Keeping them under the `checkpoint` family would
prevent separate retention / indexing and lose the distinction.
The existing `tool` / `checkpoint` / `session` / `file` syntax is
unchanged.

## Project identity

`projectIdFromSeed(seed)` hashes the seed with SHA-256 and emits
an opaque id (`proj_xxxxxxxxxx`). The seed is a stable string
provided by the caller — typically a Git remote URL for Git
projects, or a normalized absolute path for non-Git projects.

The store does not depend on the cwd; the same seed always
produces the same id, on any host.

## Recovery

`recoverLatestProjectState(projectId)` returns:

- `metadata` — the project metadata, or `null` if none
- `latestCheckpoint` — the latest valid checkpoint, or `null`
- `latestHandoff` — the latest valid handoff, or `null`
- `sessions` — list of session records for the project
- `hasHistory` — boolean
- `errors[]` — list of errors that were caught (recovery is
  fail-safe and never throws on data problems; it surfaces them
  in `errors[]`)

Recovery is **synchronous, pure data plane, no LLM**.

## Index rebuild

If a `*.jsonl` index file is corrupted or missing:

```ts
store.rebuildAllIndexes(projectId);
```

This walks the authoritative files and rewrites the index in
sorted order. The authoritative files are the source of truth;
the index can always be reconstructed from them.

## What is NOT in S02

- tool-result persistence (S03)
- automatic rollover (S04)
- live Pi lifecycle hooks (always off until S04)
- a CLI / daemon
- encryption-at-rest
- network sync

## Security & privacy

- Refs contain only opaque ids (`cmv3://<kind>/<id>`)
- Filenames are the opaque id plus `.json`
- Files are written with `0o600` (POSIX); the store root is `0o700`
- No environment variables, API keys, or auth tokens are persisted
- Tool results are NOT persisted in S02 (S03 will land durable
  tool-result virtualization behind explicit refs)
- Logs are not emitted by the store; the package surface has no
  `logBody` method
