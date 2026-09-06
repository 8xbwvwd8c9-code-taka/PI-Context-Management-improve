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
export const SESSION_SCHEMA_VERSION = "1.0.0";
export const METADATA_SCHEMA_VERSION = "1.0.0";
/**
 * Stale-temp marker. We do NOT treat orphan temp files as
 * authoritative; they are an expected side-effect of process
 * termination. The store ignores them by name and an explicit
 * `recoverStaleTemps` helper can clean them up.
 */
export const STALE_TEMP_GLOB = ".tmp";
//# sourceMappingURL=records.js.map