// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8) - the day cards as DATA: which works fall on a shown day, and which cards each work makes. Pure (no React,
// no storage), so the renderer only draws what this returns, and "no empty card" is decided here, once, and tested.
//
// A card exists only when it has something to say: a work with no steps has no "how" card, no look has no look card, a challenge with nothing in it is not drawn. Every
// shown day opens with ONE day card (the day, the stage, the counts) so a day on which the schedule asks nothing still opens on words, never on a blank page.
import type { ScheduleChallengeContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import type { DayCardStage, DayCardTask, DayCardsDetail } from './dayCardsTypes';
import { storedScheduleDay } from '../schedulePage/scheduleDates';
import type { OwnerMessage } from '../ownerVoice/ownerVoiceTypes';

type Product = DayCardTask['task']['products'][number];

// ---- the dose rule (P4: a dose nobody checked is never shown as checked; no number without its source) ----------------------------------------------------------------

const DIGIT = '0-9\\u0966-\\u096F';
/** A number followed by a letter: "२ ग्रॅम", "40 ppm", "३०–४० मिली" carry their unit in the words. */
const NUMBER_THEN_UNIT = new RegExp(`[${DIGIT}][${DIGIT}.,–\\-/ ]*\\s*\\p{L}`, 'u');

const has = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim().length > 0;

/** Whether the dose words carry a unit: the unit given apart, or a unit word right after the number in the words as written. */
export function doseHasUnit(dose: string | null | undefined, unit: string | null | undefined): boolean {
    if (has(unit)) return true;
    return has(dose) && NUMBER_THEN_UNIT.test(dose);
}

export interface DoseLine {
    name: string | null;
    /** The dose in the source's own words, with its unit; null when it may not be shown. */
    text: string | null;
    perWhat: string | null;
    water: string | null;
    /** True when a dose was given but is withheld because its unit or its source is missing. */
    withheld: boolean;
}

/**
 * The doses of one work, each either SHOWN (it has a unit and the work has a source) or WITHHELD (said so, never shown as a bare number). Nothing is converted or
 * computed: the words are the source's own.
 */
export function doseLines(task: DayCardTask['task']): DoseLine[] {
    const hasSource = task.sources.length > 0;
    const lines: DoseLine[] = [];
    const taskLevel = has(task.dose) ? task.dose : null;
    for (const p of task.products as Product[]) {
        const written = has(p.doseAsWritten) ? p.doseAsWritten : null;
        if (!written && !has(p.unit)) {
            lines.push({ name: p.name, text: null, perWhat: null, water: has(p.water) ? p.water : null, withheld: false });
            continue;
        }
        const withUnit = written && has(p.unit) && !doseHasUnit(written, null) ? `${written} ${p.unit}` : written ?? p.unit ?? '';
        const ok = hasSource && doseHasUnit(written, p.unit);
        lines.push({ name: p.name, text: ok ? withUnit : null, perWhat: ok && has(p.perWhat) ? p.perWhat : null, water: has(p.water) ? p.water : null, withheld: !ok });
    }
    if (taskLevel && lines.every(l => l.text === null && !l.withheld)) {
        const ok = hasSource && doseHasUnit(taskLevel, null);
        lines.unshift({ name: null, text: ok ? taskLevel : null, perWhat: null, water: null, withheld: !ok });
    }
    return lines;
}

// ---- which works fall on a shown day --------------------------------------------------------------------------------------------------------------------------------

/** The stored day window of a work, or null when its timer is not a day (after, sign, none yet). */
function dayWindow(t: DayCardTask['task']): { from: number; to: number } | null {
    if (t.timing.timer !== 'day' || t.timing.fromDay === null) return null;
    return { from: t.timing.fromDay, to: t.timing.toDay ?? t.timing.fromDay };
}

/** Whether the work is on the stored day: inside its window, and for "every N days" only on its N-th days. */
export function isOnStoredDay(t: DayCardTask['task'], stored: number): boolean {
    const w = dayWindow(t);
    if (!w) return false;
    const end = t.timing.repeatEndDay !== null && t.timing.repeat !== 'once' ? Math.max(w.to, t.timing.repeatEndDay) : w.to;
    if (stored < w.from || stored > end) return false;
    if (t.timing.repeat === 'every_n_days' && t.timing.repeatInterval) {
        return (stored - w.from) % t.timing.repeatInterval === 0;
    }
    return true;
}

/** The works on a SHOWN day (day 1 = the start day; the one helper turns it back to the stored day), in the schedule's order. */
export function tasksOnShownDay(detail: DayCardsDetail, shownDay: number): DayCardTask[] {
    const stored = storedScheduleDay(shownDay);
    return detail.tasks
        .filter(t => isOnStoredDay(t.task, stored))
        .sort((a, b) => a.task.stageIndex - b.task.stageIndex || a.task.order - b.task.order || a.task.taskKey.localeCompare(b.task.taskKey));
}

/** The stage a shown day falls in (by stored day), or null when the schedule keeps no stage line. */
export function stageOnShownDay(detail: DayCardsDetail, shownDay: number): DayCardStage | null {
    const stored = storedScheduleDay(shownDay);
    return detail.stages.find(s => stored >= s.from.stored && stored <= s.to.stored) ?? null;
}

// ---- the cards ------------------------------------------------------------------------------------------------------------------------------------------------------

export type CardPart =
    | { type: 'day'; shownDay: number | null; stageName: string | null; tasks: number; looks: number; challenges: number; stageChallenges: number; empty: boolean }
    | { type: 'hero'; task: DayCardTask }
    | { type: 'how'; task: DayCardTask }
    | { type: 'safety'; task: DayCardTask }
    | { type: 'look'; task: DayCardTask }
    | { type: 'ask'; task: DayCardTask }
    | { type: 'challenge'; challenge: ScheduleChallengeContent }
    | { type: 'source'; task: DayCardTask }
    // slice 12b: the schedule owner's own cards, laid in by `withOwnerCards` (a tip is no card: it is a play button on its work's hero card).
    | { type: 'ownerChange'; message: OwnerMessage; task: DayCardTask }
    | { type: 'ownerLook'; message: OwnerMessage; task: DayCardTask };

const isLook = (t: DayCardTask['task']): boolean => t.kind === 'observe';

/** The cards ONE work makes, in the order the farmer swipes: what, how, care, look, the question, source. A card with nothing to say is not made. */
export function cardsOfTask(t: DayCardTask): CardPart[] {
    const task = t.task;
    const parts: CardPart[] = [{ type: 'hero', task: t }];
    if (task.steps.length > 0) parts.push({ type: 'how', task: t });
    if (task.warnings.length > 0 || task.reEntryHours !== null || task.preHarvestDays !== null) parts.push({ type: 'safety', task: t });
    const look = task.look;
    if (look && (look.where || look.sample || look.sign || look.threshold || look.ifThen.length > 0)) parts.push({ type: 'look', task: t });
    if (task.ask) parts.push({ type: 'ask', task: t });
    parts.push({ type: 'source', task: t });
    return parts;
}

/** The challenges of a stage that has any thing to say (a title alone is a card with a name and nothing else: it is not drawn). */
export function challengesOfStage(detail: DayCardsDetail, stageIndex: number): ScheduleChallengeContent[] {
    return detail.challenges
        .filter(c => c.stageIndex === stageIndex && (c.signs || c.action || c.whenWords || c.ifThen.length > 0))
        .sort((a, b) => a.order - b.order);
}

/** The deck of ONE shown day: its day card, then every work's cards, then the stage's challenges (each once). Never empty. */
export function deckForShownDay(detail: DayCardsDetail, shownDay: number): CardPart[] {
    const tasks = tasksOnShownDay(detail, shownDay);
    const stage = stageOnShownDay(detail, shownDay);
    const stageIndexes = new Set(tasks.map(t => t.task.stageIndex));
    if (stage) stageIndexes.add(stage.index);
    const challenges = [...stageIndexes].sort((a, b) => a - b).flatMap(i => challengesOfStage(detail, i));
    const parts: CardPart[] = [{
        type: 'day',
        shownDay,
        stageName: stage?.name ?? null,
        tasks: tasks.filter(t => !isLook(t.task)).length,
        looks: tasks.filter(t => isLook(t.task)).length,
        challenges: challenges.length,
        // The number the card SAYS ("this stage's N challenges follow"): this stage's own, not those of an earlier stage whose works still run today.
        stageChallenges: stage ? challengesOfStage(detail, stage.index).length : 0,
        empty: tasks.length === 0,
    }];
    for (const t of tasks) parts.push(...cardsOfTask(t));
    for (const c of challenges) parts.push({ type: 'challenge', challenge: c });
    return parts;
}

/** The deck of ONE work (opened from a job card or from planning), by its key: null when this version has no such work. */
export function deckForTask(detail: DayCardsDetail, taskKey: string): CardPart[] | null {
    const t = detail.tasks.find(x => x.task.taskKey === taskKey);
    if (!t) return null;
    const parts = cardsOfTask(t);
    for (const c of challengesOfStage(detail, t.task.stageIndex)) parts.push({ type: 'challenge', challenge: c });
    return parts;
}

/**
 * The first position the viewer can step back to: day 1 (the start day), or earlier when the schedule has work BEFORE it (a position of 0 or less is "N days before":
 * position = stored + 1, so position 0 is one day before the start day and is never printed as day 0).
 */
export function firstShownDay(detail: DayCardsDetail): number {
    let first = 1;
    for (const t of detail.tasks) {
        const timing = t.task.timing;
        for (const d of [timing.fromDay, timing.toDay]) if (d !== null) first = Math.min(first, d + 1);
    }
    for (const s of detail.stages) first = Math.min(first, s.from.stored + 1);
    return first;
}

/** The last SHOWN day the schedule speaks of (its last stage's end, or its latest work), so the viewer can step through the days; at least 1. */
export function lastShownDay(detail: DayCardsDetail): number {
    let last = 0;
    for (const s of detail.stages) last = Math.max(last, s.to.shown ?? 0);
    for (const t of detail.tasks) {
        const timing = t.task.timing;
        for (const d of [timing.fromDay, timing.toDay, timing.repeatEndDay]) if (d !== null) last = Math.max(last, d + 1);
    }
    return Math.max(1, last);
}
