// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1, founder D-24c) - the pull's `plannedWork` key, on the wire.
// Kept beside `dtos.ts` so that file stays under its size cap. Additive and optional (P11): an older server never sends it and
// 1.0.17 ignores it. Mirrors the server's PlannedWorkDto: dates as YYYY-MM-DD, time as HH:mm, every word list by NAME.

export interface PlannedWorkPlotDto {
    plotId: string;
    status: string;
    doneAtUtc?: string | null;
    doneByUserId?: string | null;
    linkedDailyLogIds?: string[] | null;
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
}

/** One person the caller may give work to (GET /shramsafal/farms/{farmId}/planned-work/assignees). */
export interface PlannedWorkAssigneeDto {
    userId: string;
    displayName: string | null;
    role: string;
    plotScope: 'AllPlots' | 'ChosenPlots' | 'OwnWork';
    plotIds: string[];
}
