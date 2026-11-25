/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 6; founder 2026-11-21: questions "context rich", "stage wise
 * things from all the schedule") - the day's stage question for a plot.
 *
 * `stage_look` - a question from a cited look line of Shram Safal's own schedule for this day of the season - only when the plot
 * follows a grape pruning schedule with a fruit-pruning date (September to November: the October fruit-pruning schedule; a
 * foundation pruning in spring is a different season, never matched), and the day has an askable line. The day: the app counts the
 * schedule's reference date as day 0, the Schedule Maker counts pruning day as day 1 (founder 22 Nov), so day = app day + 1.
 * Otherwise `stage_open` ("what did you see today?"), which states nothing and needs no source (design §9.2, §9.7).
 * Counted against the real India today, never a saved log's own day. PURE.
 */
import type { CropProfile } from '../../../types';
import type { TaskStageLine } from './taskStageLines';
import type { TaskStageState } from './taskStageSource';
import { calculateDayNumber, scheduleTemplateForPlot } from '../../scheduler/planning/ClientPlanEngine';
import {
    GRAPES_OCT_FRUIT_PRUNING, askableLinesForDay, sampleVinesFor, type DfesLookLine, type DfesSchedule,
} from '../../../domain/schedule/dfesScheduleLines';

export interface StageQuestionContext {
    kind: 'stage_look' | 'stage_open';
    /** The day in the Schedule Maker's numbering (pruning day = 1); null when the plot has no matching schedule. */
    scheduleDay: number | null;
    line: DfesLookLine | null;
    /** The line's question, ready to show ("{N}" filled); null for stage_open. */
    askMr: string | null;
    /**
     * Slice 12 - the id the phone sends for the line: `task:{key}:look|ask` for a question read from a task of the schedule the plot follows or owns, else the
     * embedded line's own id. Null for stage_open.
     */
    lineId?: string | null;
    /** Slice 12 - the task line a question was read from (its source, and whether answering it writes a `schedule.task_event`); absent for the embedded json. */
    task?: TaskStageLine;
    /** Slice 12 - the crop season a task event is written against. */
    cropCycleId?: string | null;
}

/** Fruit pruning months for the October schedule: September, October, November (1-based). */
const FRUIT_PRUNING_MONTHS = new Set([9, 10, 11]);

const dateOnly = (value: string): string => (value.includes('T') ? value.split('T')[0] : value);

export function computeStageQuestion(input: {
    crops: CropProfile[];
    plotId: string | null;
    todayLocalDate: string;
    /** In English mode a line with no English twin is not asked (the look lines are Marathi only for now). */
    language?: string;
    schedule?: DfesSchedule;
    /**
     * Slice 12 - what the plot's tasks say for today (`loadTaskStageState`). When the plot follows a task-format schedule or owns a work (`hasTaskFormat`), the
     * question is read from THE TASK and the embedded json is never used (the server refuses it). Absent / no task format = the embedded json, as before.
     */
    taskStage?: TaskStageState | null;
}): StageQuestionContext | null {
    if (!input.plotId) return null;
    const match = input.crops.flatMap(crop => crop.plots.map(plot => ({ crop, plot }))).find(item => item.plot.id === input.plotId);
    if (!match) return null;
    const open: StageQuestionContext = { kind: 'stage_open', scheduleDay: null, line: null, askMr: null };

    if (input.taskStage?.source.hasTaskFormat) {
        const { shownDay, source, cropCycleId } = input.taskStage;
        // The task lines are Marathi words of the schedule: in English mode no line is asked (the look lines are Marathi only for now).
        if (input.language === 'en' || source.lines.length === 0) return { ...open, scheduleDay: shownDay };
        const chosen = source.lines[((shownDay % source.lines.length) + source.lines.length) % source.lines.length];
        return { kind: 'stage_look', scheduleDay: shownDay, line: null, lineId: chosen.lineId, askMr: chosen.askMr, task: chosen, cropCycleId };
    }

    const { crop, plot } = match;
    const template = plot.schedule ? scheduleTemplateForPlot(crop, plot) : undefined;
    const referenceDate = plot.schedule?.referenceDate ? dateOnly(plot.schedule.referenceDate) : '';
    if (!template || !referenceDate || template.cropCode !== 'grape' || plot.schedule.referenceType !== 'PRUNING') return open;
    if (!FRUIT_PRUNING_MONTHS.has(Number(referenceDate.slice(5, 7)))) return open;

    const scheduleDay = calculateDayNumber(referenceDate, input.todayLocalDate) + 1;
    if (input.language === 'en') return { ...open, scheduleDay };

    const lines = askableLinesForDay(
        input.schedule ?? GRAPES_OCT_FRUIT_PRUNING, scheduleDay, sampleVinesFor(plot.baseline?.totalArea, plot.baseline?.unit),
    );
    if (lines.length === 0) return { ...open, scheduleDay };

    // One line a day, turning through the day's lines so a long daily window does not ask the same thing every time.
    const chosen = lines[((scheduleDay % lines.length) + lines.length) % lines.length];
    return { kind: 'stage_look', scheduleDay, line: chosen.line, lineId: chosen.line.id, askMr: chosen.askMr };
}
