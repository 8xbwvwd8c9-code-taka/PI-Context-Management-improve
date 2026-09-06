/**
 * Filesystem-backed Pi JSONL parentSession scanner.
 *
 * Authority: P04 WP (PICM_P04_INTERRUPTED_ROLLOVER_RECOVERY_IMPL).
 *
 * The default `JsonlParentScanner` for production wiring.
 * Scans the Pi session directory for JSONL files whose
 * `parentSession` field equals the supplied `oldSessionId`.
 *
 * Pi's session directory layout is `~/.pi/agent/sessions/*.jsonl`
 * (or the equivalent on the host); the field name is
 * `parentSession`. Each JSONL is an append-only log of one Pi
 * session; the first line carries the session header (which
 * contains `parentSession` when the session was forked or
 * replaced via `ctx.newSession()`).
 *
 * The scanner is intentionally cheap: it reads ONLY the first
 * line of each JSONL. It does NOT load the full conversation.
 *
 * The scanner NEVER throws: a corrupt or unreadable JSONL is
 * skipped silently so the reconciliation's outer try/catch
 * stays clean and EXECUTING rollovers are preserved.
 *
 * The scanner is NOT used by tests; tests inject a stub via
 * the `JsonlParentScanner` interface in `./reconcile.ts`.
 */
import type { JsonlParentScanner } from "./reconcile.js";
/**
 * Create a filesystem-backed scanner rooted at `sessionsDir`.
 * Defaults to `~/.pi/agent/sessions` (the canonical Pi runtime
 * location).
 */
export declare function createFsJsonlParentScanner(
 sessionsDir?: string,
): JsonlParentScanner;
//# sourceMappingURL=jsonl-parent-scanner.d.ts.map
