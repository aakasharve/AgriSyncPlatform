// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1, founder D-24c) - the row of the Dexie `plannedWork` store
// (schema v28), kept apart from DexieDatabase.types.ts (mobile-web 800-line cap).
//
// One row = one task or reminder of one farm AS THIS PERSON MAY SEE IT (the server follows the reader's rights: D-26, D-79).
// Rows are the server's only; a change made on this phone and not yet answered lives in the mutation queue, and
// `getLocalPlannedWork` merges the two with a label (P10). Every field is words (D-24a, P4): a headcount, a quantity and a pay
// choice stand for nothing else.

export type PlannedWorkStatusName = 'Open' | 'Assigned' | 'Seen' | 'Accepted' | 'Done' | 'Cancelled';
export type PlannedWorkScopeName = 'Plot' | 'MultiPlot' | 'Farm' | 'Unspecified';
export type PlannedWorkLooseWhenName = 'Week' | 'Month' | 'Anytime';
export type PlannedWorkPayModeName = 'Cash' | 'Daily' | 'Contract' | 'Later';
export type PlannedWorkSourceName = 'Planning' | 'VoiceLog' | 'LogLeftover' | 'Schedule';
export type PlannedWorkSourceKindName = 'Typed' | 'PlanForm' | 'Spoken' | 'Leftover';

export interface PlannedWorkPlotRow {
    plotId: string;
    status: 'Pending' | 'Done';
    doneAtUtc: string | null;
    doneByUserId: string | null;
    linkedDailyLogIds: string[];
}

export interface PlannedWorkRow {
    id: string;
    farmId: string;
    title: string;
    scope: PlannedWorkScopeName;
    /** YYYY-MM-DD, or null (undated work is never late). */
    plannedDate: string | null;
    looseWhen: PlannedWorkLooseWhenName | null;
    /** HH:mm, only with a date. */
    plannedTime: string | null;
    /** The one accountable person; null = a reminder. */
    assigneeUserId: string | null;
    crewText: string | null;
    expectedHeadcount: number | null;
    quantityText: string | null;
    payMode: PlannedWorkPayModeName | null;
    note: string | null;
    status: PlannedWorkStatusName;
    source: PlannedWorkSourceName;
    sourceKind: PlannedWorkSourceKindName | null;
    sourceDailyLogId: string | null;
    sourceLogTaskId: string | null;
    sourcePlotId: string | null;
    /** The farm-local day it was made (YYYY-MM-DD). Not the due date (D-29). */
    recordedOn: string;
    linkedDailyLogIds: string[];
    createdByUserId: string;
    createdAtUtc: string;
    /** The server's clock of the last change: the pull's cursor. */
    modifiedAtUtc: string;
    seenAtUtc: string | null;
    acceptedAtUtc: string | null;
    doneAtUtc: string | null;
    doneByUserId: string | null;
    cancelledAtUtc: string | null;
    cancelledByUserId: string | null;
    cancelReason: string | null;
    plots: PlannedWorkPlotRow[];
}
