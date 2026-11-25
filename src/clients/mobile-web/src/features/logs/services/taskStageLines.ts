/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12, "ShramSathi asks from the schedule"; approved spec plr-d10-schedule-approved-spec-2026-11-23:
 * "one question per card: what, when, how, look, ask"; "look" and "ask" are questions of their own) - the stage questions of a plot, read from the TASK it follows
 * (its main schedule in the task format) or owns (its own works), never from the embedded json. PURE.
 *
 * The rules (the server applies the same ones and has the last word, `TaskQuestionLines.cs`):
 *   - a question is asked only when its task stands on a SOURCE (askOnlyWithSource): a reference task that names no source document is never asked, nor one that is
 *     our own choice or an assumption;
 *   - the farmer's own work made by hand, written as his own experience, may be asked, and says so ("स्रोत: तुमचा अनुभव"; ownExperienceIsLabelled); a work TAKEN into his
 *     schedule keeps the source of its origin and is never relabelled as his experience;
 *   - the DAY: the app's day count is 0 on the start day; a task stores its day the same way (shown - 1). ONE conversion, through the helper in scheduleDates.ts, turns
 *     the shown day the farmer reads into the stored day a task holds (shownDayNotShiftedTwice): a task stored at 40 is asked on shown day 41, never 40 or 42. A task
 *     with no day window (a timer of "after", none yet, or a sign with no expected window) is never given a day.
 */
import type { ScheduleTaskContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import type { DayCardsDetail } from '../../scheduler/dayCards/dayCardsTypes';
import { isOnStoredDay } from '../../scheduler/dayCards/dayCardsModel';
import { storedScheduleDay } from '../../scheduler/schedulePage/scheduleDates';
import { toDevanagariDigits } from '../../../shared/utils/marathiDigits';
import { scheduleFeedWords } from '../../plannedWork/scheduleFeedWords';

export type TaskLinePart = 'look' | 'ask';
export type TaskWorkKind = 'reference' | 'own-by-hand' | 'own-taken';

/** The document id the server uses for the farmer's own experience. NEVER a real document. */
export const OWN_EXPERIENCE_DOCUMENT = 'own-experience';

export interface TaskStageLine {
    /** `task:{taskKey}:look` or `:ask`: what the phone sends; the server finds the task and its source. */
    lineId: string;
    taskKey: string;
    part: TaskLinePart;
    /** The question, ready to show. */
    askMr: string;
    /** "स्रोत: ..." - the source line shown with the question. */
    sourceLabelMr: string;
    kind: TaskWorkKind;
    /** True when the task is a work of his own schedule that waits for a sign: only such a task takes a `schedule.task_event`. */
    takesSignEvent: boolean;
}

/** One own work of the plot-season as the phone holds it (the server's row, or one still waiting to be sent). */
export interface OwnWorkInput {
    task: ScheduleTaskContent;
    state: 'active' | 'removed';
}

export interface TaskStageSource {
    /** True when the plot follows a schedule written in the task format or has a work of its own: the embedded json is then NEVER used (the server refuses it). */
    hasTaskFormat: boolean;
    lines: TaskStageLine[];
}

export const NO_TASK_FORMAT: TaskStageSource = { hasTaskFormat: false, lines: [] };

const text = (v: string | null | undefined): string => (typeof v === 'string' ? v.trim() : '');

/** The "स्रोत" line of a source (PROPOSED Marathi): the document and, when it has one, its page in Devanagari digits. */
export function sourceLabelMr(document: string, page: string | null | undefined): string {
    const p = text(page);
    return p ? `स्रोत: ${document}, पान ${toDevanagariDigits(p)}` : `स्रोत: ${document}`;
}

/** PROPOSED Marathi. */
export const OWN_EXPERIENCE_LABEL_MR = 'स्रोत: तुमचा अनुभव';

function sourcesOf(task: ScheduleTaskContent, kind: TaskWorkKind): string | null {
    // Our own choice and an assumption are not a source's word.
    if (task.basis === 'our_choice' || task.basis === 'assumed') return null;
    const named = task.sources.filter(s => text(s.document).length > 0);
    if (named.length > 0) return named.map(s => sourceLabelMr(text(s.document), s.page)).join(' · ');
    return kind === 'own-by-hand' && task.basis === 'experience' ? OWN_EXPERIENCE_LABEL_MR : null;
}

/** The stored-day window in which the task is asked, or false. A day timer: its window. A sign timer: only its expected window. Nothing else has a day. */
function isAskedOnStoredDay(task: ScheduleTaskContent, stored: number): boolean {
    const t = task.timing;
    if (t.timer === 'day') return isOnStoredDay(task, stored);
    if (t.timer === 'sign' && t.expectedFromDay !== null) {
        return stored >= t.expectedFromDay && stored <= (t.expectedToDay ?? t.expectedFromDay);
    }
    return false;
}

function linesOf(task: ScheduleTaskContent, kind: TaskWorkKind, language: string | undefined): TaskStageLine[] {
    const source = sourcesOf(task, kind);
    if (source === null) return [];
    const out: TaskStageLine[] = [];
    const takesSignEvent = (kind === 'own-by-hand' || kind === 'own-taken') && task.timing.timer === 'sign';
    const sign = text(task.look?.sign);
    if (sign) {
        out.push({
            lineId: `task:${task.taskKey}:look`, taskKey: task.taskKey, part: 'look', askMr: scheduleFeedWords(language).signQuestion(sign),
            sourceLabelMr: source, kind, takesSignEvent,
        });
    }
    const question = text(task.ask?.question);
    if (question) {
        out.push({ lineId: `task:${task.taskKey}:ask`, taskKey: task.taskKey, part: 'ask', askMr: question, sourceLabelMr: source, kind, takesSignEvent });
    }
    return out;
}

/** The own work was taken into the schedule from another one (its origin text starts with "take:", slice 9). */
const isTaken = (task: ScheduleTaskContent): boolean => typeof task.origin === 'string' && task.origin.startsWith('take:');

/**
 * Every question the plot's tasks may ask on this SHOWN day (the day the farmer reads, day 1 = the start day), with its source. A work of his own wins over the
 * reference task of the same key (he owns his copy). `hasTaskFormat` is true when the plot follows a task-format schedule or has an active own work, even when no
 * question falls on this day: then the embedded json is not used at all.
 */
export function taskStageLines(input: {
    reference: DayCardsDetail | null;
    ownWorks: readonly OwnWorkInput[];
    shownDay: number;
    language?: string;
}): TaskStageSource {
    const own = input.ownWorks.filter(w => w.state === 'active');
    const referenceTasks = input.reference?.tasks.map(t => t.task) ?? [];
    if (own.length === 0 && referenceTasks.length === 0) return NO_TASK_FORMAT;

    const stored = storedScheduleDay(input.shownDay);
    const ownKeys = new Set(own.map(w => w.task.taskKey));
    const lines: TaskStageLine[] = [];
    const add = (task: ScheduleTaskContent, kind: TaskWorkKind): void => {
        if (isAskedOnStoredDay(task, stored)) lines.push(...linesOf(task, kind, input.language));
    };
    for (const task of referenceTasks) if (!ownKeys.has(task.taskKey)) add(task, 'reference');
    for (const work of own) add(work.task, isTaken(work.task) ? 'own-taken' : 'own-by-hand');
    lines.sort((a, b) => a.taskKey.localeCompare(b.taskKey) || a.part.localeCompare(b.part));
    return { hasTaskFormat: true, lines };
}
