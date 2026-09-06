/**
 * Durable record types for the CMV3 store.
 *
 * Each authoritative record is an IntegrityEnvelope wrapping the
 * R02 contract content. The envelope is what gets persisted; the
 * content is what gets returned to the consumer after verify().
 *
 * Records are independent of any Pi session implementation: the
 * portable core only consumes opaque ids.
 */
import type { Checkpoint, MinimalHandoff } from "../core/index.js";
export declare const SESSION_SCHEMA_VERSION: "1.0.0";
export declare const METADATA_SCHEMA_VERSION: "1.0.0";
export interface SessionRecord {
    schema_version: typeof SESSION_SCHEMA_VERSION;
    session_id: string;
    project_id: string;
    started_at: string;
    ended_at?: string;
    status: "OPEN" | "CLOSED" | "ORPHANED";
    checkpoint_refs: string[];
    handoff_refs: string[];
    previous_session_ref?: string;
    next_session_ref?: string;
}
export type ProjectAdapterKind = "generic" | "git";
export interface ProjectMetadata {
    schema_version: typeof METADATA_SCHEMA_VERSION;
    project_id: string;
    adapter_kind: ProjectAdapterKind;
    repo_remote?: string | null;
    last_seen_branch?: string | null;
    last_seen_head?: string | null;
    latest_checkpoint_ref?: string | null;
    latest_handoff_ref?: string | null;
    updated_at: string;
    created_at: string;
}
export type { Checkpoint, MinimalHandoff };
/**
 * Stale-temp marker. We do NOT treat orphan temp files as
 * authoritative; they are an expected side-effect of process
 * termination. The store ignores them by name and an explicit
 * `recoverStaleTemps` helper can clean them up.
 */
export declare const STALE_TEMP_GLOB = ".tmp";
//# sourceMappingURL=records.d.ts.map