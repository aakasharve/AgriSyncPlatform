/**
 * Finance Selectors — Computed Views from Cached Data
 *
 * All aggregation, enrichment, and filtering of finance data.
 * Reads raw data from financeService (Dexie cache), computes derived values.
 */

import {
    EffectiveMoneyEvent,
    FinanceFilters,
    FinancePipelineBucket,
    MoneyAdjustment,
    MoneyEvent,
} from './finance.types';
import { financeService } from './financeService';

// ── Enrichment & Filtering ─────────────────────────────────────────────

function toDateKey(value?: string): string {
    if (!value) return new Date().toISOString().split('T')[0];
    return value.includes('T') ? value.split('T')[0] : value;
}

function inDateRange(value: string, fromDate?: string, toDate?: string): boolean {
    const dateKey = toDateKey(value);
    if (fromDate && dateKey < toDateKey(fromDate)) return false;
    if (toDate && dateKey > toDateKey(toDate)) return false;
    return true;
}

function enrichWithCorrections(events: MoneyEvent[], corrections: MoneyAdjustment[]): EffectiveMoneyEvent[] {
    return events.map(event => {
        const eventCorrections = corrections
            .filter(correction => correction.adjustsMoneyEventId === event.id)
            .sort((left, right) => new Date(left.correctedAt).getTime() - new Date(right.correctedAt).getTime());

        const latestAmount = [...eventCorrections]
            .reverse()
            .find(correction => correction.correctedFields?.amount !== undefined)
            ?.correctedFields?.amount;

        return {
            ...event,
            effectiveAmount: latestAmount ?? event.amount,
            adjustments: eventCorrections,
        };
    });
}

function applyFilters(events: EffectiveMoneyEvent[], filters?: FinanceFilters): EffectiveMoneyEvent[] {
    if (!filters) return events;
    return events.filter(event => {
        if (!inDateRange(event.dateTime, filters.fromDate, filters.toDate)) return false;
        if (filters.plotId && event.plotId !== filters.plotId) return false;
        if (filters.cropId && event.cropId !== filters.cropId) return false;
        if (filters.sourceType && event.sourceType !== filters.sourceType) return false;
        if (filters.sourceId && event.sourceId !== filters.sourceId) return false;
        if (filters.reviewStatus && event.reviewStatus !== filters.reviewStatus) return false;
        if (filters.trustStatus && event.trustStatus !== filters.trustStatus) return false;
        if (filters.type && event.type !== filters.type) return false;
        return true;
    });
}

// ── Public Selectors ───────────────────────────────────────────────────

export const financeSelectors = {
    /**
     * Get effective money events: raw events enriched with correction amounts and filtered.
     * This is the primary data source for all finance UI.
     */
    getEffectiveMoneyEvents(filters?: FinanceFilters): EffectiveMoneyEvent[] {
        const events = financeService.getMoneyEvents();
        const adjustments = financeService.getAdjustments();
        const enriched = enrichWithCorrections(events, adjustments);
        return applyFilters(enriched, filters);
    },

    getTotalCost(filters?: FinanceFilters): number {
        return this.getEffectiveMoneyEvents({ ...filters, type: 'Expense' })
            .reduce((sum, item) => sum + item.effectiveAmount, 0);
    },

    getTotalIncome(filters?: FinanceFilters): number {
        return this.getEffectiveMoneyEvents({ ...filters, type: 'Income' })
            .reduce((sum, item) => sum + item.effectiveAmount, 0);
    },

    getBreakdown(filters?: FinanceFilters) {
        const lines = this.getEffectiveMoneyEvents(filters)
            .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());

        const totals = {
            totalExpense: lines
                .filter(line => line.type === 'Expense')
                .reduce((sum, line) => sum + line.effectiveAmount, 0),
            totalIncome: lines
                .filter(line => line.type === 'Income')
                .reduce((sum, line) => sum + line.effectiveAmount, 0),
            unverifiedTotal: lines
                .filter(line => line.trustStatus === 'Unverified')
                .reduce((sum, line) => sum + line.effectiveAmount, 0)
        };

        return { lines, totals };
    },

    getReviewInbox(filters?: Omit<FinanceFilters, 'reviewStatus'>) {
        return this.getEffectiveMoneyEvents({ ...filters, reviewStatus: 'NeedsReview' });
    },

    getTrustedTotals(filters?: FinanceFilters): number {
        return this.getEffectiveMoneyEvents(filters)
            .filter(item => item.trustStatus === 'Verified' || item.trustStatus === 'Adjusted')
            .reduce((sum, item) => sum + item.effectiveAmount, 0);
    },

    getPipelineBuckets(filters?: Omit<FinanceFilters, 'reviewStatus' | 'trustStatus'>): FinancePipelineBucket[] {
        const entries = this.getEffectiveMoneyEvents(filters);

        const captured = entries;
        const needsReview = entries.filter(item => item.reviewStatus === 'NeedsReview');
        const approved = entries.filter(item => item.trustStatus === 'Verified');
        const adjusted = entries.filter(item => item.trustStatus === 'Adjusted');

        const toBucket = (
            key: FinancePipelineBucket['key'],
            bucketEntries: EffectiveMoneyEvent[]
        ): FinancePipelineBucket => ({
            key,
            count: bucketEntries.length,
            total: bucketEntries.reduce((sum, item) => sum + item.effectiveAmount, 0),
            topIssue: bucketEntries.flatMap(item => item.reviewReasons || [])[0] || 'None',
        });

        return [
            toBucket('Captured', captured),
            toBucket('NeedsReview', needsReview),
            toBucket('Approved', approved),
            toBucket('Adjusted', adjusted),
        ];
    },
};
