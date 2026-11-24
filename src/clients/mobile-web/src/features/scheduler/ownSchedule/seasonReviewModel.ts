/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 3
 * "At season end ask once: ideal or own practice"; plan SM-13; P3, P4, P8, P10) - the season-end review of "माझं शेड्यूल", as this phone knows it.
 *
 * A season is a crop cycle. The review is asked for a plot when the plot has a NEWER crop cycle than the one its own works belong to (a new pruning was entered),
 * and the pair has not been answered. ONE list, asked ONCE:
 *   - `written`: a record matched the work and its day is the day it was written for (or it states none): carried, pre-selected "शेड्यूलप्रमाणे", changeable;
 *   - `differs`: a record exists but its day is outside the work's days, or a repeating work was done only in part: asked "शेड्यूलप्रमाणे" / "मी केलं तसं" / "नको",
 *     nothing pre-selected, both values shown with their sources;
 *   - `none`: no record: asked "शेड्यूलप्रमाणे" / "नको" only (nothing to copy as practice). No record is never "not done" and the words never say so;
 *   - `planOnly`: a plan of a work he took out of his schedule: listed apart and copied ONLY if he picks it.
 * Finishing with questions left unanswered never refuses the save: an unanswered work is carried as written, and the list says which (P8).
 * Pure functions (no clock, no store); the live reads are in `seasonReviewLocal.ts`.
 */
import type { ScheduleTaskContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import type { LocalPlannedWork } from '../../plannedWork/data/plannedWorkStore';
import { ownItemIdFor } from './ownWorkPlan';

export type ReviewKind = 'written' | 'differs' | 'none';
export type CarryChoice = 'schedule' | 'mine' | 'skip';

export interface ReviewWork {
    taskKey: string;
    task: ScheduleTaskContent;
}

export interface ReviewQuestion {
    taskKey: string;
    task: ScheduleTaskContent;
    kind: ReviewKind;
    /** The days the work was written for, as the farmer reads them (stored + 1); null when it has no day timer. */
    expectedFrom: number | null;
    expectedTo: number | null;
    /** The day of the record as the farmer reads it (shown = stored + 1), and its date; null when no record. */
    recordedDay: number | null;
    recordedOn: string | null;
    /** A repeating work done in part (some occurrences done, some still open). */
    part: boolean;
    /** What a pre-selection says: `schedule` for a work done as written, else nothing. */
    preselected: CarryChoice | null;
}

export interface PlanOnlyWork {
    taskKey: string;
    name: string;
}

export interface SeasonReviewModel {
    questions: ReviewQuestion[];
    planOnly: PlanOnlyWork[];
}

export interface SeasonReviewInput {
    /** The own works of the season that ended (active ones are asked; removed ones with a plan are listed apart). */
    works: readonly (ReviewWork & { state: 'active' | 'removed' })[];
    /** The plans of the plot (any season): the ones made from these works are read. */
    plans: readonly LocalPlannedWork[];
    /** log id -> its day (YYYY-MM-DD). */
    logDays: ReadonlyMap<string, string>;
    /** The day 0 of the season that ended (its pruning, YYYY-MM-DD). */
    dayZero: string;
    cropCycleId: string;
}

const dayNumber = (iso: string): number => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/** The stored day (from the pruning, pruning = 0) of a date. */
export const storedDayOf = (dayZero: string, date: string): number => dayNumber(date) - dayNumber(dayZero);

/** The day a farmer reads for a stored day: ONE helper, stored = shown - 1. */
export const shownDayOf = (stored: number): number => stored + 1;

const isOpen = (p: LocalPlannedWork) => p.status !== 'Done' && p.status !== 'Cancelled';

/** The earliest record day of the latest done plan of one work that has a log this phone knows; null when none. */
function recordOf(plans: readonly LocalPlannedWork[], logDays: ReadonlyMap<string, string>): string | null {
    const done = plans.filter(p => p.status === 'Done').sort((a, b) => (b.occurrence ?? 0) - (a.occurrence ?? 0));
    for (const plan of done) {
        const days = (plan.linkedDailyLogIds ?? []).map(id => logDays.get(id)).filter((d): d is string => !!d).sort();
        if (days.length > 0) return days[0] ?? null;
    }
    return null;
}

export function buildSeasonReview(input: SeasonReviewInput): SeasonReviewModel {
    const questions: ReviewQuestion[] = [];
    const planOnly: PlanOnlyWork[] = [];
    for (const w of input.works) {
        const mine = input.plans.filter(p => p.ownItemId === ownItemIdFor(input.cropCycleId, w.taskKey) && p.status !== 'Cancelled');
        if (w.state === 'removed') {
            if (mine.length > 0) planOnly.push({ taskKey: w.taskKey, name: w.task.name });
            continue;
        }
        const timing = w.task.timing;
        const dayTimer = timing.timer === 'day' && typeof timing.fromDay === 'number';
        const fromStored = dayTimer ? (timing.fromDay as number) : null;
        const toStored = dayTimer ? (typeof timing.toDay === 'number' ? timing.toDay : (timing.fromDay as number)) : null;
        const on = recordOf(mine, input.logDays);
        const recordedStored = on ? storedDayOf(input.dayZero, on) : null;
        const part = timing.repeat !== 'once' && mine.some(p => p.status === 'Done') && mine.some(isOpen);
        let kind: ReviewKind = 'none';
        if (on) {
            const outside = fromStored !== null && toStored !== null && recordedStored !== null && (recordedStored < fromStored || recordedStored > toStored);
            kind = outside || part ? 'differs' : 'written';
        } else if (part) {
            kind = 'differs';
        }
        questions.push({
            taskKey: w.taskKey,
            task: w.task,
            kind,
            expectedFrom: fromStored === null ? null : shownDayOf(fromStored),
            expectedTo: toStored === null ? null : shownDayOf(toStored),
            recordedDay: recordedStored === null ? null : shownDayOf(recordedStored),
            recordedOn: on,
            part,
            preselected: kind === 'written' ? 'schedule' : null,
        });
    }
    return { questions, planOnly };
}

/** The choices a question offers: a work with no record offers no "मी केलं तसं" (nothing to copy as practice). */
export const choicesOf = (q: Pick<ReviewQuestion, 'kind'>): CarryChoice[] => (q.kind === 'none' ? ['schedule', 'skip'] : ['schedule', 'mine', 'skip']);

export interface CarryRow {
    plotId: string;
    fromCropCycleId: string;
    cropCycleId: string;
    taskKey: string;
    answered: boolean;
    choice: string;
}

/** The season that ended for a plot's current season: the newest OLDER season with an own work, or null. `cycles` = this plot's seasons (id, start date). */
export function previousSeasonWithWork(
    cycles: readonly { id: string; start: string }[], currentId: string, hasWork: (cycleId: string) => boolean,
): string | null {
    const current = cycles.find(c => c.id === currentId);
    if (!current) return null;
    const older = cycles.filter(c => c.start < current.start && hasWork(c.id)).sort((a, b) => (a.start < b.start ? 1 : -1));
    return older[0]?.id ?? null;
}

/** The answers the server takes: only the works he answered; an untouched work is not listed (the server carries it as written and says so). */
export function answersOf(chosen: ReadonlyMap<string, CarryChoice>, questions: readonly ReviewQuestion[]): { taskKey: string; choice: CarryChoice }[] {
    return questions.filter(q => chosen.has(q.taskKey)).map(q => ({ taskKey: q.taskKey, choice: chosen.get(q.taskKey) as CarryChoice }));
}

/**
 * The name of the schedule a work was taken from, from its origin text (`take:` + the version id, 32 hex digits) and the schedule rows on the phone; null for a work made
 * by hand (the card then says "तुम्ही स्वतः") and for a take whose row is not on the phone (never a guessed name).
 */
export function originNameOf(origin: string | null | undefined, rows: readonly unknown[]): string | null {
    if (!origin || !origin.startsWith('take:')) return null;
    const hex = origin.slice(5).toLowerCase();
    for (const r of rows) {
        const row = r as { id?: unknown; name?: unknown } | null;
        if (row && typeof row.id === 'string' && row.id.replace(/-/g, '').toLowerCase() === hex && typeof row.name === 'string' && row.name.trim()) return row.name.trim();
    }
    return null;
}
