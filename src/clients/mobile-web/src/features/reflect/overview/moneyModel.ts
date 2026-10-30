/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3; lane RF) — उत्पन्न आणि खर्च on "पूर्ण शेतीचा आढावा".
 * Pure: the farm's money ledger in, figures out.
 *
 * SOURCE (lane RF, founder 2026-10-30 "the server is the truth"): the SERVER's cost ledger as this phone holds it —
 * its cost entries with the finance corrections applied (`financeSelectors.getEffectiveMoneyEvents`, read by
 * `useMoneyLedger`). Never a log's own guessed total: lane F1 removed the totals a pulled log used to be given, so a
 * figure built from them would silently drop every record from another phone. Each entry keeps its own direction
 * (spent / received), category, plot and date, exactly as the server holds them.
 *
 * Scope (unchanged rule): with nothing narrowed every entry of the farm counts, whole-farm ones too; narrowed to
 * crops / plots, an entry counts when its plot is one of the picked plots — a whole-farm entry is no plot's and is
 * never spread over plots. A crop is the sum of its picked plots.
 *
 * THE RULES (P4):
 *   - nothing recorded → `amount: null` (the page shows "—"), never ₹ 0; income − spent needs BOTH;
 *   - money this person may not see → `hidden` and no amount (`mayShowFarmMoney`, founder D-22);
 *   - a total made from an INCOMPLETE set says so (`partial`): money told on this phone that is not in the server's
 *     ledger yet (in the outbox, or kept on the phone — `LedgerGap`), or an older amount that never said whether it
 *     came in or went out (direction unknown: it falls out of both totals instead of being guessed into one).
 */
import type { CropProfile } from '../../../types';
import type { MoneyCategory, MoneyEventDirection } from '../../finance/finance.types';
import type { HarvestSession } from '../../logs/harvest.types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { getWeekStartKey, isWholeFarmSelection, isWithinRange, toNoonDate } from '../../analysis/components/costAnalysisHelpers';
import { addDays, dateLabel, fromDateKey, monthLabel, weekdayShortOf } from './reflectDates';
import type { ViewScope } from './reflectSelection';

const FARM_GLOBAL = 'FARM_GLOBAL';

/** One entry of the server's ledger (corrections applied). */
export interface LedgerEntry {
    id: string;
    /** Absent = a whole-farm entry. */
    plotId?: string;
    /** YYYY-MM-DD */
    dateKey: string;
    direction: MoneyEventDirection;
    category: MoneyCategory;
    amount: number;
}

/** Money told on this phone that the server's ledger does not hold yet. */
export interface LedgerGap {
    plotId?: string;
    dateKey: string;
    direction: MoneyEventDirection;
}

export interface Ledger {
    entries: readonly LedgerEntry[];
    gaps: readonly LedgerGap[];
}

export const EMPTY_LEDGER: Ledger = { entries: [], gaps: [] };

/** Why a total is not the whole story. */
export type PartialReason = 'notOnServer' | 'unknownDirection';

export interface MoneyFigure {
    /** `null` = nothing recorded, or not his to see. */
    amount: number | null;
    /** Money he may not see: the page shows "—" and says why. */
    hidden: boolean;
    /** Empty = a complete figure. */
    partial: PartialReason[];
}

const HIDDEN: MoneyFigure = { amount: null, hidden: true, partial: [] };

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

/** Does an entry (or a gap) belong to the view? Nothing narrowed → every one; else its plot must be a picked plot. */
const inScopeOf = (crops: readonly CropProfile[], scope: ViewScope) => {
    if (isWholeFarmSelection(crops, scope.viewCrops, scope.viewPlots)) return () => true;
    const plotIds = new Set(scopedPlotsOf(crops, scope).plots.map(p => p.plotId));
    return (x: { plotId?: string }) => !!x.plotId && plotIds.has(x.plotId);
};

/** One direction's figure over a set: its sum (null when none), and why it is partial. */
function figureOf(entries: readonly LedgerEntry[], gaps: readonly LedgerGap[], direction: 'Expense' | 'Income'): MoneyFigure {
    const own = entries.filter(e => e.direction === direction);
    const partial: PartialReason[] = [];
    if (gaps.some(g => g.direction === direction || g.direction === 'Unknown')) partial.push('notOnServer');
    if (entries.some(e => e.direction === 'Unknown')) partial.push('unknownDirection');
    return { amount: own.length > 0 ? Math.round(own.reduce((s, e) => s + e.amount, 0)) : null, hidden: false, partial };
}

/** The in-hand card: everything received on the picked plots (the whole farm's too when nothing is narrowed). */
export function buildInHand(ledger: Ledger, crops: readonly CropProfile[], scope: ViewScope, visible: boolean): MoneyFigure {
    if (!visible) return HIDDEN;
    const inScope = inScopeOf(crops, scope);
    return figureOf(ledger.entries.filter(inScope), ledger.gaps.filter(inScope), 'Income');
}

export interface SeasonTotals {
    cost: MoneyFigure;
    income: MoneyFigure;
    net: MoneyFigure;
    /** How far each crop's harvest is recorded (harvest entries — not money). */
    harvest: { cropId: string; cropName: string; color: string; entries: number }[];
}

export function buildSeasonTotals(
    ledger: Ledger,
    crops: readonly CropProfile[],
    scope: ViewScope,
    sessionsFor: (plotId: string, cropId: string) => HarvestSession[],
    visible: boolean,
): SeasonTotals {
    const { cropIds, plots } = scopedPlotsOf(crops, scope);
    const entriesByCrop = new Map<string, number>();
    const seen = new Set<string>();
    for (const p of plots) {
        for (const s of sessionsFor(p.plotId, p.cropId)) {
            if (seen.has(s.id)) continue;
            seen.add(s.id);
            entriesByCrop.set(p.cropId, (entriesByCrop.get(p.cropId) ?? 0) + (s.harvestEntries?.length ?? 0));
        }
    }
    const harvest = cropIds.map(id => crops.find(c => c.id === id)).filter((c): c is CropProfile => !!c)
        .map(c => ({ cropId: c.id, cropName: c.name, color: c.color, entries: entriesByCrop.get(c.id) ?? 0 }));
    if (!visible) return { cost: HIDDEN, income: HIDDEN, net: HIDDEN, harvest };

    const inScope = inScopeOf(crops, scope);
    const entries = ledger.entries.filter(inScope);
    const gaps = ledger.gaps.filter(inScope);
    const cost = figureOf(entries, gaps, 'Expense');
    const income = figureOf(entries, gaps, 'Income');
    return {
        cost,
        income,
        net: {
            amount: cost.amount !== null && income.amount !== null ? income.amount - cost.amount : null,
            hidden: false,
            partial: [...new Set([...cost.partial, ...income.partial])],
        },
        harvest,
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
    /** Spent in the range; `amount: null` = nothing spent recorded (or not his to see). */
    total: MoneyFigure;
    points: SpendPoint[];
    byCrop: SpendBar[];
    byPlot: SpendBar[];
    /** What it went on, by the ledger's own category; `null` when nothing was spent. */
    mix: SpendMix | null;
}

const MIX_OF: Partial<Record<MoneyCategory, keyof SpendMix>> = { Labour: 'labour', Input: 'inputs', Machinery: 'machinery' };

export function buildSpend(ledger: Ledger, crops: readonly CropProfile[], scope: ViewScope, range: SpendRange, visible: boolean): Spend {
    const inRange = (x: { dateKey: string }) => isWithinRange(x.dateKey, range.startKey, range.endKey);
    const inScope = inScopeOf(crops, scope);
    const entries = ledger.entries.filter(e => inRange(e) && inScope(e));
    const spent = entries.filter(e => e.direction === 'Expense');
    const total = visible ? figureOf(entries, ledger.gaps.filter(g => inRange(g) && inScope(g)), 'Expense') : HIDDEN;
    const show = visible && total.amount !== null;

    const totals = new Map<string, number>();
    const mix: SpendMix = { labour: 0, inputs: 0, machinery: 0, other: 0 };
    for (const e of show ? spent : []) {
        const key = range.bucket === 'daily' ? e.dateKey : getWeekStartKey(e.dateKey);
        totals.set(key, (totals.get(key) ?? 0) + e.amount);
        mix[MIX_OF[e.category] ?? 'other'] += e.amount;
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

    const { cropIds, plots } = scopedPlotsOf(crops, scope);
    const sumOn = (plotIds: Set<string>) => Math.round((show ? spent : []).filter(e => !!e.plotId && plotIds.has(e.plotId)).reduce((s, e) => s + e.amount, 0));
    const byPlot = plots.map(p => ({ key: p.plotId, label: p.plotName, color: p.color, value: sumOn(new Set([p.plotId])) }));
    const byCrop = cropIds.map(id => crops.find(c => c.id === id)).filter((c): c is CropProfile => !!c).map(c => ({
        key: c.id, label: c.name, color: c.color, value: sumOn(new Set(plots.filter(p => p.cropId === c.id).map(p => p.plotId))),
    }));

    return {
        total,
        points,
        byCrop,
        byPlot,
        mix: show ? { labour: Math.round(mix.labour), inputs: Math.round(mix.inputs), machinery: Math.round(mix.machinery), other: Math.round(mix.other) } : null,
    };
}

/** A plot card's money for one day: what the ledger holds as spent on that plot that day. */
export function plotDayMoney(ledger: Ledger, plotId: string | undefined, dateKey: string, visible: boolean): MoneyFigure {
    if (!visible) return HIDDEN;
    if (!plotId) return { amount: null, hidden: false, partial: [] };
    const on = (x: { plotId?: string; dateKey: string }) => x.plotId === plotId && x.dateKey === dateKey;
    return figureOf(ledger.entries.filter(on), ledger.gaps.filter(on), 'Expense');
}

/** The biggest bar ("सर्वात जास्त खर्च"), or nothing when nothing was spent. */
export const topOf = <T extends SpendPoint>(points: readonly T[]): T | undefined =>
    points.reduce<T | undefined>((best, p) => (p.value > 0 && (!best || p.value > best.value) ? p : best), undefined);
