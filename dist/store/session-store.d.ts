/**
 * Session record store.
 *
 * Per S02 spec:
 *   - minimal session record with enough information to establish
 *     continuity
 *   - opaque session id
 *   - no coupling to one Pi session implementation
 *   - S02 does not create the next Pi session; S04 may fill
 *     `next_session_ref`
 *
 * The session record is small and self-contained. The store does
 * not perform any rollover; it merely persists the linkage that
 * later WPs and the recovery layer consume.
 */
import { type StoreLayout } from "./paths.js";
import type { SessionRecord } from "./records.js";
export declare const SESSION_REF_KIND: "session";
export interface SessionStore {
    write(input: unknown, opts: {
        projectId: string;
    }): {
        ref: string;
        id: string;
        record: SessionRecord;
    };
    read(ref: string, projectId: string): SessionRecord;
    readById(projectId: string, id: string): SessionRecord;
    list(projectId: string): SessionSummary[];
}
export interface SessionSummary {
    id: string;
    ref: string;
    status: SessionRecord["status"];
    started_at: string;
    ended_at?: string;
}
export declare class SessionIntegrityError extends Error {
    constructor(message: string);
}
export declare function createSessionStore(layout: StoreLayout): SessionStore;
//# sourceMappingURL=session-store.d.ts.map