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

/** Lane REM-1 (D-79): the three sources of a reminder, by the server's names. */
export type ReminderCategoryName = 'FromPlanning' | 'FromSchedule' | 'FromLogs';

/** The owner's word on the logs a task (or one of its plots) was done with (lane L8c-3; the server computes it from the logs). */
export type PlannedWorkConfirmationName = 'Confirmed' | 'Disputed' | 'Waiting';

export interface PlannedWorkPlotRow {
    plotId: string;
    status: 'Pending' | 'Done';
    doneAtUtc: string | null;
    doneByUserId: string | null;
    linkedDailyLogIds: string[];
    /** Lane L8c-3 - from this plot's own logs; absent on a row from before the lane or a server that does not send it (P11). */
    confirmationState?: PlannedWorkConfirmationName | null;
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
    /** Lane L8c-3 - Confirmed | Disputed | Waiting, from ALL the task's linked logs; null = no linked log. Plain field, no index. */
    confirmationState?: PlannedWorkConfirmationName | null;
    /** Lane REM-1 (additive, plain fields, no index: Dexie stays v28) - who made it and where it comes from, as this person may know it. */
    createdByName?: string | null;
    category?: ReminderCategoryName | null;
    mayPlayVoice?: boolean | null;
    wordsWithheld?: boolean | null;
    makerAlwaysShown?: boolean | null;
    fromChosenPeopleRecord?: boolean | null;
    /**
     * Lane L8c-4 (D-78 = 1) - a spoken reminder MADE ON THIS PHONE from a log he just saved, shown at once under the id the server
     * will give it (`spokenTaskId`), until the pull brings the server's row, which replaces this one (same id: never doubled). Absent
     * on every server row. Shown as "फोनवर ठेवलं" until then; kept through a pull while its log's create is still on the phone (P10).
     */
    mirror?: true;
}
