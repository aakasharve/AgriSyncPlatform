/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * उत्पन्न आणि खर्च — the money parts of "पूर्ण शेतीचा आढावा". Pure: real records in, figures out.
 *
 * Sources (the same ones the old page read):
 *   - cost: each log's `financialSummary`, narrowed by `getScopedLogCost` (a multi-plot record is split by
 *     plot; a FARM-WIDE cost counts only in the farm total, and only when nothing is narrowed —
 *     `isWholeFarmSelection`; it is never spread over plots);
 *   - income: harvest sessions (`getHarvestSessions`) and other income (`getOtherIncomeEntries`), passed in.
 *
 * Parts:
 *   - `buildInHand`: the old "In Hand Income" card's sum, unchanged (picked plots' session income + all
 *     other income).
 *   - `buildSeasonTotals`: cost and income over EVERY record so far (the old snapshot was labelled "so far"
 *     but only covered the chart's week or month), income − cost, and the harvest entries per crop.
 *   - `buildSpend`: the old Cost & Analysis chart — by day (week view) or by week (month view), by crop,
 *     by plot — plus what the money went on (labour / inputs / machinery / other).
 *
 * THE RULE (P4): a figure with nothing recorded behind it is `null`, and the page shows "—". In particular
 * income − cost needs BOTH: an income nobody has recorded yet is not ₹ 0.
 */
import type { CropProfile, DailyLog } from '../../../types';
import type { HarvestSession, OtherIncomeEntry } from '../../logs/harvest.types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import {
    getScopedLogCost, getWeekStartKey, isWholeFarmSelection, isWithinRange, normalizeDateKey, toNoonDate,
} from '../../analysis/components/costAnalysisHelpers';
import { addDays, dateLabel, fromDateKey, monthLabel, weekdayShortOf } from './reflectDates';
import type { ViewScope } from './reflectSelection';

const FARM_GLOBAL = 'FARM_GLOBAL';

export interface IncomeSources {
    sessionsFor: (plotId: string, cropId: string) => HarvestSession[];
    otherIncome: readonly OtherIncomeEntry[];
}

interface ScopedPlot { cropId: string; plotId: string; plotName: string; color: string }

/** The crops and plots money is counted over: the picked ones (a crop with no picked list = all its plots). */
const scopedPlotsOf = (crops: readonly CropProfile[], scope: ViewScope): { cropIds: string[]; plots: ScopedPlot[] } => {
    const requested = scope.viewCrops.length > 0 ? scope.viewCrops : crops.map(c => c.id);
    const cropIds = requested.filter(id => id !== FARM_GLOBAL);
    const plots = cropIds.flatMap(cropId => {
        const c = crops.find(x => x.id === cropId);
        if (!c) return [];
        const picked = scope.viewPlots[cropId]?.length ? scope.viewPlots[cropId] : c.plots.map(p => p.id);
        return c.plots.filter(p => picked.includes(p.id)).map(p => ({ cropId, plotId: p.id, plotName: p.name, color: c.color }));
    });
    return { cropIds, plots };
};

/** The farm-total filter: empty sets when nothing is narrowed, so a farm-wide cost lands in the total. */
const farmTotalFilter = (crops: readonly CropProfile[], scope: ViewScope) => {
    if (isWholeFarmSelection(crops, scope.viewCrops, scope.viewPlots)) return { cropIds: new Set<string>(), plotIds: new Set<string>() };
    const { cropIds, plots } = scopedPlotsOf(crops, scope);
    return { cropIds: new Set(cropIds), plotIds: new Set(plots.map(p => p.plotId)) };
};

/** The in-hand card: unchanged from the old page — picked plots' harvest income + all other income. */
export function buildInHand(scope: ViewScope, sources: IncomeSources): number | null {
    let total = 0;
    let recorded = false;
    for (const cropId of scope.viewCrops) {
        for (const plotId of scope.viewPlots[cropId] ?? []) {
            for (const s of sources.sessionsFor(plotId, cropId)) { total += s.totalIncome ?? 0; recorded = true; }
        }
    }
    for (const o of sources.otherIncome) { total += o.amount; recorded = true; }
    return recorded ? total : null;
}

export interface SeasonTotals {
    cost: number | null;
    income: number | null;
    net: number | null;
    harvest: { cropId: string; cropName: string; color: string; entries: number }[];
}

export function buildSeasonTotals(logs: readonly DailyLog[], crops: readonly CropProfile[], scope: ViewScope, sources: IncomeSources): SeasonTotals {
    const filter = farmTotalFilter(crops, scope);
    const { cropIds, plots } = scopedPlotsOf(crops, scope);
    const scopedPlotIds = new Set(plots.map(p => p.plotId));

    let cost = 0;
    let costRecorded = false;
    for (const l of logs) {
        const c = getScopedLogCost(l, filter.cropIds, filter.plotIds);
        if (c > 0) { cost += c; costRecorded = true; }
    }

    let income = 0;
    let incomeRecorded = false;
    const entriesByCrop = new Map<string, number>();
    const seen = new Set<string>();
    for (const p of plots) {
        for (const s of sources.sessionsFor(p.plotId, p.cropId)) {
            if (seen.has(s.id)) continue;
            seen.add(s.id);
            for (const sale of s.saleEntries ?? []) { income += sale.netAmount ?? sale.totalAmount ?? 0; incomeRecorded = true; }
            entriesByCrop.set(p.cropId, (entriesByCrop.get(p.cropId) ?? 0) + (s.harvestEntries?.length ?? 0));
        }
    }
    for (const o of sources.otherIncome) {
        if (o.cropId && !cropIds.includes(o.cropId)) continue;
        if (o.plotId && !scopedPlotIds.has(o.plotId)) continue;
        income += o.amount;
        incomeRecorded = true;
    }

    const costOrNull = costRecorded ? Math.round(cost) : null;
    const incomeOrNull = incomeRecorded ? Math.round(income) : null;
    return {
        cost: costOrNull,
        income: incomeOrNull,
        net: costOrNull !== null && incomeOrNull !== null ? incomeOrNull - costOrNull : null,
        harvest: cropIds.map(id => crops.find(c => c.id === id)).filter((c): c is CropProfile => !!c)
            .map(c => ({ cropId: c.id, cropName: c.name, color: c.color, entries: entriesByCrop.get(c.id) ?? 0 })),
    };
}

export type SpendMode = 'week' | 'month';
export interface SpendRange { startKey: string; endKey: string; bucket: 'daily' | 'weekly'; label: string }

/** Week view: the 7 days ending on the chosen day. Month view: the calendar's month, by week. */
export function spendRange(mode: SpendMode, date: Date, monthView: Date): SpendRange {
    if (mode === 'week') {
        const start = addDays(date, -6);
        return { startKey: getDateKey(start), endKey: getDateKey(date), bucket: 'daily', label: `${dateLabel(start)} – ${dateLabel(date)}` };
    }
    const first = new Date(monthView.getFullYear(), monthView.getMonth(), 1, 12);
    const last = new Date(monthView.getFullYear(), monthView.getMonth() + 1, 0, 12);
    return { startKey: getDateKey(first), endKey: getDateKey(last), bucket: 'weekly', label: monthLabel(monthView) };
}

export interface SpendPoint { key: string; label: string; value: number }
export interface SpendBar extends SpendPoint { color: string }
export interface SpendMix { labour: number; inputs: number; machinery: number; other: number }
export interface Spend {
    /** `null` = no cost recorded in the range. */
    total: number | null;
    points: SpendPoint[];
    byCrop: SpendBar[];
    byPlot: SpendBar[];
    mix: SpendMix | null;
}

export function buildSpend(logs: readonly DailyLog[], crops: readonly CropProfile[], scope: ViewScope, range: SpendRange): Spend {
    const inRange = logs.filter(l => isWithinRange(normalizeDateKey(l.date), range.startKey, range.endKey));
    const filter = farmTotalFilter(crops, scope);
    const { cropIds, plots } = scopedPlotsOf(crops, scope);

    const totals = new Map<string, number>();
    const mix: SpendMix = { labour: 0, inputs: 0, machinery: 0, other: 0 };
    let total = 0;
    for (const l of inRange) {
        const scoped = getScopedLogCost(l, filter.cropIds, filter.plotIds);
        if (scoped <= 0) continue;
        const dayKey = normalizeDateKey(l.date);
        const bucketKey = range.bucket === 'daily' ? dayKey : getWeekStartKey(dayKey);
        totals.set(bucketKey, (totals.get(bucketKey) ?? 0) + scoped);
        total += scoped;
        const f = l.financialSummary;
        const ratio = scoped / f.grandTotal;
        const known = (f.totalLabourCost ?? 0) + (f.totalInputCost ?? 0) + (f.totalMachineryCost ?? 0);
        mix.labour += (f.totalLabourCost ?? 0) * ratio;
        mix.inputs += (f.totalInputCost ?? 0) * ratio;
        mix.machinery += (f.totalMachineryCost ?? 0) * ratio;
        mix.other += Math.max(0, f.grandTotal - known) * ratio;
    }

    const points: SpendPoint[] = [];
    if (range.bucket === 'daily') {
        for (let d = toNoonDate(range.startKey); getDateKey(d) <= range.endKey; d = addDays(d, 1)) {
            const key = getDateKey(d);
            points.push({ key, label: weekdayShortOf(d), value: Math.round(totals.get(key) ?? 0) });
        }
    } else {
        const endWeek = getWeekStartKey(range.endKey);
        for (let d = toNoonDate(getWeekStartKey(range.startKey)); getDateKey(d) <= endWeek; d = addDays(d, 7)) {
            const key = getDateKey(d);
            points.push({ key, label: dateLabel(fromDateKey(key)), value: Math.round(totals.get(key) ?? 0) });
        }
    }

    const sumFor = (cropSet: Set<string>, plotSet: Set<string>) =>
        Math.round(inRange.reduce((s, l) => s + getScopedLogCost(l, cropSet, plotSet), 0));
    const byPlot = plots.map(p => ({ key: p.plotId, label: p.plotName, color: p.color, value: sumFor(new Set([p.cropId]), new Set([p.plotId])) }));
    const byCrop = cropIds.map(id => crops.find(c => c.id === id)).filter((c): c is CropProfile => !!c).map(c => ({
        key: c.id, label: c.name, color: c.color,
        value: sumFor(new Set([c.id]), new Set(plots.filter(p => p.cropId === c.id).map(p => p.plotId))),
    }));

    const recorded = total > 0;
    return {
        total: recorded ? Math.round(total) : null,
        points,
        byCrop,
        byPlot,
        mix: recorded ? { labour: Math.round(mix.labour), inputs: Math.round(mix.inputs), machinery: Math.round(mix.machinery), other: Math.round(mix.other) } : null,
    };
}

/** The biggest bar ("सर्वात जास्त खर्च"), or nothing when nothing was spent. */
export const topOf = <T extends SpendPoint>(points: readonly T[]): T | undefined =>
    points.reduce<T | undefined>((best, p) => (p.value > 0 && (!best || p.value > best.value) ? p : best), undefined);
