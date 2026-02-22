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
 */
export function getPrimarySelection(context: FarmContext | null): CropSelection | null {
    if (!context) return null;
    if (!context.selection || context.selection.length === 0) return null;
    return context.selection[0];
}

/**
 * Get all selected plot IDs across all crops in the context.
 */
export function getSelectedPlotIds(context: FarmContext | null): string[] {
    if (!context) return [];
    if (!context.selection || context.selection.length === 0) return [];

    return context.selection.flatMap(sel => sel.selectedPlotIds);
}

/**
 * Get all selected crop IDs in the context.
 */
export function getSelectedCropIds(context: FarmContext | null): string[] {
    if (!context) return [];
    if (!context.selection || context.selection.length === 0) return [];

    return context.selection.map(sel => sel.cropId);
}

/**
 * Determine the scope kind based on the selection.
 */
export function getScopeKind(context: FarmContext | null): ScopeKind {
    if (!context) return 'FARM';
    if (!context.selection || context.selection.length === 0) return 'FARM';

    if (context.selection.length > 1) return 'MULTI';

    const primary = context.selection[0];

    if (primary.selectedPlotIds.length === 0) return 'CROP';
    if (primary.selectedPlotIds.length === 1) return 'PLOT';

    return 'MULTI';
}

export function isPlotSelected(context: FarmContext | null, plotId: string): boolean {
    return getSelectedPlotIds(context).includes(plotId);
}

export function isCropSelected(context: FarmContext | null, cropId: string): boolean {
    return getSelectedCropIds(context).includes(cropId);
}

export function getPrimaryPlotId(context: FarmContext | null): string | null {
    const primary = getPrimarySelection(context);
    if (!primary) return null;
    if (primary.selectedPlotIds.length === 0) return null;
    return primary.selectedPlotIds[0];
}

export function getPrimaryCropId(context: FarmContext | null): string | null {
    const primary = getPrimarySelection(context);
    return primary?.cropId ?? null;
}

export function getSelectionCount(context: FarmContext | null): number {
    return getSelectedPlotIds(context).length;
}

export function hasSelection(context: FarmContext | null): boolean {
    return getSelectedPlotIds(context).length > 0;
}

// Re-export types for convenience
export type { FarmContext, LogScope };
