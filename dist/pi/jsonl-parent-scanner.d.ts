/**
 * Filesystem-backed Pi JSONL parentSession scanner.
 *
 * Authority: P04 WP (PICM_P04_INTERRUPTED_ROLLOVER_RECOVERY_IMPL).
 *
 * The default `JsonlParentScanner` for production wiring.
 * Scans the Pi session directory for JSONL files whose
 * `parentSession` field equals the supplied `oldSessionId`.
 *
 * Pi's session directory layout nests per-project directories beneath
 * `~/.pi/agent/sessions` (or the equivalent on the host); the field name is
 * `parentSession`. Each JSONL is an append-only log of one Pi
 * session; the first line carries the session header (which
 * contains `parentSession` when the session was forked or
 * replaced via `ctx.newSession()`).
 *
 * The scanner is intentionally cheap: it reads ONLY the first
 * line of each JSONL. It does NOT load the full conversation.
 *
 * The scanner reports corrupt, unreadable, oversized, or partially traversed
 * evidence as `incomplete`, so reconciliation preserves EXECUTING.
 *
 * Tests use both this implementation with injected reads and stubs through
 * the `JsonlParentScanner` interface in `./reconcile.ts`.
 */
import { readSync } from "node:fs";
import type { JsonlParentScanner } from "./reconcile.js";
export declare const DEFAULT_MAX_JSONL_HEADER_BYTES: number;
interface ScannerDirEntry {
    readonly name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
}
export interface JsonlScannerOptions {
    readonly maxHeaderBytes?: number;
    readonly maxEntries?: number;
    readonly readdir?: (path: string) => readonly ScannerDirEntry[];
    readonly read?: typeof readSync;
}
/**
 * Create a filesystem-backed scanner rooted at `sessionsDir`.
 * Defaults to `~/.pi/agent/sessions` (the canonical Pi runtime
 * location).
 */
export declare function createFsJsonlParentScanner(sessionsDir?: string, options?: JsonlScannerOptions): JsonlParentScanner;
export {};
//# sourceMappingURL=jsonl-parent-scanner.d.ts.map