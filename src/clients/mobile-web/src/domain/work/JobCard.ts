/**
 * JobCard domain types — CEI Phase 4 §4.8 Work Trust Ledger
 *
 * @module domain/work/JobCard
 */

export type JobCardStatus =
    | 'Draft'
    | 'Assigned'
    | 'InProgress'
    | 'Completed'
    | 'VerifiedForPayout'
    | 'PaidOut'
    | 'Cancelled';

export interface JobCardLineItem {
    activityType: string;
    expectedHours: number;
    /** null = a worker's pay held back from this seat by rule (lane MU-3 fix 1, F7): shown as such, never ₹0. */
    ratePerHourAmount: number | null;
    ratePerHourCurrencyCode: string;
    notes?: string;
}

export interface JobCard {
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId?: string;
    createdByUserId: string;
    assignedWorkerUserId?: string;
    assignedWorkerDisplayName?: string;
    /** ISO date (YYYY-MM-DD) */
    plannedDate: string;
    status: JobCardStatus;
    lineItems: JobCardLineItem[];
    /** null = a worker's pay held back from this seat by rule (lane MU-3 fix 1, F7): shown as such, never ₹0. */
    estimatedTotalAmount: number | null;
    estimatedTotalCurrency: string;
    linkedDailyLogId?: string;
    /**
     * lane L4b fix round 1 (H-1 / CTO D-89) — the linked record's state as the farm's job-card list reads it
     * ("Draft", "Verified", "Disputed", …). Absent/null = not known here (no link, a record kept from this seat, a cached
     * copy from the sync pull): the payout step is then not offered.
     */
    linkedDailyLogStatus?: string | null;
    /** lane L4b fix round 1 (M-2) — a शंका or a correction took this card back from "ready to pay". */
    payoutCheckWithdrawn?: boolean;
    payoutCostEntryId?: string;
    cancellationReason?: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
}
