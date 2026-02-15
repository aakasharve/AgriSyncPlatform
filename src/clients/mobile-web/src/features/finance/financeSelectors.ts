import { FinanceFilters } from './finance.types';
import { financeService } from './financeService';

const totalForType = (filters: FinanceFilters | undefined, type: 'Expense' | 'Income'): number => {
    return financeService
        .getEffectiveMoneyEvents({ ...filters, type })
        .reduce((sum, item) => sum + item.effectiveAmount, 0);
};

export const financeSelectors = {
    getTotalCost(filters?: FinanceFilters): number {
        return totalForType(filters, 'Expense');
    },

    getTotalIncome(filters?: FinanceFilters): number {
        return totalForType(filters, 'Income');
    },

    getBreakdown(filters?: FinanceFilters) {
        const lines = financeService.getEffectiveMoneyEvents(filters);
        const totals = {
            totalExpense: lines.filter(line => line.type === 'Expense').reduce((sum, line) => sum + line.effectiveAmount, 0),
            totalIncome: lines.filter(line => line.type === 'Income').reduce((sum, line) => sum + line.effectiveAmount, 0),
            unverifiedTotal: lines
                .filter(line => line.trustStatus === 'Unverified')
                .reduce((sum, line) => sum + line.effectiveAmount, 0)
        };

        return { lines, totals };
    },

    getReviewInbox(filters?: Omit<FinanceFilters, 'reviewStatus'>) {
        return financeService.getEffectiveMoneyEvents({ ...filters, reviewStatus: 'NeedsReview' });
    },

    getTrustedTotals(filters?: FinanceFilters): number {
        return financeService
            .getEffectiveMoneyEvents(filters)
            .filter(item => item.trustStatus === 'Verified' || item.trustStatus === 'Adjusted')
            .reduce((sum, item) => sum + item.effectiveAmount, 0);
    }
};
