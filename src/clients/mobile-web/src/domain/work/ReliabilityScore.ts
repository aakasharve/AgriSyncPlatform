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
    /** null = his earnings are held back from this seat by rule (lane MU-3 fix 1, F7); the rest of the page stays. */
    earnedLast30d: number | null;
    earnedCurrencyCode: string;
    reliability: ReliabilityScore;
}
