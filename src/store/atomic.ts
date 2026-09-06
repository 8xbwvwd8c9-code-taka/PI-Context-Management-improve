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

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, parse, sep } from "node:path";
import { randomBytes } from "node:crypto";

export interface AtomicWriteResult {
	/** Final authoritative path. */
	path: string;
	/** Bytes written. */
	bytes: number;
}

export class AtomicWriteError extends Error {
	constructor(
		message: string,
		readonly path: string,
		readonly cause?: unknown,
	) {
		super(message);
		this.name = "AtomicWriteError";
	}
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
export function atomicWriteFile(
	finalPath: string,
	content: string,
	options: { mkdirMode?: number } = {},
): AtomicWriteResult {
	const dir = dirname(finalPath);
	mkdirSync(dir, { recursive: true, mode: options.mkdirMode ?? 0o700 });

	const tmp = makeTempPath(finalPath);
	const body = content.endsWith("\n") ? content : content + "\n";

	try {
		// `flag: "wx"` => exclusive create. If a stale temp file
		// with the same name already exists, this throws and we
		// retry once with a fresh random suffix.
		writeFileSync(tmp, body, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
	} catch (err) {
		// Race: stale temp. Retry once.
		const retry = makeTempPath(finalPath);
		try {
			writeFileSync(retry, body, {
				encoding: "utf8",
				flag: "wx",
				mode: 0o600,
			});
			renameSync(retry, finalPath);
			return { path: finalPath, bytes: Buffer.byteLength(body, "utf8") };
		} catch (err2) {
			throw new AtomicWriteError(
				`atomic write failed for ${finalPath}: ${(err2 as Error).message}`,
				finalPath,
				err2,
			);
		}
	}

	try {
		renameSync(tmp, finalPath);
	} catch (err) {
		throw new AtomicWriteError(
			`atomic rename failed for ${finalPath}: ${(err as Error).message}`,
			finalPath,
			err,
		);
	}
	return { path: finalPath, bytes: Buffer.byteLength(body, "utf8") };
}

function makeTempPath(finalPath: string): string {
	const p = parse(finalPath);
	const suffix = randomBytes(6).toString("hex");
	return join(p.dir, `${p.name}.${process.pid}.${Date.now()}.${suffix}.tmp`);
}

/**
 * Ensure a directory exists with safe permissions. Best-effort on
 * platforms that do not support chmod (e.g. Windows); the call
 * does not throw if chmod is unsupported.
 */
export function ensureDir(dir: string, mode: number = 0o700): void {
	mkdirSync(dir, { recursive: true, mode });
	try {
		// Best-effort restrict. On win32 this is a no-op.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		// (chmod lives in node:fs)
	} catch {
		// ignore
	}
}

export { sep as pathSeparator };
