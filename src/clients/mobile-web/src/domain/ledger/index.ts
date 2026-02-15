/**
 * Domain: Ledger
 *
 * Financial normalization layer for AgriLog.
 *
 * PURPOSE: Solve the expense duplication problem (Fix-13).
 * When logging to multiple plots in broadcast mode, costs were duplicated
 * in each DailyLog, causing analytics to double/triple count.
 *
 * SOLUTION:
 * - DayLedger stores global/shared costs ONCE per day
 * - ExpenseAllocationPolicy calculates fair splits across plots
 * - Individual DailyLogs reference the ledger (not embed costs)
 * - Analytics use: log.plotSpecificCost + policy.getPlotShare(ledger, plotId)
 *
 * EXPORTS:
 *
 * Types:
 * - DayLedger: Day-scoped financial envelope
 * - PlotAllocation: A plot's share of global costs
 * - AllocationStrategy: How to split costs (EQUAL | BY_ACREAGE | CUSTOM)
 * - DayLedgerMeta: Metadata for audit trail
 *
 * Policy:
 * - ExpenseAllocationPolicy: Implementation of cost distribution
 * - IExpenseAllocationPolicy: Interface for policy
 * - expenseAllocationPolicy: Default singleton instance
 *
 * Helpers:
 * - createDayLedgerId: Generate ledger ID from date key
 * - createEmptyDayLedger: Factory for new ledgers
 * - calculateEqualSplit: Quick equal split calculation
 * - calculateAcreageSplit: Quick acreage-based split
 * - recommendStrategy: Suggest best allocation strategy
 *
 * @see src/core/domain/LogFactory.ts for integration (Phase 2)
 */

// ============================================
// CORE ENTITY
// ============================================

export type {
    DayLedger,
    PlotAllocation,
    AllocationStrategy,
    DayLedgerMeta
} from './DayLedger';

export {
    createDayLedgerId,
    extractDateKeyFromLedgerId,
    createEmptyDayLedger,
    validateAllocations,
    validateAllocatedAmounts,
    calculateTotalGlobalCost,
    getPlotAllocatedAmount,
    hasGlobalCosts
} from './DayLedger';

// ============================================
// ALLOCATION POLICY
// ============================================

export type {
    PlotInfo,
    CustomAllocation,
    IExpenseAllocationPolicy
} from './ExpenseAllocationPolicy';

export {
    ExpenseAllocationPolicy,
    expenseAllocationPolicy,
    calculateEqualSplit,
    calculateAcreageSplit,
    recommendStrategy
} from './ExpenseAllocationPolicy';
