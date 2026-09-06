/**
 * Project metadata store.
 *
 * Per S02 spec:
 *   - persist only minimal metadata required for recovery
 *   - project_id
 *   - adapter_kind (generic | git)
 *   - repo identity if available
 *   - last_seen_branch / last_seen_head
 *   - latest_checkpoint_ref / latest_handoff_ref
 *   - updated_at
 *   - no secrets
 *
 * Project id is a derived opaque id (see ids.ts). The
 * metadata.json is itself authoritative and atomic.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { atomicWriteFile, ensureDir } from "./atomic.js";
import {
	canonicalJsonStringify,
	seal,
	verify,
	type IntegrityEnvelope,
} from "./integrity.js";
import { metadataPath, type StoreLayout } from "./paths.js";
import type { ProjectMetadata } from "./records.js";

export interface ProjectStore {
	read(projectId: string): ProjectMetadata | null;
	write(metadata: ProjectMetadata): ProjectMetadata;
	update(
		projectId: string,
		patch: Partial<Omit<ProjectMetadata, "schema_version" | "project_id" | "created_at">>,
	): ProjectMetadata;
}

export class ProjectMetadataIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProjectMetadataIntegrityError";
	}
}

export function createProjectStore(layout: StoreLayout): ProjectStore {
	return new FsProjectStore(layout);
}

class FsProjectStore implements ProjectStore {
	constructor(private readonly layout: StoreLayout) {}

	read(projectId: string): ProjectMetadata | null {
		const path = metadataPath(this.layout, projectId);
		if (!existsSync(path)) return null;
		let raw: string;
		try {
			raw = readFileSync(path, "utf8");
		} catch (err) {
			throw new ProjectMetadataIntegrityError(
				`cannot read project metadata ${projectId}: ${(err as Error).message}`,
			);
		}
		let envelope: IntegrityEnvelope<unknown>;
		try {
			envelope = JSON.parse(raw) as IntegrityEnvelope<unknown>;
		} catch (err) {
			throw new ProjectMetadataIntegrityError(
				`project metadata ${projectId} is not valid JSON: ${(err as Error).message}`,
			);
		}
		if (envelope.schema_version !== "1.0.0") {
			throw new ProjectMetadataIntegrityError(
				`project metadata ${projectId} has unsupported schema_version ${envelope.schema_version}`,
			);
		}
		const content = verify(envelope) as ProjectMetadata;
		if (content.project_id !== projectId) {
			throw new ProjectMetadataIntegrityError(
				`project id mismatch: file ${projectId} but content says ${content.project_id}`,
			);
		}
		return content;
	}

	write(metadata: ProjectMetadata): ProjectMetadata {
		validateMetadata(metadata);
		const envelope = seal(metadata, metadata.schema_version);
		const body = canonicalJsonStringify(envelope);
		const path = metadataPath(this.layout, metadata.project_id);
		ensureDir(join(this.layout.projectsRoot, metadata.project_id));
		atomicWriteFile(path, body);
		return metadata;
	}

	update(
		projectId: string,
		patch: Partial<Omit<ProjectMetadata, "schema_version" | "project_id" | "created_at">>,
	): ProjectMetadata {
		const current = this.read(projectId);
		const now = new Date().toISOString();
		const merged: ProjectMetadata = current
			? { ...current, ...patch, updated_at: now }
			: {
					schema_version: "1.0.0",
					project_id: projectId,
					adapter_kind: (patch.adapter_kind ?? "generic") as "generic" | "git",
					repo_remote: patch.repo_remote ?? null,
					last_seen_branch: patch.last_seen_branch ?? null,
					last_seen_head: patch.last_seen_head ?? null,
					latest_checkpoint_ref: patch.latest_checkpoint_ref ?? null,
					latest_handoff_ref: patch.latest_handoff_ref ?? null,
					updated_at: now,
					created_at: now,
				};
		return this.write(merged);
	}
}

function validateMetadata(m: ProjectMetadata): void {
	if (typeof m !== "object" || m === null) {
		throw new Error("project metadata must be an object");
	}
	if (m.schema_version !== "1.0.0") {
		throw new Error(`project metadata: unsupported schema_version ${m.schema_version}`);
	}
	if (typeof m.project_id !== "string" || m.project_id.length === 0) {
		throw new Error("project metadata: missing project_id");
	}
	if (!["generic", "git"].includes(m.adapter_kind)) {
		throw new Error(`project metadata: invalid adapter_kind ${m.adapter_kind}`);
	}
	for (const k of [
		"repo_remote",
		"last_seen_branch",
		"last_seen_head",
		"latest_checkpoint_ref",
		"latest_handoff_ref",
	] as const) {
		const v = (m as unknown as Record<string, unknown>)[k];
		if (v != null && typeof v !== "string") {
			throw new Error(`project metadata: ${k} must be string or null`);
		}
	}
}
