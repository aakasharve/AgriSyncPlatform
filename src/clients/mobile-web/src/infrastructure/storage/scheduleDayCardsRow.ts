// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8) - the row of the Dexie `scheduleDayCards` store (schema v32): the day-card detail of ONE schedule
// version exactly as the server sent it. A DISPOSABLE cache (P10): the server is the truth; the row is replaced when the version's `contentHash` changes and may be
// deleted at any time without losing anything the farmer made.
export interface ScheduleDayCardsRow {
    /** The schedule version's id (the server's `ssf.schedule_templates` id). */
    templateId: string;
    /** The version's content hash when this copy was taken. */
    contentHash: string;
    /** ISO time this phone took the copy. */
    fetchedAtUtc: string;
    /** The server's JSON, unread: it is parsed (and refused when unreadable) every time it is opened. */
    detail: unknown;
}
