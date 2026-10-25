/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * कामाचं कॅलेंडर — what one day of the week / month calendar shows. Pure.
 *
 * The facts are the old Activity Calendar's: one chip per record in its CROP's colour with the plot (and its
 * number) and the main work; a whole-day stop (amber) with its cause; whole-farm work (slate); rain (a blue
 * wash, from any record's weather that day). Two changes from the approved preview:
 *   - the calendar follows शेताची स्थिती like every other section (the old one filtered by plot only, so
 *     after picking one crop it still drew every other crop's work);
 *   - an open to-do sits on its due day, so the to-do list and the calendar agree.
 * Every Marathi string is PROPOSED.
 */
import type { CropProfile, DailyLog, PlannedTask } from '../../../types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { offsetOf } from './reflectDates';
import { isLogInScope, type ViewScope } from './reflectSelection';

const FARM_GLOBAL = 'FARM_GLOBAL';

const MACHINE_LABEL: Record<string, string> = {
    tractor: 'ट्रॅक्टर', tiller: 'टिलर', harvester: 'हार्वेस्टर', drone: 'ड्रोन', sprayer: 'फवारणी यंत्र', unknown: 'यंत्र',
};
const DISTURBANCE_GROUP_LABEL: Record<string, string> = { WEATHER: 'हवामान', ELECTRICITY: 'वीज' };

/** The main work of a record: the farmer's own work name first, else a plain word for the bucket that holds something. */
export function activityNameOf(log: DailyLog): string {
    if (log.cropActivities?.length) return log.cropActivities[0].title;
    if (log.irrigation?.length) return 'पाणी';
    if (log.inputs?.length) return log.inputs[0].type === 'fertilizer' ? 'खत' : 'फवारणी';
    if (log.labour?.length) return 'मजूर';
    if (log.machinery?.length) return MACHINE_LABEL[log.machinery[0].type] ?? 'यंत्र';
    return 'नोंद';
}

export interface CalendarChip { logId: string; color: string; plotLabel: string; plotIndex?: number; activity: string }

export interface CalendarDay {
    key: string;
    date: Date;
    offset: number;
    isToday: boolean;
    blocked?: { groupLabel: string; reason?: string };
    farmWide: boolean;
    chips: CalendarChip[];
    /** One colour per crop that had (unstopped) work, in the farm's crop order. */
    cropColors: string[];
    rainy: boolean;
    due: { id: string; title: string }[];
    /** Nothing at all to draw: the day says "नोंद नाही". */
    empty: boolean;
}

interface BuildArgs {
    date: Date;
    history: readonly DailyLog[];
    crops: readonly CropProfile[];
    scope: ViewScope;
    /** Open, in-scope to-dos (the to-do list's own filter); the ones due on this day are drawn. */
    dueTasks: readonly PlannedTask[];
    today?: Date;
}

const isFarmWide = (log: DailyLog) => log.context?.selection?.some(s => s.cropId === FARM_GLOBAL) ?? false;

export function buildCalendarDay({ date, history, crops, scope, dueTasks, today = new Date() }: BuildArgs): CalendarDay {
    const key = getDateKey(date);
    const ofDay = history.filter(l => l.date === key);
    const shown = ofDay.filter(l => isFarmWide(l) || isLogInScope(l, scope));
    const stop = shown.find(l => l.disturbance?.scope === 'FULL_DAY')?.disturbance;

    const chips: CalendarChip[] = [];
    const cropIdsWorked = new Set<string>();
    for (const l of shown) {
        const sel = l.context.selection[0];
        const c = crops.find(x => x.id === sel?.cropId);
        if (!c) continue;
        const plotId = sel.selectedPlotIds?.[0];
        const plotIndex = plotId ? c.plots.findIndex(p => p.id === plotId) : -1;
        chips.push({
            logId: l.id,
            color: c.color,
            // the plot's name as it is NOW (a renamed plot reads its new name); the name stored on the record otherwise
            plotLabel: plotIndex >= 0 ? c.plots[plotIndex].name : (sel.selectedPlotNames?.[0] || c.name),
            plotIndex: plotIndex >= 0 ? plotIndex : undefined,
            activity: activityNameOf(l),
        });
        if (l.disturbance?.scope !== 'FULL_DAY') cropIdsWorked.add(c.id);
    }

    const due = dueTasks.filter(t => t.dueDate?.slice(0, 10) === key).map(t => ({ id: t.id, title: t.title }));
    const farmWide = shown.some(isFarmWide);
    const offset = offsetOf(date, today);
    return {
        key,
        date,
        offset,
        isToday: offset === 0,
        blocked: stop ? { groupLabel: DISTURBANCE_GROUP_LABEL[stop.group?.toUpperCase()] ?? 'इतर कारण', reason: stop.reason || undefined } : undefined,
        farmWide,
        chips,
        cropColors: crops.filter(c => cropIdsWorked.has(c.id)).map(c => c.color),
        rainy: ofDay.some(l => l.weatherSnapshot?.current?.iconCode === 'rain' || l.weatherSnapshot?.current?.iconCode === 'storm'),
        due,
        empty: !stop && !farmWide && chips.length === 0 && due.length === 0,
    };
}
