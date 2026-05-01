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
import type { DailyLog } from '../../../types';

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

export const getScopedLogCost = (
    log: DailyLog,
    allowedCropIds: Set<string>,
    allowedPlotIds: Set<string>
): number => {
    const baseCost = getLogCost(log);
    if (baseCost <= 0) return 0;

    const allSelections = getNonGlobalSelections(log);
    if (allSelections.length === 0) return 0;

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
