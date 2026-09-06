# PICM Tool-Result Virtualization (S03)

> WP: `CMV3-S03_TOOL_RESULT_VIRTUALIZATION`
> Status: **IMPLEMENTED** (data plane; no live Pi hook)
> Authority: `docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md` §8, §9, §10, §15.

S03 implements the **storage / data-plane mechanics** for
tool-result virtualization. Live Pi tool interception is explicitly
deferred to S04+ — S03 only attaches the durable store layer.

## Goal

Large tool results must not require permanent verbatim presence
in active context. The canonical lifecycle is:

```text
full tool result
  → durable persistence
  → integrity verification / opaque ref
  → bounded active representation
  → selective recovery on demand
```

The active representation is the only thing that lives in active
context; the full authoritative bytes are on disk behind the
ref.

## Hard invariants

1. **Persistence before bounding.** The full authoritative bytes
   are written to disk FIRST. The ref is issued only after both
   the payload artifact and the metadata artifact are on disk and
   the integrity envelope verifies. A failure at any stage
   triggers a rollback and a `ToolResultPersistenceError`; no ref
   is issued.

2. **No ref without durability.** Persistence failure never
   fabricates a `cmv3://tool/...` ref. The failure-mode active
   view is `ref=""`, `non_recoverable=true`, and a recorded
   reason.

3. **Tool output is untrusted data.** Payload bytes may contain
   text that looks like instructions ("ignore previous
   instructions", fake SYSTEM/DEVELOPER blocks, fake A2A
   reports). PICM never interprets payload text. The store
   never parses, summarizes, or extracts commands from the
   payload. Prompt-injection-looking payloads persist and
   recover as inert bytes; they cannot alter status, control
   flow, or metadata fields.

4. **Generic contract.** The store works for any byte payload:
   shell output, test logs, build output, JSON, binary blobs.
   No tool-specific string appears in paths, filenames, or
   refs.

5. **Project isolation.** A `cmv3://tool/<id>` ref does not
   embed the project id. Lookups are project-anchored. A ref
   minted in project A is not findable in project B.

6. **No LLM summarization.** The active view is a mechanical
   head + marker + tail window. There is no model call, no
   embedding, no semantic search.

7. **No native compaction.** S03 does not call `ctx.compact()`
   or modify `auto-compact.ts`. Native Pi compaction remains
   the emergency fallback.

## On-disk layout

```text
projects/<project-id>/
  tool-results/<id>/
    metadata.json     # integrity-sealed envelope, see below
    payload.bin       # the authoritative bytes (binary-safe)
  index/
    tool-results.jsonl  # derived index: metadata only, no payload
```

The directory name `<id>` is the same opaque id used in the ref.
The payload filename `payload.bin` carries no payload data. No
absolute project path appears anywhere in the layout.

## ToolResult record

`ToolResultMetadata` is the integrity-sealed content written to
`metadata.json`. The envelope shape is the same as for
checkpoints / handoffs / sessions (see `docs/STORAGE.md`):

```json
{
  "schema_version": "1.0.0",
  "content_sha256": "<sha256-hex>",
  "content": {
    "schema_version": "1.0.0",
    "tool_result_id": "id_...",
    "project_id": "proj_...",
    "session_id": "sess_...",
    "created_at": "2025-01-01T00:00:00.000Z",
    "tool_name": "exec",
    "tool_call_id": null,
    "result_kind": "text",
    "exit_code": 0,
    "success": true,
    "original_bytes": 32768,
    "stored_bytes": 32768,
    "active_excerpt_bytes": 4096,
    "truncated_in_active_view": true,
    "content_hash": "<sha256-hex>",
    "encoding": "utf-8",
    "mime_type": null,
    "ref": "cmv3://tool/<id>"
  }
}
```

The ref contains no payload, no command, no tool name, and no
absolute project path. Refs use the same `[a-z0-9_-]{8,128}`
alphabet as the other PICM ref families.

## Active view

The active view is a deterministic bounded representation:

```ts
interface ToolResultActiveView {
  ref: string;
  tool_name: string;
  tool_call_id: string | null;
  result_kind: string;
  success: boolean | null;
  exit_code: number | null;
  original_bytes: number;
  stored_bytes: number;
  active_excerpt_bytes: number;
  truncated: boolean;
  content_hash: string;
  mime_type: string | null;
  excerpt: string;
  excerpt_is_lossy: boolean;
}
```

The excerpt is one of:

- the full UTF-8 body, when the bytes fit in the budget;
- `head + marker + tail` when oversized, with the head and tail
  each byte-bounded;
- a safe lossy summary for non-UTF-8 binary payloads.

The default policy is `DEFAULT_ACTIVE_VIEW_POLICY`:
`maxExcerptBytes=4096`, `headBytes=2048`, `tailBytes=1980`,
`marker="…[truncated tool output; recover via ref]…"`. The
budget matches the `local_32k` profile's `output_reserve`; S04+
may rebind it from a profile.

## Range recovery

The store supports byte-range recovery without loading the
oversized payload into the returned object shape beyond the
slice itself. The range is `[start, end)` (0-based byte
offsets). The function re-reads the artifact, verifies the
SHA-256, then returns a subarray.

Invalid ranges throw `RangeError` synchronously before I/O:

- `start < 0`
- `end < start`
- `start > length` (range escapes artifact)
- `end > length` (range escapes artifact)

`start == length, end == length` is a permitted zero-byte
"past-EOF probe" (returns a 0-byte slice).

## Failure modes

`ToolResultPersistenceError` is thrown for any persistence
failure. The `stage` field is one of:

- `payload` — atomic binary write of `payload.bin` failed.
- `metadata` — metadata seal or atomic JSON write failed. The
  payload artifact is removed to keep the store consistent.
- `finalize` — index append failed. The authoritative record
  remains; the next read rebuilds the index.
- `unknown` — caller-side validation error (e.g. invalid input).

The failure-mode active view is exposed via
`store.toolResults.buildFailureView(bytes, toolName, reason)`:

```ts
{
  ref: "",
  non_recoverable: true,
  tool_name: "exec",
  original_bytes: 32768,
  excerpt: "...",
  reason: "metadata write failed"
}
```

The view never claims durability and never fabricates a ref.

## Security posture

- No command / payload / project path in filenames or refs.
- No payload bytes in the derived JSONL index.
- No payload bytes in the active view marker.
- No LLM access to the payload; the active view is a byte-level
  excerpt.
- No environment dumps; no secret extraction.
- Restrictive local permissions (0o700 dirs, 0o600 files) on
  the store root and per-record directories.

PICM does not claim encryption-at-rest. Local permissions are
the data-at-rest protection; further hardening is out of scope
for S03.

## What S03 does NOT do

S03 is the data plane only. It MUST NOT, in S03:

- intercept live Pi tool output
- automatically replace tool results in active context
- create a new Pi session
- execute rollover
- call `ctx.compact()` or otherwise touch native Pi compaction
- modify `auto-compact.ts` water marks
- register any Pi lifecycle hook
- introduce a database dependency
- introduce LLM summarization or vector search
- copy source code from any external repository

S04+ may wire live hooks after the data plane is proven.

## Portability

The store is portable. It is exercised in two synthetic
projects per WP acceptance test (PORTABILITY 39) and works
without any Git requirement (PORTABILITY 37). No host-project
identifier appears anywhere in `src/` (PORTABILITY 38) or the
public barrel (PORTABILITY 40).

## Tests

`tests/tool-result.test.ts` covers the S03 acceptance matrix
(46 numbered test cases) plus pure contract tests. The
existing S01 + S02 suite (140 tests) remains green.
