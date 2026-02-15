/**
 * Canonical Selection Selectors for AgriLog
 *
 * CRITICAL: All access to FarmContext.selection MUST go through these selectors.
 *
 * Why this matters:
 * - Direct `selection[0]` access is fragile and scattered
 * - Selection semantics may evolve (multi-crop, farm-wide, etc.)
 * - Centralized selectors enable consistent behavior and testing
 *
 * This module is the SINGLE SOURCE OF TRUTH for selection access.
 */

import { FarmContext, LogScope } from '../../types';

/**
 * Scope kinds representing different selection granularities.
 */
export type ScopeKind = 'FARM' | 'CROP' | 'PLOT' | 'MULTI';

/**
 * Represents a single crop's selection within the context.
 */
export interface CropSelection {
    cropId: string;
    cropName: string;
    selectedPlotIds: string[];
    selectedPlotNames: string[];
}

/**
 * Get the primary (first) selection from a FarmContext.
 *
 * Use this when you need the "main" selection context, typically for
 * single-context operations like logging.
 *
 * @param context - The FarmContext, may be null
 * @returns The primary CropSelection, or null if none exists
 *
 * @example
 * const primary = getPrimarySelection(logContext);
 * if (primary) {
 *     console.log(`Logging for crop: ${primary.cropName}`);
 * }
 */
export function getPrimarySelection(context: FarmContext | null): CropSelection | null {
    if (!context) return null;
    if (!context.selection || context.selection.length === 0) return null;
    return context.selection[0];
}

/**
 * Get all selected plot IDs across all crops in the context.
 *
 * @param context - The FarmContext, may be null
 * @returns Array of all selected plot IDs (may be empty)
 *
 * @example
 * const plotIds = getSelectedPlotIds(logContext);
 * plotIds.forEach(pid => attachWeather(pid));
 */
export function getSelectedPlotIds(context: FarmContext | null): string[] {
    if (!context) return [];
    if (!context.selection || context.selection.length === 0) return [];

    return context.selection.flatMap(sel => sel.selectedPlotIds);
}

/**
 * Get all selected crop IDs in the context.
 *
 * @param context - The FarmContext, may be null
 * @returns Array of all selected crop IDs (may be empty)
 */
export function getSelectedCropIds(context: FarmContext | null): string[] {
    if (!context) return [];
    if (!context.selection || context.selection.length === 0) return [];

    return context.selection.map(sel => sel.cropId);
}

/**
 * Determine the scope kind based on the selection.
 *
 * Scope kinds:
 * - FARM: No specific selection or farm-wide context
 * - CROP: Single crop selected (may have multiple plots)
 * - PLOT: Single plot selected
 * - MULTI: Multiple crops or multiple unrelated plots selected
 *
 * @param context - The FarmContext, may be null
 * @returns The ScopeKind representing the selection granularity
 *
 * @example
 * const kind = getScopeKind(logContext);
 * if (kind === 'PLOT') {
 *     // Single plot operations
 * } else if (kind === 'MULTI') {
 *     // Broadcast operations
 * }
 */
export function getScopeKind(context: FarmContext | null): ScopeKind {
    if (!context) return 'FARM';
    if (!context.selection || context.selection.length === 0) return 'FARM';

    // Multiple crops selected = MULTI
    if (context.selection.length > 1) return 'MULTI';

    // Single crop
    const primary = context.selection[0];

    // No plots = CROP level
    if (primary.selectedPlotIds.length === 0) return 'CROP';

    // Single plot = PLOT level
    if (primary.selectedPlotIds.length === 1) return 'PLOT';

    // Multiple plots of same crop = MULTI (broadcast within crop)
    return 'MULTI';
}

/**
 * Check if a specific plot is selected in the context.
 *
 * @param context - The FarmContext, may be null
 * @param plotId - The plot ID to check
 * @returns true if the plot is selected
 */
export function isPlotSelected(context: FarmContext | null, plotId: string): boolean {
    return getSelectedPlotIds(context).includes(plotId);
}

/**
 * Check if a specific crop is selected in the context.
 *
 * @param context - The FarmContext, may be null
 * @param cropId - The crop ID to check
 * @returns true if the crop is selected
 */
export function isCropSelected(context: FarmContext | null, cropId: string): boolean {
    return getSelectedCropIds(context).includes(cropId);
}

/**
 * Get the primary plot ID (first plot of first selection).
 *
 * @param context - The FarmContext, may be null
 * @returns The primary plot ID, or null if none exists
 */
export function getPrimaryPlotId(context: FarmContext | null): string | null {
    const primary = getPrimarySelection(context);
    if (!primary) return null;
    if (primary.selectedPlotIds.length === 0) return null;
    return primary.selectedPlotIds[0];
}

/**
 * Get the primary crop ID.
 *
 * @param context - The FarmContext, may be null
 * @returns The primary crop ID, or null if none exists
 */
export function getPrimaryCropId(context: FarmContext | null): string | null {
    const primary = getPrimarySelection(context);
    return primary?.cropId ?? null;
}

/**
 * Get selection count (number of plots selected).
 *
 * @param context - The FarmContext, may be null
 * @returns Number of selected plots
 */
export function getSelectionCount(context: FarmContext | null): number {
    return getSelectedPlotIds(context).length;
}

/**
 * Check if context has any active selection.
 *
 * @param context - The FarmContext, may be null
 * @returns true if at least one plot is selected
 */
export function hasSelection(context: FarmContext | null): boolean {
    return getSelectedPlotIds(context).length > 0;
}

// Re-export types for convenience
export type { FarmContext, LogScope };
