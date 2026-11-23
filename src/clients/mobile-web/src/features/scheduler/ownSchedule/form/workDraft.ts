/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker; approved spec plr-d10-schedule-approved-spec-2026-11-23; doctrine P4, P8,
 * P9) - the pure model of ONE work while the farmer answers its cards (what, when, how, look, ask), and the ONE task it becomes in the one task format
 * (`sync-contract/schemas/schedule-task.zod.ts`, read back by its own `parseScheduleTask`, so a task the server would refuse by shape never leaves here).
 *
 *   - Only the KIND and the NAME are needed (the format cannot hold a work without them). Nothing optional ever refuses (P9): a timer chosen and left
 *     unfinished is kept as "later" (timer none: a dayless work is never given a date), a window that ends before it starts keeps its first day only.
 *   - Days: a day the farmer types is a SHOWN day and goes through `storedScheduleDay`; "before pruning N" is stored -N (never 0, never a shown negative).
 *     A difference of days (after N days, every N days) is never shifted.
 *   - Basis: the farmer's own practice = `experience` (P8: recorded beside the value, never "stated").
 *   - The dose stays the farmer's words (P4): a stepper number becomes "लिटरला २ ग्रॅम" and is never parsed back into a number.
 *   - An edited work starts from the task as it is: every part the cards do not show (why, warnings, sources, origin, other products...) is kept as it was.
 * No React, no Dexie here.
 */
import {
    parseScheduleTask,
    type ParseResult,
    type ScheduleTaskContent,
    type ScheduleTaskKind,
} from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { shownScheduleDay, storedScheduleDay } from '../../schedulePage/scheduleDates';
import type { OwnLanguage } from '../ownScheduleWords';
import type { OwnWork } from '../ownScheduleModel';
import { qtyWords } from './workMakerWords';

export type WhenPick = 'unset' | 'later' | 'day' | 'after' | 'sign';
export type RepeatPick = 'once' | 'every_n_days' | 'per_week';

export interface WorkDraft {
    kind: ScheduleTaskKind | null;
    name: string;
    /** The stage by its place in the followed schedule's day order; null = left open. */
    stageIndex: number | null;
    when: WhenPick;
    /** Day timer: counted before the start day ("छाटणीआधी") instead of from it. */
    dayBefore: boolean;
    fromShown: number | null;
    toShown: number | null;
    beforeDays: number | null;
    afterKey: string | null;
    usualDays: number | null;
    earliestDays: number | null;
    signWords: string;
    repeat: RepeatPick;
    repeatN: number | null;
    product: string;
    qty: number | null;
    preHarvestDays: number | null;
    steps: string;
    lookWords: string;
    askWords: string;
    /** The task being changed (an edit), or null for a new work. */
    base: ScheduleTaskContent | null;
}

export const MAX_SHOWN_DAY = 3650;
const MAX_TEXT = 1000;

export function blankDraft(): WorkDraft {
    return {
        kind: null, name: '', stageIndex: null, when: 'unset', dayBefore: false, fromShown: null, toShown: null, beforeDays: null, afterKey: null,
        usualDays: null, earliestDays: null, signWords: '', repeat: 'once', repeatN: null, product: '', qty: null, preHarvestDays: null, steps: '',
        lookWords: '', askWords: '', base: null,
    };
}

/** The work can exist: a kind and a name that is not only spaces. */
export const canSave = (d: WorkDraft): boolean => d.kind !== null && d.name.trim().length > 0;

const clean = (s: string, max: number): string | null => {
    const t = s.trim();
    return t.length === 0 ? null : t.slice(0, max);
};

/** A changed work, as its cards show it. The dose words are not turned back into a number (the stepper starts empty and the old words are kept). */
export function draftFromTask(task: ScheduleTaskContent): WorkDraft {
    const t = task.timing;
    const d: WorkDraft = { ...blankDraft(), kind: task.kind, name: task.name, stageIndex: task.stageIndex, base: task };
    if (t.timer === 'day' && t.fromDay !== null) {
        d.when = 'day';
        if (t.fromDay < 0) { d.dayBefore = true; d.beforeDays = -t.fromDay; } else { d.fromShown = shownScheduleDay(t.fromDay); d.toShown = t.toDay === null ? null : shownScheduleDay(t.toDay); }
    } else if (t.timer === 'after') {
        d.when = 'after';
        d.afterKey = t.afterTaskKey; d.usualDays = t.usualDays; d.earliestDays = t.earliestDays;
    } else if (t.timer === 'sign') {
        d.when = 'sign';
        d.signWords = t.signWords ?? '';
    } else {
        d.when = 'later';
    }
    if (t.repeat !== 'once') { d.repeat = t.repeat; d.repeatN = t.repeatInterval; }
    d.product = task.products[0]?.name ?? '';
    d.preHarvestDays = task.preHarvestDays;
    d.steps = task.steps.join('\n');
    d.lookWords = task.look?.sign ?? '';
    d.askWords = task.ask?.question ?? '';
    return d;
}

/** A work of the checked schedule, copied as a NEW draft of his own (its day window as shown days; its stage is not carried). */
export function draftFromCheckedWork(w: OwnWork): WorkDraft {
    const d: WorkDraft = { ...blankDraft(), kind: w.part, name: w.name, when: 'day' };
    if (w.startDay < 0) { d.dayBefore = true; d.beforeDays = -w.startDay; } else { d.fromShown = shownScheduleDay(w.startDay); d.toShown = w.endDay > w.startDay ? shownScheduleDay(w.endDay) : null; }
    if (w.mode !== 'one_time') { d.repeat = w.mode; d.repeatN = w.intervalDays; }
    return d;
}

const NO_TIMING: ScheduleTaskContent['timing'] = {
    timer: 'none', fromDay: null, toDay: null, afterTaskKey: null, usualDays: null, earliestDays: null, latestDays: null, signWords: null,
    expectedFromDay: null, expectedToDay: null, whenWords: null, repeat: 'once', repeatInterval: null, repeatEndDay: null, repeatEndSign: null,
};

const inRange = (n: number | null, lo: number, hi: number): n is number => n !== null && Number.isInteger(n) && n >= lo && n <= hi;

/** The timer the answers hold; an unfinished one is none. The repeat rides on a timer only. */
export function timingOf(d: WorkDraft, base: ScheduleTaskContent['timing'] | null): ScheduleTaskContent['timing'] {
    // Parts of the timing the cards never show (latest day, expected window, repeat end...) are kept only while the timer stays the same kind.
    const keep = (timer: ScheduleTaskContent['timing']['timer']) => (base && base.timer === timer ? base : NO_TIMING);
    let t: ScheduleTaskContent['timing'] = { ...NO_TIMING };
    if (d.when === 'day') {
        if (d.dayBefore && inRange(d.beforeDays, 1, MAX_SHOWN_DAY)) {
            t = { ...NO_TIMING, timer: 'day', fromDay: -d.beforeDays, toDay: null };
        } else if (!d.dayBefore && inRange(d.fromShown, 1, MAX_SHOWN_DAY)) {
            const from = storedScheduleDay(d.fromShown);
            const to = inRange(d.toShown, d.fromShown, MAX_SHOWN_DAY) && d.toShown !== d.fromShown ? storedScheduleDay(d.toShown) : null;
            t = { ...NO_TIMING, timer: 'day', fromDay: from, toDay: to };
        }
    } else if (d.when === 'after' && d.afterKey) {
        const b = keep('after');
        const usual = inRange(d.usualDays, 0, MAX_SHOWN_DAY) ? d.usualDays : null;
        let early = inRange(d.earliestDays, 0, MAX_SHOWN_DAY) ? d.earliestDays : null;
        let latest = b.latestDays;
        if (early !== null && usual !== null && early > usual) early = null; // "early" later than usual is not early: dropped, never a refusal
        if (latest !== null && ((usual !== null && latest < usual) || (early !== null && latest < early))) latest = null;
        t = { ...NO_TIMING, timer: 'after', afterTaskKey: d.afterKey, usualDays: usual, earliestDays: early, latestDays: latest };
    } else if (d.when === 'sign' && clean(d.signWords, MAX_TEXT)) {
        const b = keep('sign');
        t = { ...NO_TIMING, timer: 'sign', signWords: clean(d.signWords, MAX_TEXT), expectedFromDay: b.expectedFromDay, expectedToDay: b.expectedToDay };
    }
    if (base && base.timer === t.timer) t = { ...t, whenWords: base.whenWords };
    if (t.timer !== 'none' && d.repeat !== 'once' && inRange(d.repeatN, 1, d.repeat === 'per_week' ? 7 : MAX_SHOWN_DAY)) {
        const b = base && base.repeat === d.repeat ? base : null;
        t = { ...t, repeat: d.repeat, repeatInterval: d.repeatN, repeatEndDay: b?.repeatEndDay ?? null, repeatEndSign: b?.repeatEndDay != null ? null : b?.repeatEndSign ?? null };
    }
    return t;
}

/** Safety gaps never shrink: a change may keep or lengthen the gap a work already had, never shorten or drop it. */
const safetyGap = (typed: number | null, had: number | null): number | null => (had === null ? typed : typed === null || typed < had ? had : typed);

export interface BuildContext {
    taskKey: string;
    order: number;
    language: OwnLanguage;
}

/** The ONE task the draft becomes, read back by the contract's own parser (its canonical shape: every key, no extra one). */
export function buildTask(d: WorkDraft, ctx: BuildContext): ParseResult<ScheduleTaskContent> {
    if (!canSave(d) || d.kind === null) return { ok: false, error: 'a work needs its kind and its name' };
    const base = d.base;
    const kind = d.kind;
    const qty = inRange(d.qty, 1, 100000) ? qtyWords(kind, d.qty, ctx.language) : null;
    const product = clean(d.product, 200);

    // How: the product and its dose words; with no product the dose words stand alone. Observation counts vines, which is where to look.
    let products = base ? base.products.slice() : [];
    let dose = base?.dose ?? null;
    if (product) {
        const first = products[0];
        products = [{ name: product, doseAsWritten: kind !== 'observe' && qty ? qty : first?.doseAsWritten ?? null, unit: first?.unit ?? null, perWhat: first?.perWhat ?? null, water: first?.water ?? null }, ...products.slice(1)];
    } else {
        products = products.slice(1);
        if (qty && kind !== 'observe') dose = qty;
    }
    const steps = d.steps.split('\n').map(s => s.trim()).filter(s => s.length > 0).slice(0, 20).map(s => s.slice(0, MAX_TEXT));

    const lookSign = clean(d.lookWords, MAX_TEXT);
    const lookSample = kind === 'observe' && qty ? qty : base?.look?.sample ?? null;
    const lookBase = base?.look ?? null;
    const look = lookSign || lookSample || (lookBase && (lookBase.where || lookBase.threshold || lookBase.ifThen.length > 0 || lookBase.photoRef))
        ? { where: lookBase?.where ?? null, sample: lookSample, sign: lookSign, threshold: lookBase?.threshold ?? null, ifThen: lookBase?.ifThen ?? [], photoRef: lookBase?.photoRef ?? null }
        : null;
    const question = clean(d.askWords, MAX_TEXT);
    const ask = question ? { question, when: base?.ask?.when ?? null, answers: base?.ask?.answers ?? [] } : null;

    const draftTask = {
        taskKey: ctx.taskKey,
        name: d.name.trim().slice(0, 200),
        kind,
        timing: timingOf(d, base?.timing ?? null),
        basis: base?.basis ?? 'experience',
        stageIndex: d.stageIndex ?? base?.stageIndex ?? 0,
        order: ctx.order,
        why: base?.why ?? null,
        dose,
        steps,
        products,
        reEntryHours: base?.reEntryHours ?? null,
        preHarvestDays: safetyGap(kind === 'spray' && inRange(d.preHarvestDays, 0, 365) ? d.preHarvestDays : null, base?.preHarvestDays ?? null),
        warnings: base?.warnings ?? [],
        look,
        ask,
        sources: base?.sources ?? [],
        origin: base?.origin ?? null,
    };
    return parseScheduleTask(draftTask);
}
