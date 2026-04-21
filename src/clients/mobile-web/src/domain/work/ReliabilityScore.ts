/**
 * ReliabilityScore domain types — CEI Phase 4 §4.8 Work Trust Ledger
 *
 * Anti-ego rule: values are ratios and counts, never "good/bad" labels.
 *
 * @module domain/work/ReliabilityScore
 */

export interface ReliabilityScore {
    overall: number;
    verifiedRatio: number;
    onTimeRatio: number;
    disputeFreeRatio: number;
    logCount30d: number;
    disputeCount30d: number;
    computedAtUtc: string;
}

export interface WorkerProfileData {
    workerUserId: string;
    displayName: string;
    jobCardsLast30d: number;
    jobCardsPaidOutLast30d: number;
    earnedLast30d: number;
    earnedCurrencyCode: string;
    reliability: ReliabilityScore;
}
