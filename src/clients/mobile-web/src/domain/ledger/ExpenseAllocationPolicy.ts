/**
 * ExpenseAllocationPolicy: Fair Cost Distribution Across Plots
 *
 * PURPOSE: Calculate how shared/global costs should be split across plots.
 *
 * STRATEGIES:
 *
 * 1. EQUAL - Each plot bears equal share
 *    Use case: General farm expenses (fuel, equipment rental)
 *    Formula: cost / numPlots
 *
 * 2. BY_ACREAGE - Proportional to plot size
 *    Use case: Inputs applied per-acre (fertilizer, pesticides)
 *    Formula: (plotAcres / totalAcres) * cost
 *
 * 3. CUSTOM - User-specified percentages
 *    Use case: Special arrangements, partial applications
 *    Formula: (customPercent / 100) * cost
 *
 * EDGE CASES HANDLED:
 * - Zero plots: Returns empty allocations
 * - Single plot: Gets 100% allocation
 * - Zero acreage on BY_ACREAGE: Falls back to EQUAL
 * - Floating point precision: Rounds to 2 decimals, adjusts last plot for 100%
 *
 * @see DayLedger for storage of allocations
 */

import type { DayLedger, PlotAllocation, AllocationStrategy } from './DayLedger';

// ============================================
// INPUT TYPES
// ============================================

/**
 * Minimal plot info needed for allocation calculation.
 */
export interface PlotInfo {
    plotId: string;
    cropId: string;

    /**
     * Plot size in acres. Required for BY_ACREAGE strategy.
     * If undefined, BY_ACREAGE falls back to EQUAL split.
     */
    acreage?: number;
}

/**
 * Custom allocation override for a specific plot.
 * Used with CUSTOM strategy.
 */
export interface CustomAllocation {
    plotId: string;

    /**
     * Percentage this plot should bear.
     * Range: 0-100
     * Sum of all custom allocations must equal 100.
     */
    percent: number;
}

// ============================================
// POLICY INTERFACE
// ============================================

/**
 * Interface for expense allocation policies.
 *
 * Implementations calculate how to split costs across plots
 * based on different strategies.
 */
export interface IExpenseAllocationPolicy {
    /**
     * Calculate allocations for a set of plots.
     *
     * @param plots - Plots to allocate costs to
     * @param totalCost - Total cost to distribute
     * @param strategy - How to split the cost
     * @param customAllocations - Required if strategy is CUSTOM
     * @returns Array of PlotAllocation with calculated amounts
     */
    calculateAllocations(
        plots: PlotInfo[],
        totalCost: number,
        strategy: AllocationStrategy,
        customAllocations?: CustomAllocation[]
    ): PlotAllocation[];

    /**
     * Get a specific plot's share of global costs from a ledger.
     *
     * @param ledger - The DayLedger containing allocations
     * @param plotId - Plot to get share for
     * @returns The allocated amount for the plot, or 0 if not found
     */
    getPlotShare(ledger: DayLedger, plotId: string): number;

    /**
     * Get a specific plot's share percentage from a ledger.
     *
     * @param ledger - The DayLedger containing allocations
     * @param plotId - Plot to get share for
     * @returns The allocation percentage for the plot, or 0 if not found
     */
    getPlotSharePercent(ledger: DayLedger, plotId: string): number;
}

// ============================================
// IMPLEMENTATION
// ============================================

/**
 * Default implementation of expense allocation policy.
 *
 * Handles EQUAL, BY_ACREAGE, and CUSTOM strategies with proper
 * edge case handling and floating point precision.
 */
export class ExpenseAllocationPolicy implements IExpenseAllocationPolicy {

    /**
     * Calculate allocations for plots based on strategy.
     *
     * @throws Error if CUSTOM strategy is used without customAllocations
     * @throws Error if customAllocations don't sum to 100
     */
    calculateAllocations(
        plots: PlotInfo[],
        totalCost: number,
        strategy: AllocationStrategy,
        customAllocations?: CustomAllocation[]
    ): PlotAllocation[] {
        // Edge case: No plots
        if (plots.length === 0) {
            return [];
        }

        // Edge case: No cost to allocate
        if (totalCost <= 0) {
            return plots.map(plot => ({
                plotId: plot.plotId,
                cropId: plot.cropId,
                allocationPercent: 100 / plots.length,
                allocatedAmount: 0
            }));
        }

        switch (strategy) {
            case 'EQUAL':
                return this.calculateEqualAllocations(plots, totalCost);

            case 'BY_ACREAGE':
                return this.calculateAcreageAllocations(plots, totalCost);

            case 'CUSTOM':
                if (!customAllocations || customAllocations.length === 0) {
                    throw new Error(
                        'CUSTOM allocation strategy requires customAllocations parameter'
                    );
                }
                return this.calculateCustomAllocations(plots, totalCost, customAllocations);

            default:
                // Fallback to equal for unknown strategies
                console.warn(`Unknown allocation strategy: ${strategy}, falling back to EQUAL`);
                return this.calculateEqualAllocations(plots, totalCost);
        }
    }

    /**
     * Get a plot's allocated amount from a ledger.
     */
    getPlotShare(ledger: DayLedger, plotId: string): number {
        const allocation = ledger.plotAllocations.find(a => a.plotId === plotId);
        return allocation?.allocatedAmount ?? 0;
    }

    /**
     * Get a plot's allocation percentage from a ledger.
     */
    getPlotSharePercent(ledger: DayLedger, plotId: string): number {
        const allocation = ledger.plotAllocations.find(a => a.plotId === plotId);
        return allocation?.allocationPercent ?? 0;
    }

    // ================================
    // PRIVATE CALCULATION METHODS
    // ================================

    /**
     * EQUAL strategy: Split cost evenly.
     */
    private calculateEqualAllocations(
        plots: PlotInfo[],
        totalCost: number
    ): PlotAllocation[] {
        const numPlots = plots.length;
        const percentPerPlot = 100 / numPlots;
        const amountPerPlot = totalCost / numPlots;

        // Round percentages, adjust last plot for 100% total
        const allocations: PlotAllocation[] = plots.map((plot, index) => {
            const isLast = index === numPlots - 1;

            // For last plot, calculate remaining to ensure 100%
            const prevPercent = index * this.round(percentPerPlot, 2);
            const percent = isLast ? (100 - prevPercent + this.round(percentPerPlot, 2)) : this.round(percentPerPlot, 2);

            // Recalculate to ensure percentages sum correctly
            const finalPercent = isLast
                ? 100 - plots.slice(0, -1).reduce((sum, _, i) => sum + this.round(percentPerPlot, 2), 0)
                : this.round(percentPerPlot, 2);

            return {
                plotId: plot.plotId,
                cropId: plot.cropId,
                allocationPercent: finalPercent,
                allocatedAmount: this.round((finalPercent / 100) * totalCost, 2)
            };
        });

        // Final adjustment to ensure amounts sum to totalCost
        return this.adjustForRoundingErrors(allocations, totalCost);
    }

    /**
     * BY_ACREAGE strategy: Split proportional to plot size.
     */
    private calculateAcreageAllocations(
        plots: PlotInfo[],
        totalCost: number
    ): PlotAllocation[] {
        // Calculate total acreage
        const totalAcreage = plots.reduce(
            (sum, plot) => sum + (plot.acreage ?? 0),
            0
        );

        // Edge case: No acreage data, fall back to EQUAL
        if (totalAcreage === 0) {
            console.warn(
                'BY_ACREAGE strategy used but no plots have acreage data, falling back to EQUAL'
            );
            return this.calculateEqualAllocations(plots, totalCost);
        }

        const allocations: PlotAllocation[] = plots.map((plot, index) => {
            const plotAcreage = plot.acreage ?? 0;
            const percent = (plotAcreage / totalAcreage) * 100;

            return {
                plotId: plot.plotId,
                cropId: plot.cropId,
                allocationPercent: this.round(percent, 2),
                allocatedAmount: this.round((percent / 100) * totalCost, 2)
            };
        });

        // Adjust for rounding errors
        return this.adjustForRoundingErrors(allocations, totalCost);
    }

    /**
     * CUSTOM strategy: Use user-specified percentages.
     */
    private calculateCustomAllocations(
        plots: PlotInfo[],
        totalCost: number,
        customAllocations: CustomAllocation[]
    ): PlotAllocation[] {
        // Validate custom allocations sum to ~100
        const totalPercent = customAllocations.reduce(
            (sum, ca) => sum + ca.percent,
            0
        );

        if (Math.abs(totalPercent - 100) > 0.01) {
            throw new Error(
                `Custom allocations must sum to 100, got ${totalPercent}`
            );
        }

        // Build allocation map for quick lookup
        const customMap = new Map(
            customAllocations.map(ca => [ca.plotId, ca.percent])
        );

        const allocations: PlotAllocation[] = plots.map(plot => {
            const percent = customMap.get(plot.plotId) ?? 0;

            return {
                plotId: plot.plotId,
                cropId: plot.cropId,
                allocationPercent: percent,
                allocatedAmount: this.round((percent / 100) * totalCost, 2)
            };
        });

        // Adjust for rounding errors
        return this.adjustForRoundingErrors(allocations, totalCost);
    }

    /**
     * Adjust allocations to ensure amounts sum exactly to totalCost.
     *
     * Due to floating point precision, the sum of allocated amounts may not
     * equal the total. This adjusts the largest allocation to compensate.
     */
    private adjustForRoundingErrors(
        allocations: PlotAllocation[],
        totalCost: number
    ): PlotAllocation[] {
        if (allocations.length === 0) return allocations;

        const sumAllocated = allocations.reduce(
            (sum, a) => sum + a.allocatedAmount,
            0
        );

        const difference = this.round(totalCost - sumAllocated, 2);

        if (Math.abs(difference) > 0.001) {
            // Find the allocation with the largest amount
            let maxIndex = 0;
            for (let i = 1; i < allocations.length; i++) {
                if (allocations[i].allocatedAmount > allocations[maxIndex].allocatedAmount) {
                    maxIndex = i;
                }
            }

            // Adjust the largest allocation
            allocations[maxIndex] = {
                ...allocations[maxIndex],
                allocatedAmount: this.round(
                    allocations[maxIndex].allocatedAmount + difference,
                    2
                )
            };
        }

        return allocations;
    }

    /**
     * Round to specified decimal places.
     */
    private round(value: number, decimals: number): number {
        const multiplier = Math.pow(10, decimals);
        return Math.round(value * multiplier) / multiplier;
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

/**
 * Default expense allocation policy instance.
 *
 * Use this for most cases. Create a new instance only if you need
 * to extend or customize the behavior.
 */
export const expenseAllocationPolicy: IExpenseAllocationPolicy = new ExpenseAllocationPolicy();

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Quick helper to calculate equal split allocations.
 *
 * @param plots - Plots to allocate to
 * @param totalCost - Cost to split
 * @returns Allocations with equal percentages
 */
export function calculateEqualSplit(
    plots: PlotInfo[],
    totalCost: number
): PlotAllocation[] {
    return expenseAllocationPolicy.calculateAllocations(
        plots,
        totalCost,
        'EQUAL'
    );
}

/**
 * Quick helper to calculate acreage-based allocations.
 *
 * @param plots - Plots to allocate to (must have acreage)
 * @param totalCost - Cost to split
 * @returns Allocations proportional to acreage
 */
export function calculateAcreageSplit(
    plots: PlotInfo[],
    totalCost: number
): PlotAllocation[] {
    return expenseAllocationPolicy.calculateAllocations(
        plots,
        totalCost,
        'BY_ACREAGE'
    );
}

/**
 * Determine the best allocation strategy for a given context.
 *
 * Heuristics:
 * - If all plots have acreage data and costs seem per-acre related, use BY_ACREAGE
 * - Otherwise, default to EQUAL
 *
 * @param plots - Plots to evaluate
 * @param expenseCategory - Optional category hint (e.g., 'fertilizer', 'fuel')
 * @returns Recommended allocation strategy
 */
export function recommendStrategy(
    plots: PlotInfo[],
    expenseCategory?: string
): AllocationStrategy {
    // Check if all plots have acreage data
    const allHaveAcreage = plots.every(p => p.acreage !== undefined && p.acreage > 0);

    // Categories that are typically per-acre
    const perAcreCategories = [
        'fertilizer',
        'pesticide',
        'fungicide',
        'herbicide',
        'seed',
        'input'
    ];

    if (allHaveAcreage && expenseCategory) {
        const normalizedCategory = expenseCategory.toLowerCase();
        if (perAcreCategories.some(cat => normalizedCategory.includes(cat))) {
            return 'BY_ACREAGE';
        }
    }

    return 'EQUAL';
}
