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
import { closeSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const DEFAULT_PI_SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");
export const DEFAULT_MAX_JSONL_HEADER_BYTES = 64 * 1024;
const DEFAULT_MAX_SCAN_ENTRIES = 10_000;
/**
 * Create a filesystem-backed scanner rooted at `sessionsDir`.
 * Defaults to `~/.pi/agent/sessions` (the canonical Pi runtime
 * location).
 */
export function createFsJsonlParentScanner(sessionsDir = DEFAULT_PI_SESSIONS_DIR, options = {}) {
    const readdir = options.readdir ?? ((path) => readdirSync(path, { withFileTypes: true }));
    const read = options.read ?? readSync;
    const maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_MAX_JSONL_HEADER_BYTES;
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_SCAN_ENTRIES;
    return {
        findChildren(oldSessionId) {
            if (oldSessionId.length === 0) {
                return { kind: "complete", children: [] };
            }
            try {
                const root = lstatSync(sessionsDir);
                if (root.isSymbolicLink() || !root.isDirectory()) {
                    return incomplete(`sessions root is not a real directory: ${sessionsDir}`);
                }
            }
            catch (error) {
                if (isMissing(error))
                    return { kind: "complete", children: [] };
                return incomplete(`cannot inspect sessions root ${sessionsDir}: ${errorMessage(error)}`);
            }
            const matches = new Set();
            const pending = [sessionsDir];
            let visited = 0;
            while (pending.length > 0) {
                const directory = pending.shift();
                let entries;
                try {
                    entries = [...readdir(directory)].sort((a, b) => a.name.localeCompare(b.name));
                }
                catch (error) {
                    return incomplete(`cannot read ${directory}: ${errorMessage(error)}`);
                }
                for (const entry of entries) {
                    visited += 1;
                    if (visited > maxEntries)
                        return incomplete(`scan exceeds ${maxEntries} entries`);
                    if (entry.isSymbolicLink())
                        return incomplete(`symlink encountered during scan: ${join(directory, entry.name)}`);
                    const path = join(directory, entry.name);
                    if (entry.isDirectory()) {
                        pending.push(path);
                        continue;
                    }
                    if (!entry.isFile() || !entry.name.endsWith(".jsonl"))
                        continue;
                    const headerResult = readHeader(path, maxHeaderBytes, read);
                    if (headerResult.kind === "incomplete")
                        return headerResult;
                    let header;
                    try {
                        header = JSON.parse(headerResult.header);
                    }
                    catch (error) {
                        return incomplete(`invalid JSONL header in ${path}: ${errorMessage(error)}`);
                    }
                    if (typeof header === "object" && header !== null &&
                        header.parentSession === oldSessionId) {
                        matches.add(entry.name.replace(/\.jsonl$/, ""));
                    }
                }
            }
            return { kind: "complete", children: [...matches].sort() };
        },
    };
}
function readHeader(path, maxBytes, read) {
    let fd;
    let result;
    try {
        fd = openSync(path, "r");
        const buffer = Buffer.alloc(maxBytes + 1);
        const count = read(fd, buffer, 0, buffer.length, 0);
        const newline = buffer.subarray(0, count).indexOf(0x0a);
        if (newline === -1 && count > maxBytes) {
            result = incomplete(`JSONL header exceeds ${maxBytes} bytes in ${path}`);
        }
        else {
            const end = newline === -1 ? count : newline;
            result = { kind: "complete", header: buffer.toString("utf8", 0, end) };
        }
    }
    catch (error) {
        result = incomplete(`cannot read ${path}: ${errorMessage(error)}`);
    }
    finally {
        if (fd !== undefined) {
            try {
                closeSync(fd);
            }
            catch (error) {
                result = incomplete(`cannot close ${path}: ${errorMessage(error)}`);
            }
        }
    }
    return result;
}
function incomplete(detail) {
    return { kind: "incomplete", detail: detail.slice(0, 400) };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function isMissing(error) {
    return typeof error === "object" && error !== null &&
        "code" in error && error.code === "ENOENT";
}
//# sourceMappingURL=jsonl-parent-scanner.js.map