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
import { type StoreLayout } from "./paths.js";
import type { ProjectMetadata } from "./records.js";
export interface ProjectStore {
    read(projectId: string): ProjectMetadata | null;
    write(metadata: ProjectMetadata): ProjectMetadata;
    update(projectId: string, patch: Partial<Omit<ProjectMetadata, "schema_version" | "project_id" | "created_at">>): ProjectMetadata;
}
export declare class ProjectMetadataIntegrityError extends Error {
    constructor(message: string);
}
export declare function createProjectStore(layout: StoreLayout): ProjectStore;
//# sourceMappingURL=project-store.d.ts.map