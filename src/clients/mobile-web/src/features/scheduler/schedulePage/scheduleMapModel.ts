/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-150, picture S3) - the picture map of the शेड्यूल tab, as plain data:
 * which plot follows which schedule, in which order the rows sit, which colour each schedule wears, and where each line starts and ends.
 *
 * Nothing here is stored or decided: it READS what the page already knows (each plot's resolved schedule and the schedules it follows, from the
 * server's subscriptions) and arranges it.
 *   - A plot "follows" a schedule when somebody chose it (the server's subscription, or the crop's / plot's own choice on this phone). A plot
 *     that shows only the app's default for its crop (nobody chose) follows NONE: it goes to the dashed "शेड्यूल नाही" group.
 *   - A plot that follows several schedules (3 + 1) draws one line to each; the मुख्य one (the server's pick, R6) is the thick one and decides
 *     where the plot sits in the column.
 *   - Plots are sorted so those on one schedule sit together (a schedule's card spans its plots' rows).
 * Pure: no React, no storage, no clock (the caller passes today).
 */
import type { CropProfile } from '../../../types';
import type { CropScheduleTemplate, ScheduleOwnerType } from '../scheduler.types';
import { daysBetween, toDayKey } from './scheduleDates';
import { shiftDaysUpTo } from './scheduleModel';
import { resolvePlotSchedule, type ResolvedSchedule } from './resolveSchedule';
import type { PlotScheduleChoices } from './usePlotScheduleChoices';
import { scheduleColour } from './scheduleColours';
import { realCreatorName } from './ScheduleCreatorBadge';
import { sortedNaturally } from '../../context/components/plotSelectorRules';

export interface MapPlot {
    plotId: string;
    cropId: string;
    plotName: string;
    /** The crop's name in his language. */
    cropName: string;
    /** The crop's STORED name (the photo is matched by it and the crop master id, never by the shown name). */
    cropRawName: string;
    iconName: string;
    masterId?: string;
    /** Today's day on the plot's मुख्य schedule (less recorded shifts); null when the plot follows none. */
    day: number | null;
    /** The मुख्य schedule's key (its template id); null when the plot follows none. */
    mainKey: string | null;
    /** Every schedule the plot follows, मुख्य first. */
    keys: string[];
}

export interface MapSchedule {
    key: string;
    template: CropScheduleTemplate;
    colour: string;
    /** His OWN schedule (his own place, or a schedule the farmer made). */
    own: boolean;
    ownerType: ScheduleOwnerType;
    /** The creator's real name, or null (never an invented one). */
    creator: string | null;
    /** Every plot with a line to this schedule, in row order. */
    plotIds: string[];
    /** The plots whose मुख्य schedule this is, in row order. */
    mainPlotIds: string[];
}

export interface MapEdge { plotId: string; key: string; main: boolean }

export interface ScheduleMapModel {
    /** Plots that follow a schedule, in row order (those on one schedule together). */
    plots: MapPlot[];
    /** Plots that follow none (the dashed group), in the farm's own order. */
    unscheduled: MapPlot[];
    /** Schedules in column order. */
    schedules: MapSchedule[];
    edges: MapEdge[];
    /** Crops with no plot yet: the map has nothing to draw for them, and says so in one line. */
    emptyCrops: { id: string; name: string }[];
}

/** Today's schedule day of a plot: days since the schedule's day 0, less the recorded shifts (the same rule as the page's own model). */
export function plotDayNumber(resolved: ResolvedSchedule, shifts: Parameters<typeof shiftDaysUpTo>[0], todayKey: string): number {
    const refKey = toDayKey(resolved.instance.referenceDate) ?? todayKey;
    return daysBetween(refKey, todayKey) - shiftDaysUpTo(shifts, todayKey);
}

interface Followed { key: string; template: CropScheduleTemplate; own: boolean; main: boolean }

/** The schedules a plot really follows: its subscriptions (each with a real schedule on this phone), else the schedule somebody chose for the crop or the plot. */
function followedOf(resolved: ResolvedSchedule | null): Followed[] {
    if (!resolved) return [];
    const places = resolved.followed.filter(f => f.template);
    if (places.length > 0) {
        const mainId = (places.find(f => f.isMain) ?? places[0]).templateId;
        const seen = new Set<string>();
        const out: Followed[] = [];
        for (const f of places) {
            if (seen.has(f.templateId)) continue;
            seen.add(f.templateId);
            out.push({ key: f.templateId, template: f.template as CropScheduleTemplate, own: f.origin === 'Own' || f.template?.ownerType === 'USER', main: f.templateId === mainId });
        }
        return out.sort((a, b) => Number(b.main) - Number(a.main));
    }
    if (resolved.source === 'default') return [];
    return [{ key: resolved.template.id, template: resolved.template, own: resolved.template.ownerType === 'USER', main: true }];
}

/**
 * Does this plot follow a schedule somebody chose? The ONE rule behind the tab's dashed "शेड्यूल नाही" group (a plot is in that group when this
 * is false), shared with Setup's "N पैकी M प्लॉटवर शेड्यूल" so the two screens count the same way (UI-9a, redesign item 7).
 */
export const plotFollowsSchedule = (resolved: ResolvedSchedule | null): boolean => followedOf(resolved).length > 0;

export function buildScheduleMap(input: {
    crops: readonly CropProfile[];
    choices: PlotScheduleChoices;
    todayKey: string;
    cropName: (crop: CropProfile) => string;
}): ScheduleMapModel {
    const { crops, choices, todayKey, cropName } = input;
    const scheduled: Array<{ plot: MapPlot; followed: Followed[] }> = [];
    const unscheduled: MapPlot[] = [];
    const emptyCrops: { id: string; name: string }[] = [];

    for (const crop of crops) {
        if (crop.plots.length === 0) emptyCrops.push({ id: crop.id, name: cropName(crop) });
        // Natural number order (G2 before G10) - the founder's rule everywhere plots are listed. The map still groups the rows by schedule (a
        // schedule's card spans consecutive rows, so that is deliberate), but inside a group, and inside the dashed one, the plots follow the numbers.
        for (const plot of sortedNaturally(crop.plots, p => p.name)) {
            const resolved = resolvePlotSchedule(crop, plot, todayKey, choices.get(plot.id));
            const followed = followedOf(resolved);
            const base = { plotId: plot.id, cropId: crop.id, plotName: plot.name, cropName: cropName(crop), cropRawName: crop.name, iconName: crop.iconName, masterId: crop.masterId };
            if (followed.length === 0 || !resolved) {
                unscheduled.push({ ...base, day: null, mainKey: null, keys: [] });
                continue;
            }
            scheduled.push({
                plot: { ...base, day: plotDayNumber(resolved, plot.scheduleShifts, todayKey), mainKey: followed[0].key, keys: followed.map(f => f.key) },
                followed,
            });
        }
    }

    // Column order: a schedule takes its place when its first plot (by the farm's own order) names it as मुख्य; schedules only ever
    // followed as an extra place come after.
    const order: string[] = [];
    for (const { plot } of scheduled) if (plot.mainKey && !order.includes(plot.mainKey)) order.push(plot.mainKey);
    for (const { plot } of scheduled) for (const k of plot.keys) if (!order.includes(k)) order.push(k);
    const rank = (key: string | null): number => (key === null ? order.length : order.indexOf(key));
    const rows = scheduled.map((s, index) => ({ ...s, index })).sort((a, b) => rank(a.plot.mainKey) - rank(b.plot.mainKey) || a.index - b.index);

    const templates = new Map<string, { template: CropScheduleTemplate; own: boolean }>();
    for (const { followed } of rows) {
        for (const f of followed) {
            const known = templates.get(f.key);
            templates.set(f.key, { template: f.template, own: (known?.own ?? false) || f.own });
        }
    }
    let outsideIndex = 0;
    const schedules: MapSchedule[] = order.map(key => {
        const { template, own } = templates.get(key) as { template: CropScheduleTemplate; own: boolean };
        const colour = scheduleColour(own, own ? 0 : outsideIndex++);
        return {
            key, template, colour, own, ownerType: template.ownerType, creator: realCreatorName(template),
            plotIds: rows.filter(r => r.plot.keys.includes(key)).map(r => r.plot.plotId),
            mainPlotIds: rows.filter(r => r.plot.mainKey === key).map(r => r.plot.plotId),
        };
    });
    const edges: MapEdge[] = rows.flatMap(r => r.plot.keys.map(key => ({ plotId: r.plot.plotId, key, main: key === r.plot.mainKey })));
    return { plots: rows.map(r => r.plot), unscheduled, schedules, edges, emptyCrops };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Where things sit (px). The view draws rows of MAP_PLOT_H with MAP_GAP between; a schedule's card spans the rows of its plots.
// ---------------------------------------------------------------------------------------------------------------------------------

export const MAP_PLOT_H = 68;
export const MAP_GAP = 8;

export interface MapLine { plotId: string; key: string; main: boolean; y1: number; y2: number }
export interface MapLayout {
    height: number;
    plotTop: Record<string, number>;
    schedule: Record<string, { top: number; height: number }>;
    lines: MapLine[];
}

export function layoutScheduleMap(model: ScheduleMapModel): MapLayout {
    const pitch = MAP_PLOT_H + MAP_GAP;
    const plotTop: Record<string, number> = {};
    model.plots.forEach((p, i) => { plotTop[p.plotId] = i * pitch; });
    const plotsBottom = model.plots.length === 0 ? 0 : model.plots.length * pitch - MAP_GAP;

    const schedule: Record<string, { top: number; height: number }> = {};
    let previousBottom = -MAP_GAP;
    for (const s of model.schedules) {
        let top: number;
        let height: number;
        if (s.mainPlotIds.length > 0) {
            // Plots on one schedule are next to each other, so the card spans from its first to its last row.
            top = Math.min(...s.mainPlotIds.map(id => plotTop[id]));
            height = Math.max(...s.mainPlotIds.map(id => plotTop[id])) + MAP_PLOT_H - top;
        } else {
            // Followed only as an extra place: a one-row card level with the middle of the plots that follow it.
            const mid = s.plotIds.reduce((sum, id) => sum + plotTop[id] + MAP_PLOT_H / 2, 0) / Math.max(1, s.plotIds.length);
            top = Math.max(0, mid - MAP_PLOT_H / 2);
            height = MAP_PLOT_H;
        }
        top = Math.max(top, previousBottom + MAP_GAP);
        schedule[s.key] = { top, height };
        previousBottom = top + height;
    }

    // Lines: a plot with several lines spreads them along its right edge; a schedule with several lines coming in spreads them along its left edge.
    const lines: MapLine[] = [];
    const outOf = new Map<string, MapEdge[]>();
    const into = new Map<string, MapEdge[]>();
    for (const e of model.edges) {
        outOf.set(e.plotId, [...(outOf.get(e.plotId) ?? []), e]);
        into.set(e.key, [...(into.get(e.key) ?? []), e]);
    }
    for (const e of model.edges) {
        const mine = outOf.get(e.plotId) as MapEdge[];
        const theirs = into.get(e.key) as MapEdge[];
        const card = schedule[e.key];
        const y1 = plotTop[e.plotId] + (MAP_PLOT_H * (mine.indexOf(e) + 1)) / (mine.length + 1);
        const y2 = card.top + (card.height * (theirs.indexOf(e) + 1)) / (theirs.length + 1);
        lines.push({ plotId: e.plotId, key: e.key, main: e.main, y1, y2 });
    }
    return { height: Math.max(plotsBottom, previousBottom), plotTop, schedule, lines };
}
