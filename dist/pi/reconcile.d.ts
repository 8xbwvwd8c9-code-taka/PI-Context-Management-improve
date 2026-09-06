/**
 * P04 — interrupted-rollover recovery.
 *
 * Authority: P04 WP (PICM_P04_INTERRUPTED_ROLLOVER_RECOVERY_IMPL).
 *
 * On Pi startup, find every RolloverRequest stuck in state
 * EXECUTING and try to reconcile it to a terminal state:
 *
 *   - COMPLETE: a durable PICM child session record exists and
 *     its `previous_session_ref` points at the old session, and
 *     the parent identity matches the rollover's old_session_id.
 *   - FAILED(new_session_failed): a Pi JSONL parentSession child
 *     exists (the new Pi session file was created and persisted
 *     by Pi itself) but the PICM durable linkage was never
 *     completed.
 *   - AMBIGUOUS: more than one candidate child (durable or
 *     JSONL); preserve EXECUTING and emit a diagnostic.
 *   - 0 durable AND 0 JSONL on startup → FAILED(new_session_failed):
 *     the rollover was interrupted before any side effect.
 *
 * Hard constraints:
 *
 *   - Reconciliation NEVER calls `ctx.newSession()`.
 *   - Reconciliation MUST only run when the caller gates it on
 *     `event.reason === "startup"` (see extension.ts). This
 *     module does NOT enforce the gate; it accepts an explicit
 *     `enabled` boolean instead. Tests can call it directly to
 *     drive the recovery logic.
 *   - On ANY exception the rollover is left EXECUTING and a
 *     bounded diagnostic is emitted; no sleeps, no retries, no
 *     timeouts.
 *   - SessionStore.list returns summaries without
 *     `previous_session_ref`; this module reads each summary via
 *     `readById` to inspect the field. The public SessionStore
 *     contract is NOT expanded.
 *   - The Pi JSONL scan is delegated to an injectable
 *     `JsonlParentScanner` so tests can drive the B branch
 *     deterministically. A thin filesystem-backed default is
 *     provided separately (see ./jsonl-parent-scanner.ts) and
 *     is NOT used by tests.
 *
 * The S04 state machine is untouched: this module only writes
 * transitions that the existing `RolloverStore.transition`
 * method allows (EXECUTING -> COMPLETE, EXECUTING -> FAILED).
 * No new state is added.
 */
import { type SessionStore } from "../store/session-store.js";
import type { Cmv3Store } from "../store/store.js";
import type { RolloverFailureCode } from "../core/index.js";
export type ReconcileAction =
   | {
        kind: "complete";
        newSessionId: string;
        rolloverId: string;
     }
   | {
        kind: "fail";
        failure_code: RolloverFailureCode;
        failure_detail: string;
        rolloverId: string;
     }
   | {
        kind: "ambiguous";
        rolloverId: string;
        candidateCount: number;
        source: "durable" | "jsonl";
     }
   | {
        kind: "noop";
        rolloverId: string;
     };
export interface ReconcileOutcome {
   readonly projectId: string;
   readonly oldSessionId: string;
   readonly scanned: number;
   readonly actions: readonly ReconcileAction[];
   readonly diagnostics: readonly ReconcileDiagnostic[];
}
export interface ReconcileDiagnostic {
   readonly level: "info" | "warning" | "error";
   readonly message: string;
   readonly rolloverId?: string;
}
/**
 * Injectable sink for diagnostics. The default in
 * extension.ts is a console-backed no-spam shim. Tests inject a
 * capturing sink.
 */
export interface DiagnosticSink {
   emit(diagnostic: ReconcileDiagnostic): void;
}
/**
 * Result of a single child-lookup. Encodes the ambiguity
 * decision for the durable and JSONL branches.
 */
export type ChildLookupResult =
   | {
        kind: "zero";
     }
   | {
        kind: "one";
        childId: string;
     }
   | {
        kind: "ambiguous";
        count: number;
     };
/**
 * Injectable JSONL parentSession scanner. The B branch of the
 * reconciliation decision is driven by this; a production
 * default scans `~/.pi/agent/sessions/*.jsonl` (or the equivalent
 * Pi runtime directory) for entries whose `parentSession` field
 * matches the rollover's old_session_id. The scanner returns a
 * list of NEW session ids (NOT the parent session id).
 *
 * Production wiring uses `createFsJsonlParentScanner` from
 * `./jsonl-parent-scanner.ts`; tests inject a stub that returns
 * a controlled set of ids.
 */
export interface JsonlParentScanner {
   /**
    * Find Pi session ids whose JSONL `parentSession` field
    * equals `oldSessionId`. Returned ids are Pi session
    * files/ids that Pi created as children of the old session.
    */
   findChildren(oldSessionId: string): readonly string[];
}
/**
 * Options for one reconciliation pass.
 */
export interface ReconcileInput {
   readonly projectId: string;
   readonly oldSessionId: string;
   readonly store: Cmv3Store;
   readonly jsonlScanner: JsonlParentScanner;
   readonly sink: DiagnosticSink;
   /**
    * Override `Date.now()` for tests. ISO-8601 string is
    * passed to the rollover store's `transition`.
    */
   readonly now?: () => string;
}
/**
 * Reconcile every EXECUTING RolloverRequest in `projectId` whose
 * `old_session_id` equals `oldSessionId`. The function is
 * side-effecting only on the rollover store (terminal
 * transitions) and on the JSONL scanner (read-only filesystem
 * scan via the injectable).
 *
 * Returns a `ReconcileOutcome` describing each candidate's
 * resolution. The caller is responsible for surfacing the
 * outcome's `diagnostics` to the user / observability layer.
 */
export declare function reconcileInterruptedRollovers(
   input: ReconcileInput,
): ReconcileOutcome;
interface FindDurableChildInput {
   readonly projectId: string;
   readonly oldSessionRef: string;
}
/**
 * Find durable PICM child session records whose
 * `previous_session_ref` equals `oldSessionRef`. The SessionStore
 * public surface is preserved: `list` returns summaries (no
 * `previous_session_ref`); we re-open each summary via
 * `readById` to inspect the field.
 */
export declare function findDurableChild(
   sessions: SessionStore,
   input: FindDurableChildInput,
): ChildLookupResult;
/**
 * Normalize a Pi session file path to the opaque id used in
 * `cmv3://session/<id>`. The S04 command does this when it
 * writes the durable child session record; we mirror the
 * normalization so the durable-lookup branch can match.
 *
 * The normalization rules:
 *   - strip everything up to and including the last "/"
 *   - strip the trailing ".json" extension
 *   - if the result is empty OR equals "current", return "" (no
 *     ref can be issued for these synthetic sentinels, so the
 *     durable-lookup branch never matches them).
 */
export declare function normalizeSessionId(raw: string): string;
/**
 * Construct the durable `cmv3://session/<id>` ref that the
 * durable child record's `previous_session_ref` is expected to
 * match. Returns null when the raw session identity is a
 * synthetic sentinel that cannot be ref-encoded; callers must
 * treat null as "no durable child can match this parent".
 */
export declare function previousSessionRefFor(raw: string): string | null;
/**
 * Console-backed diagnostic sink. Emits at most one line per
 * diagnostic; rate-limiting is the host process's
 * responsibility. Production wiring uses this sink in
 * extension.ts.
 */
export declare function consoleDiagnosticSink(): DiagnosticSink;
//# sourceMappingURL=reconcile.d.ts.map
