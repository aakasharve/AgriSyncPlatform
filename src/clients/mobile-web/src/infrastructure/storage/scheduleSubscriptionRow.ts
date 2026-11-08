// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2, founder D-32) - the row of the Dexie `scheduleSubscriptions`
// store (schema v27), kept apart from DexieDatabase.types.ts (mobile-web 800-line cap).
//
// One row = one subscription: a plot's choice of a schedule for one crop season. A row the server sent (pull key
// `scheduleSubscriptions`) is the truth; a row with `pending: true` is a choice made on THIS phone whose adopt / switch the
// server has not answered yet - it keeps the choice visible, and it protects it from a download (P10), until the server's own
// row for the plot replaces it.

/** The states the server keeps (`ScheduleSubscriptionState`). */
export type ScheduleSubscriptionStateName = 'Active' | 'Migrated' | 'Abandoned' | 'Completed';

export interface ScheduleSubscriptionRow {
    /** The subscription id (the phone makes it for its own choices, so the server's row comes back under the same id). */
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId: string;
    /** The library schedule the plot follows (the server's `scheduleTemplateId`). */
    templateId: string;
    /** The plot's day 0 (YYYY-MM-DD) set in "शेड्यूल बदला"; null = the crop season's own start. */
    referenceDate: string | null;
    state: ScheduleSubscriptionStateName;
    adoptedAtUtc: string;
    /** True while this phone's choice has not been answered by the server. Absent on every row the server sent. */
    pending?: true;
    /** spec: plr-d10 lane L8b-1F - the live check state of the followed schedule, as the server last said (absent: not said). */
    checkState?: 'Checked' | 'NotChecked' | 'Returned' | 'Withdrawn';
    /** spec: plr-d10 lane L8b-1F - Outside | Own; absent = chosen before the lane, read as Outside. */
    origin?: 'Outside' | 'Own';
}
