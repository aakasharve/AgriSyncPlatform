/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 8 — extracted from AppContent.tsx.
 *
 * Derive per-day / per-plot count rollups from the in-memory log
 * history. Pure functions — no React, no Dexie. Consumed by
 * AppFeatureContexts as `getTodayCounts` + `getTodayPlotData`.
 */

import { getDateKey } from '../../core/domain/services/DateKeyService';
// The WRITER's definition of the farm-scope sentinel, imported rather than
// re-typed. `log-factory-helpers.ts` declares it and its own docblock records
// that `costAnalysisHelpers`, `dayState` and `logsReconciler` still keep private
// copies — they sit under `features/` and may not import `core/domain` back
// without inverting the layering rule. This file is under `app/`, so it can and
// does take the real one: a fifth READER, not a fifth definition.
import { FARM_GLOBAL_ID } from '../../core/domain/helpers/log-factory-helpers';
import type { CropProfile, DailyLog, Plot } from '../../types';

export interface DailyCounts {
    cropActivities: number;
    irrigation: number;
    labour: number;
    inputs: number;
    machinery: number;
    activityExpenses: number;
    observations: number;
    reminders: number;
    disturbance: number;
    harvest: number;
}

const emptyCounts = (): DailyCounts => ({
    cropActivities: 0, irrigation: 0, labour: 0, inputs: 0,
    machinery: 0, activityExpenses: 0, observations: 0,
    reminders: 0, disturbance: 0, harvest: 0,
});

function tallyLog(counts: DailyCounts, log: DailyLog): void {
    counts.cropActivities += (log.cropActivities?.length || 0);
    counts.irrigation += (log.irrigation?.length || 0);
    counts.labour += (log.labour?.length || 0);
    counts.inputs += (log.inputs?.length || 0);
    counts.machinery += (log.machinery?.length || 0);
    counts.activityExpenses += (log.activityExpenses?.length || 0);
    counts.observations += (log.observations?.filter(o => o.noteType !== 'reminder').length || 0);
    counts.reminders += (log.observations?.filter(o => o.noteType === 'reminder').length || 0);
    if (log.disturbance) counts.disturbance += 1;
}

/**
 * LABOUR_PHASE2 B1b — read EVERY selection entry, not just `[0]`.
 *
 * A selection is one entry per crop, so `selection[0]` answered only for the
 * first crop and silently dropped the second crop's plots: a two-crop log
 * reported ZERO work for every plot of its second crop. That was already
 * reachable, and B1b makes it routine — one save across two crops is now ONE
 * record with two entries rather than one record per plot.
 *
 * The farm-wide exclusion is untouched and deliberate: a farm-wide log's only
 * entry carries an EMPTY plot list, so it matches no plot here. Its consumer
 * chain sums these per-plot maps across the plots in context, so counting a
 * farm-wide log for each plot would report one farm-wide record N times — see
 * `appContentDailyCounts.farmScope.test.ts`.
 */
export function getTodayCounts(
    history: DailyLog[],
    plotId: string,
    dateStr: string,
): DailyCounts {
    const dayLogs = history.filter(l => {
        const isDate = l.date === dateStr;
        const hasPlot = l.context.selection.some(sel => sel?.selectedPlotIds?.includes(plotId));
        return isDate && hasPlot;
    });

    const counts = emptyCounts();
    dayLogs.forEach(log => tallyLog(counts, log));
    return counts;
}

/* ────────────────────────────────────────────────────────────────────────────
 * LABOUR_PHASE2 P2.4 — what the farmer recorded FOR THE WHOLE FARM today.
 *
 * READ THE WARNING ON `getTodayCounts` ABOVE BEFORE TOUCHING ANY OF THIS.
 *
 * The obvious "fix" for the farm-wide under-count is to make `getTodayCounts`
 * include farm-wide logs. Ruling `R24` measured what that does: its consumer
 * chain SUMS the per-plot maps across every plot in context, so one farm-wide
 * log gets counted once per plot and a plot with 3 labour entries reports 11.
 * `appContentDailyCounts.farmScope.test.ts` locks that door, deliberately.
 *
 * So the farm-wide total is a SEPARATE reader, keyed by nothing, summing each
 * record exactly once. It is not a per-plot number and can never be added to
 * one — there is no plot to add it to, which is the entire point (`P1`: the
 * farmer asserted "the whole farm", and the app may not quietly turn that into
 * a plot he never named).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One log's context, narrowed to what a scope question needs. Structural, so
 * both a `DailyLog['context']` and a live capture context satisfy it without
 * either being converted.
 */
export interface ScopeSelectionLike {
    cropId?: string;
    selectedPlotIds?: readonly string[];
}

/**
 * Did the farmer say "the whole farm"?
 *
 * Both writers encode it identically — one selection whose `cropId` is
 * `FARM_GLOBAL` with an empty plot list (`LogFactory`, and the pull reconciler
 * that rebuilds a log on a second device).
 *
 * A selection with a MISSING or blank `cropId` is deliberately NOT counted.
 * "We do not know the scope" is not the farmer asserting "everywhere", and
 * reading an absence as an assertion is the guess-scope-from-nothing
 * fabrication `O-1` closed. Same rule `costAnalysisHelpers.hasFarmWideSelection`
 * follows, so the cost total and this panel can never disagree about what
 * "farm-wide" means.
 */
export function isFarmWideSelection(
    selection: readonly ScopeSelectionLike[] | undefined | null,
): boolean {
    return (selection || []).some(entry => entry?.cropId === FARM_GLOBAL_ID);
}

/** What the farmer recorded at farm scope on one day. Every field is a count of
 *  things he actually said — nothing here is derived, estimated or spread. */
export interface FarmWideDaySummary {
    /** How many whole-farm records exist for the day. Never a per-plot number. */
    recordCount: number;
    /** The same buckets `getTodayCounts` reports, summed once per record. */
    counts: DailyCounts;
    /**
     * The money the farmer stated on those records, summed at the scope he
     * stated it. NOT split across plots and NOT re-derived — reading
     * `financialSummary.grandTotal`, the same figure cost analysis reads.
     * `0` means no farm-wide record carried an amount, which is a fact, not an
     * estimate.
     */
    statedSpend: number;
}

/**
 * The farm-level "today so far" reader (founder ask: *"add it and show it on
 * reflect page as well, only when anything for entire farm is being logged"*).
 *
 * A READER OF EXISTING STATE, not a new aggregation. It walks the same
 * `history` every other surface walks and counts each farm-wide record ONCE.
 * There is no scope parameter and there is no plot key, so there is no shape in
 * which a caller could sum it per plot and reproduce `R24`'s 3-into-11.
 *
 * Returns zeroes rather than `null` for a day with no farm-wide work; the
 * caller decides whether zero is worth rendering. Rendering nothing at zero is
 * the intended behaviour — a farmer who has recorded no whole-farm work must
 * not be shown an empty panel telling him so (`P9`: the capture path carries no
 * nags, and an emptiness that only exists to be filled is a nag).
 */
export function getFarmWideDaySummary(
    history: DailyLog[],
    dateStr: string,
): FarmWideDaySummary {
    const dayLogs = history.filter(log =>
        log.date === dateStr && isFarmWideSelection(log.context?.selection));

    const counts = emptyCounts();
    let statedSpend = 0;

    dayLogs.forEach(log => {
        tallyLog(counts, log);
        statedSpend += log.financialSummary?.grandTotal || 0;
    });

    return { recordCount: dayLogs.length, counts, statedSpend };
}

/** True when any bucket carries something — the caller's "is this worth showing". */
export function hasFarmWideWork(summary: FarmWideDaySummary): boolean {
    return summary.recordCount > 0;
}

export interface TodayPlotEntry {
    plot: Plot;
    crop: CropProfile;
    counts: DailyCounts;
}

export function getTodayPlotData(
    history: DailyLog[],
    crops: CropProfile[],
): TodayPlotEntry[] {
    const todayStr = getDateKey();
    const todayLogs = history.filter(l => l.date === todayStr);
    const plotMap: Record<string, TodayPlotEntry> = {};

    // LABOUR_PHASE2 B1b — every selection entry, for the reason on
    // `getTodayCounts`. Each entry brings its own crop, so a two-crop log now
    // contributes both crops' plots instead of only the first crop's.
    todayLogs.forEach(log => {
        log.context.selection.forEach(contextSel => {
            const crop = crops.find(c => c.id === contextSel?.cropId);
            if (!crop) return;

            (contextSel.selectedPlotIds || []).forEach(pid => {
                if (!plotMap[pid]) {
                    const plot = crop.plots.find(p => p.id === pid);
                    if (plot) {
                        plotMap[pid] = { plot, crop, counts: emptyCounts() };
                    }
                }
                if (plotMap[pid]) {
                    tallyLog(plotMap[pid].counts, log);
                }
            });
        });
    });

    return Object.values(plotMap).filter(item => {
        const c = item.counts;
        return (
            c.cropActivities + c.irrigation + c.labour + c.inputs
            + c.machinery + c.activityExpenses + c.observations
            + c.reminders + c.disturbance
        ) > 0;
    });
}
