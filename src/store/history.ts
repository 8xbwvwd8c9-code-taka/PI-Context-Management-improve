/**
 * History query API.
 *
 * Per S02 spec:
 *   - list / get / find by project, type, work_package, status, time
 *   - exact ref resolution
 *   - deterministic ordering
 *   - no semantic / vector search
 *   - bounded, deterministic
 *
 * The history module is a thin layer over the per-record stores.
 * It does NOT restore arbitrary records into active context; the
 * caller selects explicitly.
 */

import {
	type CheckpointStore,
	type CheckpointSummary,
} from "./checkpoint-store.js";
import {
	type HandoffStore,
	type HandoffSummary,
} from "./handoff-store.js";
import {
	type SessionStore,
} from "./session-store.js";
import { type StoreLayout } from "./paths.js";

export type RecordKind = "checkpoint" | "handoff" | "session";

export interface HistoryQuery {
	projectId: string;
	kinds?: RecordKind[];
	workPackage?: string;
	status?: string;
	since?: string;
	until?: string;
}

export interface HistoryEntry {
	kind: RecordKind;
	id: string;
	ref: string;
	work_package?: string;
	status?: string;
	created_at?: string;
	started_at?: string;
}

export class History {
	constructor(
		_layout: StoreLayout,
		private readonly stores: {
			checkpoints: CheckpointStore;
			handoffs: HandoffStore;
			sessions: SessionStore;
		},
	) {}

	list(q: HistoryQuery): HistoryEntry[] {
		const kinds: RecordKind[] = q.kinds ?? ["checkpoint", "handoff", "session"];
		const out: HistoryEntry[] = [];

		if (kinds.includes("checkpoint")) {
			const cps = this.stores.checkpoints.list(q.projectId, {
				workPackage: q.workPackage,
				status: q.status as CheckpointSummary["status"] | undefined,
				since: q.since,
				until: q.until,
			});
			for (const c of cps) {
				out.push({
					kind: "checkpoint",
					id: c.id,
					ref: c.ref,
					work_package: c.work_package,
					status: c.status,
					created_at: c.created_at,
				});
			}
		}
		if (kinds.includes("handoff")) {
			const hs = this.stores.handoffs.list(q.projectId, {
				workPackage: q.workPackage,
				status: q.status as HandoffSummary["status"] | undefined,
			});
			for (const h of hs) {
				out.push({
					kind: "handoff",
					id: h.id,
					ref: h.ref,
					work_package: h.work_package,
					status: h.status,
				});
			}
		}
		if (kinds.includes("session")) {
			const ss = this.stores.sessions.list(q.projectId);
			for (const s of ss) {
				if (q.workPackage) continue; // sessions do not carry work_package
				if (q.status && s.status !== q.status) continue;
				if (q.since && s.started_at < q.since) continue;
				if (q.until && s.started_at > q.until) continue;
				out.push({
					kind: "session",
					id: s.id,
					ref: s.ref,
					status: s.status,
					started_at: s.started_at,
				});
			}
		}

		// Deterministic order: created_at desc (fallback to id desc).
		out.sort((a, b) => {
			const ax = a.created_at ?? a.started_at ?? "";
			const bx = b.created_at ?? b.started_at ?? "";
			if (ax !== bx) return ax < bx ? 1 : -1;
			return a.id < b.id ? 1 : -1;
		});
		return out;
	}

	get(ref: string): HistoryEntry | null {
		// Dispatch by URI scheme + kind prefix.
		if (ref.startsWith("cmv3://checkpoint/")) {
			const cps = this.stores.checkpoints;
			// The S02 API does not parse out the project from the
			// ref (refs are project-agnostic). The caller must call
			// the typed store when a project is in scope.
			void cps;
			return null;
		}
		return null;
	}

	/**
	 * Find by ref. Returns the parsed record (caller-side) by
	 * dispatching to the typed store. The projectId is required
	 * for ref -> record resolution because refs do not embed the
	 * project id (R02 §8: opaque + no payload in id).
	 */
	find(ref: string, projectId: string): HistoryEntry | null {
		if (ref.startsWith("cmv3://checkpoint/")) {
			const summaries = this.stores.checkpoints.list(projectId);
			const match = summaries.find((s) => s.ref === ref);
			if (!match) return null;
			return {
				kind: "checkpoint",
				id: match.id,
				ref: match.ref,
				work_package: match.work_package,
				status: match.status,
				created_at: match.created_at,
			};
		}
		if (ref.startsWith("cmv3://handoff/")) {
			const summaries = this.stores.handoffs.list(projectId);
			const match = summaries.find((s) => s.ref === ref);
			if (!match) return null;
			return {
				kind: "handoff",
				id: match.id,
				ref: match.ref,
				work_package: match.work_package,
				status: match.status,
			};
		}
		if (ref.startsWith("cmv3://session/")) {
			const sessions = this.stores.sessions.list(projectId);
			const match = sessions.find((s) => s.ref === ref);
			if (!match) return null;
			return {
				kind: "session",
				id: match.id,
				ref: match.ref,
				status: match.status,
				started_at: match.started_at,
			};
		}
		return null;
	}
}
