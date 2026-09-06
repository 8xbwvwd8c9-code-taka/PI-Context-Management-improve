/**
 * Atomic filesystem write helpers.
 *
 * Per R02 §10: authoritative records must be written
 *   serialize -> temp sibling -> flush/close -> atomic rename
 *
 * A failed write must not leave a record that appears valid. A ref
 * is issued only after the rename succeeded.
 *
 * We use `rename` on POSIX / `MoveFileEx` semantics on win32 (which
 * is what fs.renameSync already provides when source and target
 * are on the same filesystem). For cross-filesystem moves the
 * caller must pre-validate; we do not silently fall back.
 */
import { sep } from "node:path";
export interface AtomicWriteResult {
    /** Final authoritative path. */
    path: string;
    /** Bytes written. */
    bytes: number;
}
export declare class AtomicWriteError extends Error {
    readonly path: string;
    readonly cause?: unknown | undefined;
    constructor(message: string, path: string, cause?: unknown | undefined);
}
/**
 * Write `content` to `finalPath` atomically.
 *
 * Steps:
 *   1. ensure parent directory exists (mkdir -p)
 *   2. choose a temp sibling in the SAME directory as finalPath
 *   3. write the temp file (UTF-8, with a single trailing newline
 *      so logs and `cat` are friendlier)
 *   4. fsync the temp file
 *   5. rename to finalPath (atomic on the same filesystem)
 *
 * Throws AtomicWriteError on any failure; the caller must NOT
 * issue a ref in that case.
 */
export declare function atomicWriteFile(finalPath: string, content: string, options?: {
    mkdirMode?: number;
}): AtomicWriteResult;
/**
 * Ensure a directory exists with safe permissions. Best-effort on
 * platforms that do not support chmod (e.g. Windows); the call
 * does not throw if chmod is unsupported.
 */
export declare function ensureDir(dir: string, mode?: number): void;
export { sep as pathSeparator };
/**
 * Write raw bytes to `finalPath` atomically (binary-safe).
 *
 * S03 introduces this helper for the tool-result payload
 * artifact. The contract is identical to `atomicWriteFile`:
 *   1. ensure parent directory exists (mkdir -p)
 *   2. choose a temp sibling in the SAME directory
 *   3. write the temp file (raw bytes)
 *   4. rename to finalPath (atomic on the same filesystem)
 *
 * Throws AtomicWriteError on any failure; the caller must NOT
 * issue a ref in that case. The bytes are written as-is — UTF-8
 * decode is the caller's responsibility and never implicit.
 */
export declare function atomicWriteBytes(finalPath: string, bytes: Uint8Array, options?: {
    mkdirMode?: number;
    fileMode?: number;
}): AtomicWriteResult;
/**
 * Read raw bytes from `path` with a hard failure on error. Used
 * for full-byte tool-result recovery.
 */
export declare function readBytes(path: string): Uint8Array;
//# sourceMappingURL=atomic.d.ts.map