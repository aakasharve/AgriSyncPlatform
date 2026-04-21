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
    ratePerHourAmount: number;
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
    estimatedTotalAmount: number;
    estimatedTotalCurrency: string;
    linkedDailyLogId?: string;
    payoutCostEntryId?: string;
    cancellationReason?: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
}
