/**
 * Top-level CMV3 store façade.
 *
 * One `Cmv3Store` instance owns a `StoreLayout` and exposes the
 * individual record stores, history, and recovery helpers. S02
 * keeps the façade minimal; S04 (rollover) and S03 (tool-result
 * virtualization) will extend it.
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
	resolveConfig,
	type CMV3Config,
	type ResolvedCMV3Config,
} from "../core/config.js";
import {
	resolveStorePath,
	storeLayout,
	type StoreLayout,
} from "./paths.js";

import {
	createCheckpointStore,
	type CheckpointStore,
	type CheckpointSummary,
} from "./checkpoint-store.js";
import {
	createHandoffStore,
	type HandoffStore,
	type HandoffSummary,
} from "./handoff-store.js";
import {
	createProjectStore,
	type ProjectStore,
} from "./project-store.js";
import {
	createSessionStore,
	type SessionStore,
	type SessionSummary,
} from "./session-store.js";

import { History, type HistoryQuery } from "./history.js";
import {
	recoverLatestProjectState,
	type ProjectRecovery,
} from "./recovery.js";
import { rebuildIndex } from "./index-table.js";

export interface Cmv3Store {
	readonly config: ResolvedCMV3Config;
	readonly layout: StoreLayout;
	readonly checkpoints: CheckpointStore;
	readonly handoffs: HandoffStore;
	readonly sessions: SessionStore;
	readonly projects: ProjectStore;
	readonly history: History;
	recover(projectId: string): ProjectRecovery;
	rebuildAllIndexes(projectId: string): void;
}

export interface OpenStoreOptions {
	storagePath?: string;
	home?: string;
	config?: Partial<CMV3Config>;
}

export function openStore(options: OpenStoreOptions = {}): Cmv3Store {
	const home = options.home ?? process.env["HOME"] ?? "/";
	const storagePath = resolveStorePath(
		options.storagePath ?? process.env["CMV3_STORE_PATH"],
		home,
	);
	// Resolve config from caller input. storage_path is overridden
	// by the explicit `options.storagePath` (or env var) so the
	// caller can place the store outside the default home subdir.
	const baseConfig = options.config ?? {};
	const configInput: Partial<CMV3Config> = {
		...baseConfig,
		storage_path: storagePath,
	};
	const config = resolveConfig(configInput);
	const layout = storeLayout(storagePath);
	mkdirSync(layout.root, { recursive: true, mode: 0o700 });
	mkdirSync(layout.projectsRoot, { recursive: true, mode: 0o700 });

	const checkpoints = createCheckpointStore(layout);
	const handoffs = createHandoffStore(layout);
	const sessions = createSessionStore(layout);
	const projects = createProjectStore(layout);
	const history = new History(layout, { checkpoints, handoffs, sessions });

	return {
		config,
		layout,
		checkpoints,
		handoffs,
		sessions,
		projects,
		history,
		recover: (projectId) => recoverLatestProjectState(projects, checkpoints, handoffs, sessions, projectId),
		rebuildAllIndexes: (projectId) => rebuildAll(layout, projectId),
	};
}

/**
 * Re-scan authoritative records and rebuild the derived indexes.
 * The authoritative files (the .json records) are the source of
 * truth; the index files are deterministic projections of them.
 */
function safeReaddir(d: string): string[] {
	if (!existsSync(d)) return [];
	return readdirSync(d).filter((f) => f.endsWith(".json"));
}

export function rebuildAll(layout: StoreLayout, projectId: string): void {
	const projectRoot = join(layout.projectsRoot, projectId);
	if (!existsSync(projectRoot)) return;
	const ckpts = safeReaddir(join(projectRoot, "checkpoints"));
	const handoffs = safeReaddir(join(projectRoot, "handoffs"));
	const sessions = safeReaddir(join(projectRoot, "sessions"));

	// Import inline to avoid a circular dep at module init.
	const cp = createCheckpointStore(layout);
	const ho = createHandoffStore(layout);

	const cpEntries = ckpts.map((f) => {
		const id = f.replace(/\.json$/, "");
		const rec = cp.readById(projectId, id);
		return {
			ref: cp.refFor(projectId, id),
			id,
			work_package: rec.work_package,
			status: rec.status,
			created_at: rec.created_at,
			session_id: rec.session_id,
		};
	});
	rebuildIndex(layout, projectId, "checkpoints", cpEntries);

	const hoEntries = handoffs.map((f) => {
		const id = f.replace(/\.json$/, "");
		const rec = ho.readById(projectId, id);
		return {
			ref: ho.refFor(id),
			id,
			work_package: rec.work_package,
			status: rec.status,
		};
	});
	rebuildIndex(layout, projectId, "handoffs", hoEntries);

	const ssEntries = sessions.map((f) => {
		const id = f.replace(/\.json$/, "");
		return { ref: `cmv3://session/${id}`, id };
	});
	rebuildIndex(layout, projectId, "sessions", ssEntries);
}

export type { CheckpointSummary, HandoffSummary, SessionSummary, HistoryQuery };
