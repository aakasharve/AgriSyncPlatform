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
