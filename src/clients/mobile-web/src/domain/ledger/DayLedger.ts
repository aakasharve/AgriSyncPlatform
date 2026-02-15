/**
 * DayLedger: Day-scoped Financial Envelope
 *
 * PURPOSE: Solves the expense duplication problem in broadcast mode.
 *
 * PROBLEM (Fix-13):
 * When logging to multiple plots (broadcast mode), expenses are DUPLICATED in each
 * DailyLog. This causes analytics to double/triple count costs.
 *
 * SOLUTION:
 * DayLedger stores global/shared costs ONCE per day. Individual DailyLogs reference
 * the ledger via dayLedgerId. Analytics sum:
 *   plot_cost = log.financialSummary.plotSpecificCosts + policy.getPlotShare(ledger, plotId)
 *
 * COST CATEGORIZATION:
 *
 * | Cost Type          | Where Stored     | Why                                    |
 * |--------------------|------------------|----------------------------------------|
 * | Plot-specific      | DailyLog         | Only affects that plot                 |
 * | irrigation         |                  | (e.g., drip for plot A)                |
 * | Shared/Global      | DayLedger        | Affects multiple plots equally         |
 * | expenses           |                  | (e.g., "bought 5 bags urea")           |
 * | Shared labour      | DayLedger        | Labour working across all plots        |
 *
 * ALLOCATION STRATEGIES:
 * - EQUAL: Split evenly across all plots (default for most expenses)
 * - BY_ACREAGE: Proportional to plot size (for inputs applied per-acre)
 * - CUSTOM: User-specified percentages (for special cases)
 *
 * @see ExpenseAllocationPolicy for allocation calculations
 * @see LogFactory for creation integration (Phase 2)
 */

import type { ActivityExpenseEvent, LabourEvent } from '../../features/logs/logs.types';

// ============================================
// CORE TYPES
// ============================================

/**
 * Allocation strategy for splitting shared costs across plots.
 *
 * - EQUAL: Each plot bears equal share (cost / numPlots)
 * - BY_ACREAGE: Proportional to plot acreage (plotAcres / totalAcres * cost)
 * - CUSTOM: User-specified percentages that must sum to 100
 */
export type AllocationStrategy = 'EQUAL' | 'BY_ACREAGE' | 'CUSTOM';

/**
 * Represents a single plot's share of the day's global costs.
 *
 * This is the allocation RESULT - how much of the global costs
 * should be attributed to this specific plot.
 */
export interface PlotAllocation {
    /** Plot identifier */
    plotId: string;

    /** Crop identifier (for context) */
    cropId: string;

    /**
     * What percentage of global costs this plot bears.
     * Range: 0-100
     * Sum of all allocations for a day must equal 100.
     */
    allocationPercent: number;

    /**
     * Computed monetary amount this plot bears.
     * Formula: (allocationPercent / 100) * DayLedger.totalGlobalCost
     */
    allocatedAmount: number;
}

/**
 * Metadata for tracking changes to the DayLedger.
 */
export interface DayLedgerMeta {
    /** ISO timestamp when ledger was created */
    createdAt: string;

    /** ISO timestamp when ledger was last modified */
    updatedAt: string;

    /** Operator ID who created/modified (for audit trail) */
    lastModifiedBy?: string;

    /** App version at creation (for schema migrations) */
    appVersion?: string;
}

/**
 * DayLedger: The day-scoped financial envelope.
 *
 * Stores costs that are SHARED across multiple plots on a given day.
 * Individual DailyLogs reference this via dayLedgerId field.
 *
 * INVARIANTS:
 * 1. One DayLedger per dateKey (YYYY-MM-DD)
 * 2. plotAllocations must cover all plots logged on this day
 * 3. Sum of allocationPercent must equal 100 (within tolerance)
 * 4. totalGlobalCost = sum of all expense amounts + shared labour
 *
 * @example
 * // Day with 3 plots, $300 shared expense, equal split
 * {
 *   id: 'dayledger_2026-02-06',
 *   dateKey: '2026-02-06',
 *   globalExpenses: [{ ... totalAmount: 300 }],
 *   globalLabour: [],
 *   plotAllocations: [
 *     { plotId: 'p1', cropId: 'c1', allocationPercent: 33.33, allocatedAmount: 100 },
 *     { plotId: 'p2', cropId: 'c1', allocationPercent: 33.33, allocatedAmount: 100 },
 *     { plotId: 'p3', cropId: 'c2', allocationPercent: 33.34, allocatedAmount: 100 }
 *   ],
 *   totalGlobalCost: 300,
 *   allocationStrategy: 'EQUAL',
 *   meta: { ... }
 * }
 */
export interface DayLedger {
    /**
     * Unique identifier for the ledger.
     * Format: dayledger_{dateKey}
     * Example: dayledger_2026-02-06
     */
    id: string;

    /**
     * The date this ledger covers (IST timezone).
     * Format: YYYY-MM-DD
     * @see DateKeyService for canonical date key generation
     */
    dateKey: string;

    // ================================
    // GLOBAL COSTS (stored once, not per-plot)
    // ================================

    /**
     * Expenses that apply globally to the farm/day.
     * Examples:
     * - "Bought 5 bags urea" (procurement)
     * - "Electricity bill" (farm overhead)
     * - "Fuel for tractor" (shared machinery)
     *
     * These are NOT duplicated in individual DailyLogs.
     */
    globalExpenses: ActivityExpenseEvent[];

    /**
     * Labour costs shared across plots.
     * Use case: "4 workers today" when they work across all plots.
     *
     * Plot-specific labour (only worked on plot A) stays on DailyLog.
     */
    globalLabour: LabourEvent[];

    // ================================
    // ALLOCATION METADATA
    // ================================

    /**
     * How costs are split across plots.
     * Each plot that had activity on this day should have an allocation.
     */
    plotAllocations: PlotAllocation[];

    /**
     * Strategy used for allocation.
     * Stored for audit/recalculation purposes.
     */
    allocationStrategy: AllocationStrategy;

    /**
     * IDs of DailyLogs that reference this ledger.
     * Maintained for integrity checks and cascading updates.
     */
    linkedLogIds: string[];

    // ================================
    // COMPUTED TOTALS
    // ================================

    /**
     * Total of all global costs.
     * Formula: sum(globalExpenses.totalAmount) + sum(globalLabour.totalCost)
     *
     * This is the amount that gets SPLIT across plots.
     * Individual plot cost = (allocationPercent / 100) * totalGlobalCost
     */
    totalGlobalCost: number;

    // ================================
    // METADATA
    // ================================

    meta: DayLedgerMeta;
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Creates a new DayLedger ID from a date key.
 *
 * @param dateKey - Date in YYYY-MM-DD format
 * @returns Ledger ID in format dayledger_{dateKey}
 */
export function createDayLedgerId(dateKey: string): string {
    return `dayledger_${dateKey}`;
}

/**
 * Extracts the date key from a DayLedger ID.
 *
 * @param ledgerId - Ledger ID in format dayledger_{dateKey}
 * @returns Date key in YYYY-MM-DD format, or null if invalid
 */
export function extractDateKeyFromLedgerId(ledgerId: string): string | null {
    const match = ledgerId.match(/^dayledger_(\d{4}-\d{2}-\d{2})$/);
    return match ? match[1] : null;
}

/**
 * Creates an empty DayLedger for a given date.
 *
 * Use this as a starting point, then add expenses and calculate allocations.
 *
 * @param dateKey - Date in YYYY-MM-DD format
 * @param operatorId - Optional operator who created this ledger
 * @returns Empty DayLedger ready for population
 */
export function createEmptyDayLedger(
    dateKey: string,
    operatorId?: string
): DayLedger {
    const now = new Date().toISOString();

    return {
        id: createDayLedgerId(dateKey),
        dateKey,
        globalExpenses: [],
        globalLabour: [],
        plotAllocations: [],
        allocationStrategy: 'EQUAL',
        linkedLogIds: [],
        totalGlobalCost: 0,
        meta: {
            createdAt: now,
            updatedAt: now,
            lastModifiedBy: operatorId,
            appVersion: 'v1.1.0'
        }
    };
}

// ============================================
// VALIDATION
// ============================================

/**
 * Validates that a DayLedger's allocations sum to 100%.
 *
 * @param ledger - The DayLedger to validate
 * @param tolerance - Acceptable deviation from 100 (default 0.01 for floating point)
 * @returns true if allocations are valid
 */
export function validateAllocations(ledger: DayLedger, tolerance: number = 0.01): boolean {
    if (ledger.plotAllocations.length === 0) {
        return true; // No allocations is valid (empty day)
    }

    const totalPercent = ledger.plotAllocations.reduce(
        (sum, alloc) => sum + alloc.allocationPercent,
        0
    );

    return Math.abs(totalPercent - 100) <= tolerance;
}

/**
 * Validates that allocated amounts match the expected values.
 *
 * @param ledger - The DayLedger to validate
 * @param tolerance - Acceptable deviation in currency (default 0.01)
 * @returns true if amounts are consistent
 */
export function validateAllocatedAmounts(ledger: DayLedger, tolerance: number = 0.01): boolean {
    for (const allocation of ledger.plotAllocations) {
        const expectedAmount = (allocation.allocationPercent / 100) * ledger.totalGlobalCost;
        if (Math.abs(allocation.allocatedAmount - expectedAmount) > tolerance) {
            return false;
        }
    }
    return true;
}

// ============================================
// HELPERS
// ============================================

/**
 * Calculates the total global cost from expenses and labour.
 *
 * @param expenses - Array of expense events
 * @param labour - Array of labour events
 * @returns Total cost sum
 */
export function calculateTotalGlobalCost(
    expenses: ActivityExpenseEvent[],
    labour: LabourEvent[]
): number {
    const expenseTotal = expenses.reduce(
        (sum, exp) => sum + (exp.totalAmount || 0),
        0
    );

    const labourTotal = labour.reduce(
        (sum, lab) => sum + (lab.totalCost || 0),
        0
    );

    return expenseTotal + labourTotal;
}

/**
 * Gets a specific plot's share from a ledger.
 *
 * @param ledger - The DayLedger
 * @param plotId - Plot to find
 * @returns Allocated amount for the plot, or 0 if not found
 */
export function getPlotAllocatedAmount(ledger: DayLedger, plotId: string): number {
    const allocation = ledger.plotAllocations.find(a => a.plotId === plotId);
    return allocation?.allocatedAmount ?? 0;
}

/**
 * Checks if a ledger has any costs to allocate.
 *
 * @param ledger - The DayLedger to check
 * @returns true if there are global costs
 */
export function hasGlobalCosts(ledger: DayLedger): boolean {
    return ledger.totalGlobalCost > 0;
}
