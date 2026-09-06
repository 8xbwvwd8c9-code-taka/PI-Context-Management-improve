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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const DEFAULT_PI_SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");
/**
 * Create a filesystem-backed scanner rooted at `sessionsDir`.
 * Defaults to `~/.pi/agent/sessions` (the canonical Pi runtime
 * location).
 */
export function createFsJsonlParentScanner(
  sessionsDir = DEFAULT_PI_SESSIONS_DIR,
) {
  return {
    findChildren(oldSessionId) {
      if (oldSessionId.length === 0) return [];
      if (!existsSync(sessionsDir)) return [];
      const matches = [];
      let entries;
      try {
        entries = readdirSync(sessionsDir);
      } catch {
        return [];
      }
      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue;
        const path = join(sessionsDir, entry);
        let firstLine;
        try {
          const raw = readFileSync(path, "utf8");
          const idx = raw.indexOf("\n");
          firstLine = idx === -1 ? raw : raw.slice(0, idx);
        } catch {
          continue;
        }
        let header;
        try {
          header = JSON.parse(firstLine);
        } catch {
          continue;
        }
        if (
          typeof header === "object" &&
          header !== null &&
          header.parentSession === oldSessionId
        ) {
          // The new session id is the file basename
          // without the .jsonl extension.
          matches.push(entry.replace(/\.jsonl$/, ""));
        }
      }
      return matches;
    },
  };
}
//# sourceMappingURL=jsonl-parent-scanner.js.map
