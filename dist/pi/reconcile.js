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
 *   - Reconciliation enumerates authoritative session records and reads each
 *     through `readById`, keeping ordinary SessionStore.list semantics intact
 *     while preventing unreadable evidence from becoming a false zero.
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
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { SESSION_REF_KIND } from "../store/session-store.js";
/* -------------------------------------------------------------------- *
 * Public entry point                                                    *
 * -------------------------------------------------------------------- */
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
export function reconcileInterruptedRollovers(input) {
    const diagnostics = [];
    const actions = [];
    const { projectId, oldSessionId, store, jsonlScanner, sink } = input;
    const now = input.now ?? (() => new Date().toISOString());
    let scanned = 0;
    try {
        const executing = listExecutingRollovers(store, projectId);
        scanned = executing.length;
        for (const rollover of executing) {
            const action = reconcileOne(rollover, {
                projectId,
                oldSessionId,
                store,
                jsonlScanner,
                now,
            });
            actions.push(action);
            if (action.kind === "incomplete") {
                const diag = {
                    level: "error",
                    message: `P04 reconciliation: incomplete ${action.source} evidence for rollover ${action.rolloverId} ` +
                        `(${action.detail}); rollover left EXECUTING.`,
                    rolloverId: action.rolloverId,
                };
                diagnostics.push(diag);
                sink.emit(diag);
            }
            else if (action.kind === "ambiguous") {
                const diag = {
                    level: "warning",
                    message: `P04 reconciliation: ambiguous candidates for rollover ${action.rolloverId} ` +
                        `(source=${action.source}, count=${action.candidateCount}); ` +
                        `rollover left EXECUTING.`,
                    rolloverId: action.rolloverId,
                };
                diagnostics.push(diag);
                sink.emit(diag);
            }
            else if (action.kind === "fail") {
                const diag = {
                    level: "info",
                    message: `P04 reconciliation: rollover ${action.rolloverId} marked FAILED ` +
                        `(${action.failure_code}; ${action.failure_detail}).`,
                    rolloverId: action.rolloverId,
                };
                diagnostics.push(diag);
                sink.emit(diag);
            }
            else if (action.kind === "complete") {
                const diag = {
                    level: "info",
                    message: `P04 reconciliation: rollover ${action.rolloverId} marked COMPLETE ` +
                        `(new_session_id=${action.newSessionId}).`,
                    rolloverId: action.rolloverId,
                };
                diagnostics.push(diag);
                sink.emit(diag);
            }
        }
    }
    catch (err) {
        // Per WP: catch, preserve EXECUTING, emit bounded
        // diagnostic. NO retry, NO sleeps, NO timeouts.
        const message = err instanceof Error ? err.message : String(err);
        const diag = {
            level: "error",
            message: `P04 reconciliation: exception during scan: ${message}. ` +
                `EXECUTING rollovers preserved; no terminal transition.`,
        };
        diagnostics.push(diag);
        sink.emit(diag);
        // Actions already pushed for completed branches are
        // kept (they were each guarded individually). The
        // outcome is returned with the actions as-of the
        // exception point.
    }
    return { projectId, oldSessionId, scanned, actions, diagnostics };
}
function reconcileOne(rollover, ctx) {
    // Identity gate (T-P04-04, policy C of WP):
    //   - rollover.old_session_id == ctx.oldSessionId: identity
    //     matches the live session → proceed to A/B branches.
    //   - rollover.old_session_id != ctx.oldSessionId AND both
    //     are non-empty AND both normalize to non-empty refs
    //     AND the normalized forms differ: identity is
    //     PROVEN mismatched (we know what the live session is,
    //     and the rollover claims a different parent).
    //     → FAILED(session_mismatch).
    //   - rollover.old_session_id is empty OR unresolvable
    //     ("current", etc.) OR ctx.oldSessionId is empty OR
    //     unresolvable: identity mapping itself is ambiguous.
    //     → leave EXECUTING (cannot prove mismatch).
    const rolloverOld = rollover.old_session_id ?? "";
    const liveOld = ctx.oldSessionId;
    const rolloverRef = previousSessionRefFor(rolloverOld);
    const liveRef = previousSessionRefFor(liveOld);
    if (rolloverRef !== null && liveRef !== null && rolloverRef !== liveRef) {
        // Proven identity mismatch.
        try {
            ctx.store.rollovers.transition({
                projectId: ctx.projectId,
                ref: ctx.store.rollovers.refFor(rollover.rollover_request_id),
                to: "FAILED",
                failureCode: "session_mismatch",
                failureDetail: `rollover old_session_id ${rolloverOld} does not match live ${liveOld}`,
                now: ctx.now(),
            });
            return {
                kind: "fail",
                failure_code: "session_mismatch",
                failure_detail: `rollover old_session_id ${rolloverOld} does not match live ${liveOld}`,
                rolloverId: rollover.rollover_request_id,
            };
        }
        catch {
            return {
                kind: "noop",
                rolloverId: rollover.rollover_request_id,
            };
        }
    }
    if (rolloverRef === null || liveRef === null) {
        // Identity mapping is ambiguous / unresolvable.
        // Per WP policy C: leave EXECUTING.
        return {
            kind: "noop",
            rolloverId: rollover.rollover_request_id,
        };
    }
    // A. Durable PICM child records.
    let durableLookup;
    try {
        durableLookup = findDurableChild(ctx.store.sessions, {
            projectId: ctx.projectId,
            layout: ctx.store.layout,
            oldSessionRef: liveRef,
            checkpointRef: rollover.checkpoint_ref,
            handoffRef: rollover.handoff_ref,
        });
    }
    catch (error) {
        // Incomplete durable evidence cannot authorize a terminal
        // transition, even if the JSONL source remains readable.
        return {
            kind: "incomplete",
            rolloverId: rollover.rollover_request_id,
            detail: `durable scan failed: ${boundedError(error)}`,
            source: "durable",
        };
    }
    if (durableLookup.kind === "ambiguous") {
        return {
            kind: "ambiguous",
            rolloverId: rollover.rollover_request_id,
            candidateCount: durableLookup.count,
            source: "durable",
        };
    }
    if (durableLookup.kind === "incomplete") {
        return {
            kind: "incomplete",
            rolloverId: rollover.rollover_request_id,
            detail: durableLookup.detail,
            source: "durable",
        };
    }
    if (durableLookup.kind === "one") {
        // Single durable PICM child: prove the rollover
        // succeeded and transition to COMPLETE. The
        // identity is already checked (previous_session_ref
        // matches the old session id); we still require the
        // rollover's own old_session_id to match.
        try {
            const updated = ctx.store.rollovers.transition({
                projectId: ctx.projectId,
                ref: ctx.store.rollovers.refFor(rollover.rollover_request_id),
                to: "COMPLETE",
                newSessionId: durableLookup.childId,
                now: ctx.now(),
            });
            return {
                kind: "complete",
                newSessionId: updated.new_session_id ?? durableLookup.childId,
                rolloverId: rollover.rollover_request_id,
            };
        }
        catch {
            // Transition failure (state machine rejected
            // the move). Preserve EXECUTING.
            return {
                kind: "noop",
                rolloverId: rollover.rollover_request_id,
            };
        }
    }
    // B. Pi JSONL parentSession scan.
    let jsonlLookup;
    try {
        const scan = ctx.jsonlScanner.findChildren(ctx.oldSessionId);
        if (scan.kind === "incomplete") {
            return {
                kind: "incomplete",
                rolloverId: rollover.rollover_request_id,
                detail: scan.detail,
                source: "jsonl",
            };
        }
        jsonlLookup = classifyChildren(scan.children);
    }
    catch (error) {
        return {
            kind: "incomplete",
            rolloverId: rollover.rollover_request_id,
            detail: `JSONL scan failed: ${boundedError(error)}`,
            source: "jsonl",
        };
    }
    if (jsonlLookup.kind === "ambiguous") {
        return {
            kind: "ambiguous",
            rolloverId: rollover.rollover_request_id,
            candidateCount: jsonlLookup.count,
            source: "jsonl",
        };
    }
    if (jsonlLookup.kind === "one") {
        try {
            ctx.store.rollovers.transition({
                projectId: ctx.projectId,
                ref: ctx.store.rollovers.refFor(rollover.rollover_request_id),
                to: "FAILED",
                failureCode: "new_session_failed",
                failureDetail: "ghost child exists but S04 durable session linkage never completed",
                now: ctx.now(),
            });
            return {
                kind: "fail",
                failure_code: "new_session_failed",
                failure_detail: "ghost child exists but S04 durable session linkage never completed",
                rolloverId: rollover.rollover_request_id,
            };
        }
        catch {
            return {
                kind: "noop",
                rolloverId: rollover.rollover_request_id,
            };
        }
    }
    // 0 durable AND 0 JSONL on startup: the rollover was
    // interrupted before any child side effect. This is the
    // "no child evidence" case (T-P04-03). FAILED on startup
    // only — the gate is the caller's responsibility (the
    // caller must NOT invoke reconcile on non-startup reasons,
    // because in that case the rollover is legitimately
    // EXECUTING).
    try {
        ctx.store.rollovers.transition({
            projectId: ctx.projectId,
            ref: ctx.store.rollovers.refFor(rollover.rollover_request_id),
            to: "FAILED",
            failureCode: "new_session_failed",
            failureDetail: "no child evidence at startup; rollover interrupted before side effect",
            now: ctx.now(),
        });
        return {
            kind: "fail",
            failure_code: "new_session_failed",
            failure_detail: "no child evidence at startup; rollover interrupted before side effect",
            rolloverId: rollover.rollover_request_id,
        };
    }
    catch {
        return {
            kind: "noop",
            rolloverId: rollover.rollover_request_id,
        };
    }
}
/**
 * Find durable PICM child session records whose
 * `previous_session_ref` equals `oldSessionRef`. The SessionStore
 * public surface is preserved. P04 scans the authoritative record directory
 * directly, then uses `readById` for integrity validation.
 */
export function findDurableChild(sessions, input) {
    const directory = join(input.layout.projectsRoot, input.projectId, "sessions");
    let ids;
    try {
        ids = readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".json"))
            .map((entry) => entry.name.slice(0, -".json".length))
            .sort();
    }
    catch (error) {
        if (isMissingError(error))
            return { kind: "zero" };
        return { kind: "incomplete", detail: `cannot enumerate durable sessions: ${boundedError(error)}` };
    }
    const matches = [];
    for (const id of ids) {
        let record;
        try {
            record = sessions.readById(input.projectId, id);
        }
        catch (error) {
            return {
                kind: "incomplete",
                detail: `cannot inspect durable session ${id}: ${boundedError(error)}`,
            };
        }
        if (typeof record.previous_session_ref === "string" &&
            record.previous_session_ref === input.oldSessionRef &&
            record.checkpoint_refs.includes(input.checkpointRef) &&
            record.handoff_refs.includes(input.handoffRef)) {
            matches.push(record.session_id || id);
        }
    }
    if (matches.length === 0)
        return { kind: "zero" };
    if (matches.length === 1)
        return { kind: "one", childId: matches[0] };
    return { kind: "ambiguous", count: matches.length };
}
/* -------------------------------------------------------------------- *
 * Helpers                                                               *
 * -------------------------------------------------------------------- */
function listExecutingRollovers(store, projectId) {
    const summaries = store.rollovers.list(projectId, {
        state: "EXECUTING",
    });
    const out = [];
    for (const summary of summaries) {
        try {
            out.push(store.rollovers.read(summary.ref, projectId));
        }
        catch (err) {
            // Skip unreadable rollover records; partial
            // corruption must not throw the reconciliation
            // loop. The outer try/catch in
            // `reconcileInterruptedRollovers` already
            // preserves EXECUTING on any uncaught throw, so
            // per-record failures are also fine to swallow
            // here.
            void err;
        }
    }
    return out;
}
function classifyChildren(children) {
    if (children.length === 0)
        return { kind: "zero" };
    if (children.length === 1)
        return { kind: "one", childId: children[0] };
    return { kind: "ambiguous", count: children.length };
}
function boundedError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 300);
}
function isMissingError(error) {
    return typeof error === "object" && error !== null && "code" in error &&
        error.code === "ENOENT";
}
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
export function normalizeSessionId(raw) {
    if (typeof raw !== "string" || raw.length === 0)
        return "";
    const base = raw.split("/").pop() ?? "";
    const stripped = base.replace(/\.json$/, "");
    if (stripped.length === 0 || stripped === "current")
        return "";
    return stripped;
}
/**
 * Construct the durable `cmv3://session/<id>` ref that the
 * durable child record's `previous_session_ref` is expected to
 * match. Returns null when the raw session identity is a
 * synthetic sentinel that cannot be ref-encoded; callers must
 * treat null as "no durable child can match this parent".
 */
export function previousSessionRefFor(raw) {
    const id = normalizeSessionId(raw);
    if (id.length === 0)
        return null;
    return `cmv3://${SESSION_REF_KIND}/${id}`;
}
/* -------------------------------------------------------------------- *
 * Default diagnostic sink (no-spam shim; safe for production)          *
 * -------------------------------------------------------------------- */
/**
 * Console-backed diagnostic sink. Emits at most one line per
 * diagnostic; rate-limiting is the host process's
 * responsibility. Production wiring uses this sink in
 * extension.ts.
 */
export function consoleDiagnosticSink() {
    return {
        emit(diagnostic) {
            const tag = diagnostic.level.toUpperCase().padEnd(7);
            const rid = diagnostic.rolloverId
                ? ` [rollover=${diagnostic.rolloverId}]`
                : "";
            // eslint-disable-next-line no-console
            console.error(`picm-p04${rid} ${tag} ${diagnostic.message}`);
        },
    };
}
//# sourceMappingURL=reconcile.js.map