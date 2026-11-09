// spec: plr-d10 lane L8b-2 - the schedule-subscription transport shape (the server's `ScheduleSubscriptionDto`), out of dtos.ts.

export interface ScheduleSubscriptionDto {
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId: string;
    cropKey: string;
    scheduleTemplateId: string;
    scheduleVersionTag: string;
    adoptedAtUtc: string;
    state: 'Active' | 'Migrated' | 'Abandoned' | 'Completed';
    migratedFromSubscriptionId?: string | null;
    migratedToSubscriptionId?: string | null;
    migrationReason?: string | null;
    stateChangedAtUtc?: string | null;
    /** spec: plr-d10 lane L8b-1/L8b-2 — the plot's day 0 (YYYY-MM-DD); null/absent = the crop season's start. Additive (P11). */
    referenceDate?: string | null;
    /**
     * spec: plr-d10 lane L8b-1F - what ShramSafal's check says NOW about the schedule this follows (a withdrawal shows here), and
     * whose schedule it is. Additive and optional (P11): an older server sends neither.
     */
    checkState?: 'Checked' | 'NotChecked' | 'Returned' | 'Withdrawn' | null;
    origin?: 'Outside' | 'Own' | null;
    /**
     * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - the place this schedule holds on its plot-season: 0 = his own, 1..3 = outside.
     * Additive and optional (P11): an older server sends none, and a row the server wrote with no place carries null.
     */
    slot?: number | null;
}

/**
 * spec: plr-d10 lane L8b-3 (R6, D-76) - the server's pick of the मुख्य schedule of one plot-season (pull key `plotMainSchedules`,
 * sent in FULL on every pull). The phone marks its own rows from it and never recounts which one is main (thin client).
 */
export interface PlotMainScheduleDto {
    plotId: string;
    cropCycleId: string;
    subscriptionId: string;
}
