/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1) — one row per plot for the तुलना tab.
 *
 * Same sources and the same rule the old page used, now for every plot at once instead of one picked plot:
 *   - a plot "has a schedule" exactly when the old page found a baseline schedule for it
 *     (`TemplateCatalog` by the crop's adopted schedule id, else the plot's own schedule's template);
 *   - the comparison is the real `generatePlotComparison` over the Dexie logs;
 *   - the plot's logs are the logs whose selection names it (the old `plotLogs` filter).
 *
 * One more fact, so the card never says what the data does not support (I14-V2-03): the engine lays the
 * schedule's work on the plot's days ONLY from the plot's own schedule start (`plot.schedule.referenceDate`
 * — `plotComparisonService.ts` derives planned items only from that instance, and without its date the
 * plan engine's "today" is not a number). A crop can carry an adopted schedule while one of its plots has
 * no such start; for that plot nothing is planned at all, which is NOT "no work was due". Such a row has no
 * week (`week: null`) and says so (`laidOut: false`).
 */
import type { CropProfile, DailyLog, Plot, PlotComparisonSummary } from '../../types';
import { getTemplateById } from '../../infrastructure/reference/TemplateCatalog';
import { generatePlotComparison } from './plotComparisonService';
import { buildPlotWeek, type PlotWeek } from './compareWeek';

export interface ComparePlotRow {
    crop: CropProfile;
    plot: Plot;
    hasSchedule: boolean;
    /** The schedule's work could be laid on this plot's days (it has a schedule start date). */
    laidOut: boolean;
    /** `null` when there is no schedule or the comparison could not be built. */
    summary: PlotComparisonSummary | null;
    /** `null` when the comparison could not be built or the schedule could not be laid on the plot. */
    week: PlotWeek | null;
    plotLogs: DailyLog[];
}

export function plotHasSchedule(crop: CropProfile, plot: Plot): boolean {
    return Boolean(getTemplateById(crop.activeScheduleId || '') || getTemplateById(plot.schedule?.templateId || ''));
}

/** The plot's own schedule start, the one date the engine lays planned work from. */
export function scheduleLaidOnPlot(plot: Plot): boolean {
    const start = plot.schedule?.referenceDate;
    return typeof start === 'string' && start.trim() !== '' && !Number.isNaN(new Date(start).getTime());
}

export function buildCompareRows(crops: readonly CropProfile[], logs: readonly DailyLog[]): ComparePlotRow[] {
    return crops.flatMap(crop => (crop.plots ?? []).map((plot): ComparePlotRow => {
        const plotLogs = logs.filter(log => log.context?.selection?.some(sel => sel.selectedPlotIds.includes(plot.id)));
        const hasSchedule = plotHasSchedule(crop, plot);
        const laidOut = hasSchedule && scheduleLaidOnPlot(plot);
        let summary: PlotComparisonSummary | null = null;
        if (hasSchedule) {
            try {
                summary = generatePlotComparison(plot, crop, [...logs]);
            } catch (e) {
                console.error('Error generating comparison:', e);
            }
        }
        return { crop, plot, hasSchedule, laidOut, summary, week: summary && laidOut ? buildPlotWeek(summary) : null, plotLogs };
    }));
}
