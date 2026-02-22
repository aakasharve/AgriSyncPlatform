/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cost Calculation Utilities for Daily Work Summary
 * 
 * Core Principle: Every rupee must be traceable to a logged event.
 * No estimates, no assumptions, only recorded data.
 */

import { CostBreakdown } from '../../types';

/**
 * Calculate total labour cost from male/female counts and rates
 * Rates MUST come from Settings (LedgerDefaults), never user-typed
 */
export const calculateLabourCost = (
    maleCount: number,
    femaleCount: number,
    maleRate: number,
    femaleRate: number
): number => {
    return (maleCount * maleRate) + (femaleCount * femaleRate);
};

/**
 * Calculate total machinery cost (fuel + rental)
 */
export const calculateMachineryCost = (
    fuelCost: number,
    rentalCost: number
): number => {
    return fuelCost + rentalCost;
};

/**
 * Calculate total daily cost from all event categories
 * This is the single source of truth for "Why ₹X?"
 */
export const calculateTotalDayCost = (
    labourCost: number,
    inputsCost: number,
    machineryCost: number
): number => {
    return labourCost + inputsCost + machineryCost;
};

/**
 * Validate cost consistency between displayed total and event sum
 * Used to ensure UI integrity: Total shown = Sum of event costs
 */
export const validateCostConsistency = (
    totalShown: number,
    eventSum: number
): boolean => {
    // Allow floating point precision tolerance (₹0.01)
    return Math.abs(totalShown - eventSum) < 0.01;
};

/**
 * Create detailed cost breakdown for traceability
 * Answers: "Which category contributed how much?"
 */
export const createCostBreakdown = (
    labourCost: number,
    inputsCost: number,
    machineryCost: number
): CostBreakdown => {
    return {
        labour: labourCost,
        inputs: inputsCost,
        machinery: machineryCost,
        total: calculateTotalDayCost(labourCost, inputsCost, machineryCost)
    };
};

/**
 * Format currency for Indian Rupee display
 */
export const formatCurrency = (amount: number): string => {
    return `₹${amount.toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    })}`;
};

/**
 * Calculate per-hour rate for labour
 * Useful for transparency: "₹400/person for 8 hours"
 */
export const calculateHourlyRate = (
    totalCost: number,
    hours: number
): number => {
    if (hours === 0) return 0;
    return totalCost / hours;
};
