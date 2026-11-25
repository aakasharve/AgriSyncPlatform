/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12, "ShramSathi asks from the schedule") - gathers, from THIS PHONE, what the stage question reads: the
 * schedule the plot follows as main (its day cards, the phone's copy first, the server when there is signal), the works of the plot's own schedule (the server's rows
 * and the ones still waiting to be sent, so it works with no internet, P10), and the plot's day (the one helper). The rules themselves are pure, in `taskStageLines.ts`.
 *
 * Fails soft (P9): a store that cannot be read is "no task format"; a followed schedule whose tasks cannot be read (no signal and no copy) is "the plot uses the task
 * format and nothing is known to ask": the embedded json is NOT used then (the server would refuse it), so the plot is asked the open question or none.
 */
import { getDatabase, type AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { loadDayCards, type DayCardsLoad } from '../../scheduler/dayCards/dayCardsStore';
import { getLocalOwnSchedule } from '../../scheduler/ownSchedule/ownScheduleLocal';
import { currentCycleByPlot, mainRow } from '../../scheduler/schedulePage/scheduleSubscriptions';
import { calculateDayNumber } from '../../scheduler/planning/ClientPlanEngine';
import { shownScheduleDay } from '../../scheduler/schedulePage/scheduleDates';
import { NO_TASK_FORMAT, taskStageLines, type TaskStageSource } from './taskStageLines';

export interface TaskStageState {
    /** The plot's day as the farmer reads it (day 1 = the start day). */
    shownDay: number;
    source: TaskStageSource;
    /** The plot's current crop season: what a `schedule.task_event` is written against. */
    cropCycleId: string | null;
}

const LOAD_PATIENCE_MS = 4000;
const dayKey = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** The day cards of a version, waiting no longer than a few seconds for the server (the phone's copy answers when it is slow or away). */
async function withPatience(load: Promise<DayCardsLoad>): Promise<DayCardsLoad> {
    const slow = new Promise<DayCardsLoad>(resolve => setTimeout(() => resolve({ ok: false, reason: 'failed' }), LOAD_PATIENCE_MS));
    return Promise.race([load, slow]);
}

export async function loadTaskStageState(input: {
    plotId: string;
    /** The plot's own start date as the phone holds it (used only when the schedule and the crop season name none). */
    plotStartDate?: string | null;
    todayKey: string;
    language?: string;
    db?: AgriLogDatabase;
    load?: (templateId: string) => Promise<DayCardsLoad>;
}): Promise<TaskStageState | null> {
    try {
        const db = input.db ?? getDatabase();
        const cycleId = (await currentCycleByPlot(db)).get(input.plotId) ?? null;
        const rows = await db.scheduleSubscriptions.where('plotId').equals(input.plotId).toArray();
        const main = mainRow(rows, cycleId);
        const own = cycleId ? await getLocalOwnSchedule(db, cycleId) : [];
        if (!main && own.length === 0) return null;

        const cycle = cycleId ? await db.cropCycles.get(cycleId).catch(() => undefined) : undefined;
        const cycleStart = dayKey((cycle?.payload as { startDate?: unknown } | undefined)?.startDate);
        const dayZero = dayKey(main?.referenceDate) ?? cycleStart ?? dayKey(input.plotStartDate);
        if (!dayZero) return null;
        const shownDay = shownScheduleDay(calculateDayNumber(dayZero, input.todayKey));

        let reference = null;
        let unknown = false;
        if (main) {
            const loaded = await withPatience((input.load ?? loadDayCards)(main.templateId));
            if (loaded.ok) reference = loaded.detail;
            // 'not-found' / 'not-allowed': the version is not written in the task format (or not this person's): nothing to ask from it.
            else if (loaded.reason === 'offline-no-copy' || loaded.reason === 'failed') unknown = true;
        }

        const source = taskStageLines({
            reference, ownWorks: own.map(w => ({ task: w.task, state: w.state })), shownDay, language: input.language,
        });
        if (unknown && !source.hasTaskFormat) return { shownDay, source: { hasTaskFormat: true, lines: [] }, cropCycleId: cycleId };
        return { shownDay, source: source.hasTaskFormat ? source : NO_TASK_FORMAT, cropCycleId: cycleId };
    } catch {
        return null;
    }
}
