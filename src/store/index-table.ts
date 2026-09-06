/**
 * Append-only JSONL index for the CMV3 store.
 *
 * Per R02 §10 / S02:
 *   - the index is derived data
 *   - the authoritative records (the .json files) are the source
 *     of truth
 *   - the index is rebuildable from the authoritative files
 *
 * A failure to append to the index does NOT delete the
 * authoritative record. On the next read the index is rebuilt
 * if it is missing / corrupted.
 */

import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ensureDir } from "./atomic.js";
import { indexPath, type StoreLayout } from "./paths.js";

export interface IndexEntry {
	ref: string;
	id: string;
}

export function appendIndexEntry<T extends IndexEntry>(
	layout: StoreLayout,
	projectId: string,
	kind: "checkpoints" | "handoffs" | "sessions",
	entry: T,
): void {
	const path = indexPath(layout, projectId, kind);
	ensureDir(join(layout.projectsRoot, projectId, "index"));
	appendFileSync(path, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
}

export function readIndex<T extends IndexEntry>(
	layout: StoreLayout,
	projectId: string,
	kind: "checkpoints" | "handoffs" | "sessions",
): T[] {
	const path = indexPath(layout, projectId, kind);
	if (!existsSync(path)) return [];
	const raw = readFileSync(path, "utf8");
	const out: T[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			out.push(JSON.parse(trimmed) as T);
		} catch {
			// Skip malformed lines; the index is rebuildable.
		}
	}
	return out;
}

export function rebuildIndex<T extends IndexEntry>(
	layout: StoreLayout,
	projectId: string,
	kind: "checkpoints" | "handoffs" | "sessions",
	entries: T[],
): void {
	const path = indexPath(layout, projectId, kind);
	ensureDir(join(layout.projectsRoot, projectId, "index"));
	// Sort for determinism: ref ascending, then id ascending.
	const sorted = [...entries].sort((a, b) => {
		if (a.ref !== b.ref) return a.ref < b.ref ? -1 : 1;
		return a.id < b.id ? -1 : 1;
	});
	const body = sorted.map((e) => JSON.stringify(e)).join("\n") + (sorted.length > 0 ? "\n" : "");
	writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
}

export function clearIndex(
	layout: StoreLayout,
	projectId: string,
	kind: "checkpoints" | "handoffs" | "sessions",
): void {
	const path = indexPath(layout, projectId, kind);
	if (existsSync(path)) {
		unlinkSync(path);
	}
}
