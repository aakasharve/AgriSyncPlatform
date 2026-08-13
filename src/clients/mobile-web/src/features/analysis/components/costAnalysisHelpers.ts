/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 9 / file-decompose easy-wins — extracted from
 * CostAnalysisSection.tsx to bring the parent below the 800-line cap.
 *
 * Pure helper functions: chart palette/geometry + date utilities.
 * No React, no state. Safe to share with sibling chart sub-components
 * (BarSpendChart, PieSpendChart) without prop drilling.
 */

import { getDateKey } from '../../../core/domain/services/DateKeyService';
import type { CropProfile, DailyLog } from '../../../types';

// ---------------- Chart palette ----------------

export const CHART_COLORS = ['#0EA5E9', '#22C55E', '#F59E0B', '#8B5CF6', '#EF4444', '#14B8A6', '#F97316', '#6366F1'];

export const BAR_GRADIENTS: Array<[string, string]> = [
    ['#67E8F9', '#0284C7'],
    ['#86EFAC', '#16A34A'],
    ['#FDE68A', '#D97706'],
    ['#C4B5FD', '#7C3AED'],
    ['#FDA4AF', '#DC2626'],
    ['#5EEAD4', '#0F766E'],
    ['#FDBA74', '#C2410C'],
    ['#A5B4FC', '#4338CA']
];

export const getPaletteColor = (index: number): string => CHART_COLORS[index % CHART_COLORS.length];

export const getBarGradient = (index: number): [string, string] => BAR_GRADIENTS[index % BAR_GRADIENTS.length];

export const darkenHex = (hex: string, factor: number = 0.68): string => {
    const raw = hex.replace('#', '');
    if (raw.length !== 6) return hex;
    const r = Math.max(0, Math.floor(parseInt(raw.slice(0, 2), 16) * factor));
    const g = Math.max(0, Math.floor(parseInt(raw.slice(2, 4), 16) * factor));
    const b = Math.max(0, Math.floor(parseInt(raw.slice(4, 6), 16) * factor));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

// ---------------- Pie/sector geometry ----------------

export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const angle = toRadians(angleDeg - 90);
    return {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle)
    };
};

export const buildSectorPath = (cx: number, cy: number, r: number, startAngle: number, endAngle: number): string => {
    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, endAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
};

export const safePercent = (value: number): number => {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.round(value * 10) / 10;
};

// ---------------- Date utilities ----------------

export const normalizeDateKey = (value: string): string => {
    if (!value) return '';
    return value.includes('T') ? value.split('T')[0] : value;
};

export const toNoonDate = (dateKey: string): Date => new Date(`${dateKey}T12:00:00`);

export const isWithinRange = (dateKey: string, startDateKey: string, endDateKey: string): boolean => {
    return dateKey >= startDateKey && dateKey <= endDateKey;
};

export const getWeekStartKey = (dateKey: string): string => {
    const date = toNoonDate(dateKey);
    const day = date.getDay();
    const shift = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + shift);
    return getDateKey(date);
};

export const formatShortDate = (dateKey: string): string => {
    return toNoonDate(dateKey).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short'
    });
};

export const truncateLabel = (label: string, maxLength: number = 12): string => {
    if (label.length <= maxLength) return label;
    return `${label.slice(0, maxLength - 1)}...`;
};

// ---------------- Log financial summary ----------------

export const getLogCost = (log: DailyLog): number => log.financialSummary?.grandTotal || 0;

// ---------------- Scope filtering ----------------

export const FARM_GLOBAL_ID = 'FARM_GLOBAL';

export interface ScopeSelection {
    cropId: string;
    plotIds: string[];
}

export const getNonGlobalSelections = (log: DailyLog): ScopeSelection[] => {
    return (log.context?.selection || [])
        .filter(selection => selection.cropId && selection.cropId !== FARM_GLOBAL_ID)
        .map(selection => ({
            cropId: selection.cropId,
            plotIds: Array.from(new Set(selection.selectedPlotIds || []))
        }));
};

export const getUniquePlotIds = (selections: ScopeSelection[]): string[] => {
    return Array.from(new Set(selections.flatMap(selection => selection.plotIds)));
};

/**
 * LABOUR_PHASE2 P2.3 — did the farmer record this at farm level?
 *
 * Both writers encode that the same way: `LogFactory.ts:402-407` and the pull
 * reconciler (`logsReconciler.ts`) build a single selection with cropId
 * FARM_GLOBAL and empty plot arrays. A selection with a missing/blank cropId is
 * deliberately NOT counted — "we don't know the scope" is not the farmer
 * asserting "the whole farm".
 */
const hasFarmWideSelection = (log: DailyLog): boolean =>
    (log.context?.selection || []).some(selection => selection.cropId === FARM_GLOBAL_ID);

/**
 * LABOUR_PHASE2 P2.4 — has the farmer narrowed the view to anything at all?
 *
 * ── THE BUG THIS EXISTS TO REACH ─────────────────────────────────────────────
 * `getScopedLogCost` below already knows what to do with a farm-wide cost: an
 * EMPTY filter set means "not filtered", so the cost lands in the farm total and
 * is excluded from every narrower one. That branch was shipped and tested at
 * `16a314a6` — and it was UNREACHABLE from the farmer's screen.
 *
 * Both callers resolve "nothing selected" into "every crop, every plot" before
 * calling it (`CostAnalysisSection` for the crop list and the per-crop plot
 * list, `ReflectPage` by seeding both to all on mount). So the filter sets are
 * ALWAYS populated, the empty-set branch can never be entered, and a farm-wide
 * cost the farmer really incurred reported ₹0 — a fabricated number reaching a
 * farmer (`P4`), in the direction that under-reports what he spent.
 *
 * ── WHY A PREDICATE AND NOT "JUST DON'T RESOLVE" ─────────────────────────────
 * The resolution is load-bearing everywhere else: chart labels, per-crop series,
 * per-plot comparison and the harvest/income joins all need the concrete lists.
 * Un-resolving them would fix the total and break five other things. So the
 * resolved lists stay exactly as they are, and this answers the ONE question
 * they destroyed — *did the farmer ask for everything, or for something?*
 *
 * "Everything" is the honest reading of both an empty selection and an explicit
 * select-all: a farmer who ticks every plot has narrowed nothing, and his farm
 * total should not depend on which of the two routes he took to say so.
 *
 * ── WHAT IT DOES NOT DO (founder ruling, and `P1`) ───────────────────────────
 * It never causes a farm-wide amount to be attributed to a plot. It only widens
 * the FARM TOTAL. Splitting a farm-wide cost across plots would invent an
 * allocation the farmer never gave (founder decision `O-2`); that split has a
 * home already — `DayLedger` / `ExpenseAllocationPolicy` — and it is a Finance
 * ticket, never a Labour edit.
 */
export const isWholeFarmSelection = (
    crops: readonly CropProfile[],
    selectedCropIds: readonly string[],
    selectedPlotsByCrop: Readonly<Record<string, readonly string[]>>
): boolean => {
    // A selection naming FARM_GLOBAL is not the farmer naming a crop, and the
    // crop list never contains it — strip it before comparing, exactly as
    // `CostAnalysisSection.cropIdList` already does.
    const namedCropIds = selectedCropIds.filter(cropId => cropId !== FARM_GLOBAL_ID);

    // Narrowed to a subset of crops -> not the whole farm. An empty list is
    // "not filtered", the same convention `getScopedLogCost` and
    // `dayState.logInScope` already read.
    if (namedCropIds.length > 0) {
        const selected = new Set(namedCropIds);
        if (crops.some(crop => !selected.has(crop.id))) return false;
    }

    // Narrowed to a subset of plots WITHIN any crop -> not the whole farm
    // either. A farm-wide cost is not that plot's cost, so the farm total is
    // the only figure it may appear in.
    return crops.every(crop => {
        const selectedPlotIds = selectedPlotsByCrop[crop.id];
        if (!selectedPlotIds || selectedPlotIds.length === 0) return true;

        const selected = new Set(selectedPlotIds);
        return (crop.plots || []).every(plot => selected.has(plot.id));
    });
};

export const getScopedLogCost = (
    log: DailyLog,
    allowedCropIds: Set<string>,
    allowedPlotIds: Set<string>
): number => {
    const baseCost = getLogCost(log);
    if (baseCost <= 0) return 0;

    const allSelections = getNonGlobalSelections(log);
    if (allSelections.length === 0) {
        // LABOUR_PHASE2 P2.3 — a farm-wide log's only selection is the
        // FARM_GLOBAL one, which `getNonGlobalSelections` strips, so this
        // returned 0 unconditionally: a cost the farmer actually incurred
        // vanished from cost analysis entirely, filter or no filter. That is
        // the under-count half of the P4 failure.
        //
        // It belongs in the farm-level total, and ONLY there. Spreading it over
        // the plots would invent an allocation the farmer never gave (founder
        // decision O-2), so a crop filter or a plot filter still excludes it —
        // a farm-wide cost genuinely is not that plot's cost. An empty filter
        // set means "not filtered", the same convention `dayState.logInScope`
        // (dayState.ts:119-129) already reads.
        if (!hasFarmWideSelection(log)) return 0;
        if (allowedCropIds.size > 0 || allowedPlotIds.size > 0) return 0;
        return baseCost;
    }

    const cropScopedSelections = allowedCropIds.size > 0
        ? allSelections.filter(selection => allowedCropIds.has(selection.cropId))
        : allSelections;
    if (cropScopedSelections.length === 0) return 0;

    const allPlotIds = getUniquePlotIds(allSelections);
    const hasPlotFilter = allowedPlotIds.size > 0;
    const hasPlotGranularity = allPlotIds.length > 0 && cropScopedSelections.some(selection => selection.plotIds.length > 0);

    if (hasPlotGranularity) {
        const scopedPlotIds = Array.from(new Set(
            cropScopedSelections.flatMap(selection => selection.plotIds)
        )).filter(plotId => !hasPlotFilter || allowedPlotIds.has(plotId));

        if (scopedPlotIds.length === 0) return 0;
        return baseCost * (scopedPlotIds.length / allPlotIds.length);
    }

    if (hasPlotFilter) return 0;
    return baseCost * (cropScopedSelections.length / allSelections.length);
};
