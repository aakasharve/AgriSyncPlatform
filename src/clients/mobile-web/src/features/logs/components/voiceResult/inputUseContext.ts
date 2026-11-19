/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts-card-input-truth-2026-11-19 (lane FACTS-1) - the day of the season and the stage of ONE use of a product, from the
 * plot's OWN schedule (the same engine the schedule page uses: day 0 = the schedule's reference date, less any recorded shift).
 * Never invented (P4): with no crop, no plot, or no schedule on this phone for it, the answer says nothing (day and stage null)
 * and the card simply leaves the line out. A date before day 0 (land preparation) has no day. Pure; reads, never changes, a record (P7).
 */
import type { CropProfile, DailyLog } from '../../../../types';
import type { UseContext } from '../../../../domain/inputs/ingredientFacts';
import { buildScheduleModel } from '../../../scheduler/schedulePage/scheduleModel';
import { resolvePlotSchedule } from '../../../scheduler/schedulePage/resolveSchedule';
import type { ScheduleChoice } from '../../../scheduler/schedulePage/scheduleSubscriptions';

const NONE = (dateKey: string, cropName: string | null): UseContext => ({ dateKey, day: null, refType: null, stageName: null, nextStage: null, cropName });

export function useContextFor(args: {
    log: DailyLog | undefined;
    crops: readonly CropProfile[];
    choices: ReadonlyMap<string, ScheduleChoice>;
}): UseContext | null {
    const { log, crops, choices } = args;
    if (!log) return null;
    const dateKey = log.date;
    const sel = log.context?.selection?.[0];
    const cropName = sel?.cropName ?? null;
    if (!sel || !sel.cropId || sel.cropId === 'FARM_GLOBAL') return NONE(dateKey, cropName);
    const crop = crops.find(c => c.id === sel.cropId);
    const plotId = sel.selectedPlotIds?.[0];
    const plot = crop?.plots.find(p => p.id === plotId);
    if (!crop || !plot) return NONE(dateKey, cropName);
    try {
        const resolved = resolvePlotSchedule(crop, plot, dateKey, choices.get(plot.id));
        if (!resolved) return NONE(dateKey, cropName);
        // Counting AS OF the day of the use (not today): the "today" of this model is the day he used it.
        const model = buildScheduleModel({ template: resolved.template, instance: resolved.instance, plotId: plot.id, logs: [], todayKey: dateKey, shifts: plot.scheduleShifts });
        const day = model.todayDay;
        const next = model.stages.filter(s => s.from > day).sort((a, b) => a.from - b.from)[0];
        return {
            dateKey,
            day: day >= 0 ? day : null,
            refType: resolved.instance.referenceType,
            stageName: model.currentStage?.name ?? null,
            nextStage: next ? { name: next.name, inDays: next.from - day } : null,
            cropName,
        };
    } catch {
        // A stored schedule this phone cannot read must never break the result screen (P11).
        return NONE(dateKey, cropName);
    }
}
