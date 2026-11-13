// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1, founder D-24c) - the pull's `plannedWork` key, on the wire.
// Kept beside `dtos.ts` so that file stays under its size cap. Additive and optional (P11): an older server never sends it and
// 1.0.17 ignores it. Mirrors the server's PlannedWorkDto: dates as YYYY-MM-DD, time as HH:mm, every word list by NAME.

export interface PlannedWorkPlotDto {
    plotId: string;
    status: string;
    doneAtUtc?: string | null;
    doneByUserId?: string | null;
    linkedDailyLogIds?: string[] | null;
    /** Lane L8c-3 (additive): Confirmed | Disputed | Waiting from this plot's own logs, or null. */
    confirmationState?: string | null;
}

export interface PlannedWorkDto {
    id: string;
    farmId: string;
    title: string;
    scope: string;
    plannedDate?: string | null;
    looseWhen?: string | null;
    plannedTime?: string | null;
    assigneeUserId?: string | null;
    crewText?: string | null;
    expectedHeadcount?: number | null;
    quantityText?: string | null;
    payMode?: string | null;
    note?: string | null;
    status: string;
    source: string;
    sourceKind?: string | null;
    sourceDailyLogId?: string | null;
    sourceLogTaskId?: string | null;
    sourcePlotId?: string | null;
    recordedOn: string;
    linkedDailyLogIds?: string[] | null;
    createdByUserId: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
    seenAtUtc?: string | null;
    acceptedAtUtc?: string | null;
    doneAtUtc?: string | null;
    doneByUserId?: string | null;
    cancelledAtUtc?: string | null;
    cancelledByUserId?: string | null;
    cancelReason?: string | null;
    plots?: PlannedWorkPlotDto[] | null;
    /** Lane L8c-3 (additive): Confirmed | Disputed | Waiting from all the linked logs, or null when none is linked. */
    confirmationState?: string | null;
    /**
     * Lane REM-1 (founder D-78, D-84 = 1; R15, R16) - who made it and where it comes from, as THIS reader may know it. Additive (P11): an
     * older server sends none and the phone says nothing it was not told. `wordsWithheld`: the words mention money and this reader may not
     * hear them, so `title` is empty (the ShramSafal-rule card stands in).
     */
    createdByName?: string | null;
    category?: string | null;
    mayPlayVoice?: boolean | null;
    wordsWithheld?: boolean | null;
    makerAlwaysShown?: boolean | null;
    fromChosenPeopleRecord?: boolean | null;
}

/** One person the caller may give work to (GET /shramsafal/farms/{farmId}/planned-work/assignees). */
export interface PlannedWorkAssigneeDto {
    userId: string;
    displayName: string | null;
    role: string;
    plotScope: 'AllPlots' | 'ChosenPlots' | 'OwnWork';
    plotIds: string[];
}
