/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-1 item 5 (R2-A 10, founder 27 Nov; his word for the mark: RED) - which plots still miss a required link, and why.
 * Read by पिकं आणि प्लॉट (the red mark on a plot and the "बाकी" list at the top) and by the Setup Hub's line (the count), so the
 * two always agree.
 *
 * THE ONE PLACE for the links a plot needs: `PLOT_LINKS` and its words below. The plot's water link (after the per-farm setup on the
 * server, D-9) is one more entry in each, nothing else.
 *
 * Today's links: the plot's boundary is drawn; the plot follows a schedule (the schedule tab's own rule, the same one behind
 * "N पैकी M प्लॉटवर शेड्यूल"). Pure: no React, no storage, no clock (the caller passes today).
 */
import type { CropProfile, Plot } from '../../../domain/types/farm.types';
import { digitsFor } from '../../../shared/utils/marathiDigits';
import { sortedNaturally } from '../../context/components/plotSelectorRules';
import { resolvePlotSchedule } from '../../scheduler/schedulePage/resolveSchedule';
import { plotFollowsSchedule } from '../../scheduler/schedulePage/scheduleMapModel';
import type { PlotScheduleChoices } from '../../scheduler/schedulePage/usePlotScheduleChoices';

export type PlotPendingReason = 'boundary' | 'schedule';

interface PlotFacts {
    plot: Plot;
    followsSchedule: boolean;
}

/** Each link a plot needs, in the order its reasons are said. */
const PLOT_LINKS: readonly { reason: PlotPendingReason; missing: (facts: PlotFacts) => boolean }[] = [
    { reason: 'boundary', missing: ({ plot }) => !plot.geoData },
    { reason: 'schedule', missing: ({ followsSchedule }) => !followsSchedule },
];

// Marathi first, English twin. "शेड्यूल नाही" and "बाकी" are the app's own words; "हद्द आखायची बाकी" and "प्लॉट बाकी" are new (report).
export const PLOT_PENDING_WORDS = {
    mr: {
        title: 'बाकी',
        reason: { boundary: 'हद्द आखायची बाकी', schedule: 'शेड्यूल नाही' } as Record<PlotPendingReason, string>,
        hubCount: (n: number) => `${digitsFor(n, 'mr')} प्लॉट बाकी`,
    },
    en: {
        title: 'Pending',
        reason: { boundary: 'Boundary not drawn', schedule: 'No schedule' } as Record<PlotPendingReason, string>,
        hubCount: (n: number) => `${n} ${n === 1 ? 'plot' : 'plots'} pending`,
    },
} as const;

export interface PendingPlot {
    cropId: string;
    plotId: string;
    plotName: string;
    reasons: PlotPendingReason[];
}

/** What this plot still misses (empty = nothing). */
export function plotPendingReasons(crop: CropProfile, plot: Plot, choices: PlotScheduleChoices, todayKey: string): PlotPendingReason[] {
    const facts: PlotFacts = {
        plot,
        followsSchedule: plotFollowsSchedule(resolvePlotSchedule(crop, plot, todayKey, choices.get(plot.id))),
    };
    return PLOT_LINKS.filter(link => link.missing(facts)).map(link => link.reason);
}

/** Every plot of the farm that still misses a link: crop by crop, plots in natural number order (G2 before G10). */
export function pendingPlots(crops: readonly CropProfile[], choices: PlotScheduleChoices, todayKey: string): PendingPlot[] {
    const out: PendingPlot[] = [];
    for (const crop of crops) {
        for (const plot of sortedNaturally(crop.plots, p => p.name)) {
            const reasons = plotPendingReasons(crop, plot, choices, todayKey);
            if (reasons.length > 0) out.push({ cropId: crop.id, plotId: plot.id, plotName: plot.name, reasons });
        }
    }
    return out;
}
