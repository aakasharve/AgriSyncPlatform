/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S3, S5–S8, S11, S12)
 *
 * The शेड्यूल page's model, built ONLY from the plot's real schedule (template + its per-plot instance) and
 * EVERY real log of that plot. Pure: today is passed in.
 *
 * Expected work per day comes from the one plan engine the app already uses (`derivePlannedItemsForDay`).
 * "Done" is decided at the four-part level (सिंचन / खत / फवारणी / कामे) — the only level the app can trust
 * today (PLR-D8 §2: the part is guessed from a name, so a named-task match would be a guess). For each day:
 *   - every log of that day for this plot is read (the old grid read only the FIRST one);
 *   - a part the schedule expected and some log covered          → done   (झालं)
 *   - a part the schedule expected on a day already gone, not covered → missed (राहिलं) — COMPUTED, never typed;
 *   - expected today and not covered yet                          → due
 *   - expected on a later day                                     → planned
 *   - covered by a log but not expected that day                  → extra  (जास्तीचं)
 * "Partly done" is NOT produced: what it means is open (PLR-D8 decision A).
 *
 * After the schedule's last day nothing is expected (the old grid kept repeating the last stage forever),
 * and a schedule that is only the app's built-in stand-in (`isFallbackTemplate`) is never fed here — the
 * page says there is no schedule instead (P4). "You are here" marks a stage only while today is inside it:
 * before the first stage or after the last one no stage is current.
 *
 * The days list starts PREP_DAYS before the schedule's day 0 (the old grid's land-preparation "PREP" days),
 * so work logged while the land was being prepared still shows; nothing is expected on those days.
 * Every expected task carries the schedule's OWN name for it (`detail`, e.g. "भुरीसाठी फवारणी"), so two
 * different sprays on one day stay two different lines.
 */
import type { DailyLog } from '../../../types';
import type { CropScheduleTemplate, PlotScheduleInstance, ScheduleShiftEvent } from '../scheduler.types';
import { derivePlannedItemsForDay, getStageEndDay, getStageStartDay, type PlannedTaskDerived } from '../planning/ClientPlanEngine';
import { getExecutionCountByCategory } from '../../../shared/utils/dayState';
import { countCompletedIrrigationEvents } from '../../../core/domain/services/IrrigationCompletionService';
import { CATEGORY_LABEL_MR } from '../../logs/services/dfesScheduleWindow';
import { addDays, daysBetween, toDayKey } from './scheduleDates';
import { opNameMr, stageNameMr } from './scheduleCopy';
import { taskNameMr } from './scheduleNames';

export type Part = 'irrigation' | 'nutrition' | 'spray' | 'work';
export const PARTS: readonly Part[] = ['irrigation', 'nutrition', 'spray', 'work'];
/** The app's own four words, reused (never re-typed). */
export const PART_LABEL: Readonly<Record<Part, string>> = {
    irrigation: CATEGORY_LABEL_MR.IRRIGATION,
    nutrition: CATEGORY_LABEL_MR.FERTIGATION,
    spray: CATEGORY_LABEL_MR.FOLIAR_SPRAY,
    work: CATEGORY_LABEL_MR.ACTIVITY,
};

/** The plan engine's seven categories folded into the four parts (same split as `dfesScheduleWindow`). */
export const partOf = (category: string): Part =>
    category === 'IRRIGATION' ? 'irrigation'
        : category === 'FERTIGATION' ? 'nutrition'
            : category === 'FOLIAR_SPRAY' ? 'spray'
                : 'work';

/**
 * One task the schedule expects. `title` is the app's Marathi word for the kind of work; `detail` is the
 * schedule's own name for this task (Marathi when the app ships it, else as written), `null` when it would
 * only repeat the title or the part.
 */
export interface ExpectedItem { key: string; part: Part; opId: string; title: string; detail: string | null; once: boolean }
export type CellStatus = 'done' | 'missed' | 'due' | 'planned' | 'extra' | 'none';
export interface DayCell { part: Part; items: ExpectedItem[]; done: boolean; status: CellStatus }
export type When = 'past' | 'today' | 'future';

export interface ScheduleDay {
    key: string;
    /** The schedule's day number (day 0 = the schedule's reference date, less any recorded shift). */
    day: number;
    when: When;
    /** Before the schedule's day 0 (land preparation): nothing is expected, work done shows as done. */
    prep: boolean;
    stageId: string | null;
    items: ExpectedItem[];
    cells: Record<Part, DayCell>;
    /** Every log of this plot on this day. */
    logs: DailyLog[];
}

export interface StageView { id: string; name: string; from: number; to: number; index: number; filledPct: number; current: boolean; past: boolean }

export interface ScheduleModel {
    todayKey: string;
    todayDay: number;
    totalDays: number | null;
    progressPct: number | null;
    stages: StageView[];
    /** The stage today is inside; `null` before the first stage starts and after the last one ends. */
    currentStage: StageView | null;
    /** The stage the झालं comparison covers: the current one, or the last one once the schedule has ended. */
    tallyStage: StageView | null;
    /** Today is after the schedule's last day. */
    ended: boolean;
    /** Oldest first, from PREP_DAYS before the schedule's start (at most MAX_BACK_DAYS back) to its last day (at least LOOK_AHEAD_DAYS ahead). */
    days: ScheduleDay[];
    byKey: ReadonlyMap<string, ScheduleDay>;
}

export interface ScheduleInput {
    template: CropScheduleTemplate;
    instance: PlotScheduleInstance;
    plotId: string;
    logs: readonly DailyLog[];
    todayKey: string;
    shifts?: readonly ScheduleShiftEvent[];
}

export const LOOK_AHEAD_DAYS = 8;
/** Days before day 0 shown as land preparation (the old grid showed 15). */
export const PREP_DAYS = 15;
const MAX_BACK_DAYS = 400;
const MAX_AHEAD_DAYS = 400;

/**
 * A stored plot schedule as the engine needs it. Old phones may hold a schedule saved by the old editor
 * (its wizard object: no overrides, `plantationDate` for the date) — read it, never crash on it (P11).
 */
export function normalizeInstance(
    raw: unknown,
    fallback: { plotId: string; templateId: string; referenceType: PlotScheduleInstance['referenceType']; referenceDate: string },
): PlotScheduleInstance {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<PlotScheduleInstance> & { plantationDate?: unknown };
    const refKey = toDayKey(src.referenceDate) ?? toDayKey(src.plantationDate) ?? fallback.referenceDate;
    return {
        id: typeof src.id === 'string' && src.id ? src.id : `sch_view_${fallback.plotId}`,
        plotId: typeof src.plotId === 'string' && src.plotId ? src.plotId : fallback.plotId,
        templateId: typeof src.templateId === 'string' && src.templateId ? src.templateId : fallback.templateId,
        referenceType: src.referenceType ?? fallback.referenceType,
        referenceDate: refKey,
        stageOverrides: Array.isArray(src.stageOverrides) ? src.stageOverrides : [],
        expectationOverrides: Array.isArray(src.expectationOverrides) ? src.expectationOverrides : [],
    };
}

/** This plot's logs, by IST day. A log with no readable date, or a deleted one, is on no day. */
export function plotLogsByDay(logs: readonly DailyLog[], plotId: string): Map<string, DailyLog[]> {
    const out = new Map<string, DailyLog[]>();
    for (const log of logs) {
        if (!log || log.deletion) continue;
        const key = toDayKey(log.date);
        if (!key) continue;
        const onPlot = (log.context?.selection ?? []).some(s => (s?.selectedPlotIds ?? []).includes(plotId));
        if (!onPlot) continue;
        const bucket = out.get(key);
        if (bucket) bucket.push(log); else out.set(key, [log]);
    }
    return out;
}

const SPRAY_WORD = /spray|फवार/i;
const notAGap = (status?: string) => status !== 'pending' && status !== 'gap_recorded';

/**
 * Which of the four parts these logs show as actually done. A told gap ("could not") is not done.
 * कामे = a crop activity that is not a spray (a spray-titled activity counts as फवारणी only, so a day with
 * only a spray never shows the expected खुरपणी as done), or workers / a machine on the plot — the app's own
 * ACTIVITY bucket (`getExecutionCountByCategory`), at the four-part level this page claims.
 */
export function partsDone(logs: readonly DailyLog[]): Set<Part> {
    const done = new Set<Part>();
    const list = logs as DailyLog[];
    if (list.some(l => countCompletedIrrigationEvents(l.irrigation) > 0)) done.add('irrigation');
    if (getExecutionCountByCategory(list, 'FERTIGATION') > 0) done.add('nutrition');
    const activities = list.flatMap(l => l.cropActivities ?? []).filter(a => notAGap(a.status));
    const isSpray = (a: { title?: string }) => SPRAY_WORD.test(a.title ?? '');
    if (getExecutionCountByCategory(list, 'FOLIAR_SPRAY') > 0 || activities.some(isSpray)) done.add('spray');
    const work = activities.some(a => !isSpray(a)) || list.some(l => (l.labour?.length ?? 0) > 0 || (l.machinery?.length ?? 0) > 0);
    if (work) done.add('work');
    return done;
}

function shiftUpTo(shifts: readonly ScheduleShiftEvent[] | undefined, key: string): number {
    let total = 0;
    for (const s of shifts ?? []) {
        const k = toDayKey(s?.date);
        if (k && k <= key && Number.isFinite(s.shiftDays)) total += s.shiftDays;
    }
    return total;
}

/** A PER_WEEK routine is due on a weekly cadence from its stage start (as `derivePlannedItemsForStage`), not daily. */
function keepItem(template: CropScheduleTemplate, instance: PlotScheduleInstance, item: PlannedTaskDerived, day: number, stageStart: number): boolean {
    if (item.type !== 'PERIODIC') return true;
    const pe = template.periodicExpectations.find(p => p.id === item.originalId);
    if (!pe) return true;
    const ov = instance.expectationOverrides.find(o => o.expectationId === pe.id);
    const mode = ov?.customFrequencyMode ?? pe.frequencyMode;
    if (mode !== 'PER_WEEK') return true;
    const per = Math.max(1, ov?.customFrequencyValue ?? pe.frequencyValue);
    const interval = Math.max(1, Math.floor(7 / per));
    return day >= stageStart && (day - stageStart) % interval === 0;
}

export function buildScheduleModel(input: ScheduleInput): ScheduleModel {
    const { template, instance, plotId, todayKey, shifts } = input;
    const refKey = toDayKey(instance.referenceDate) ?? todayKey;
    const planDay = (key: string) => daysBetween(refKey, key) - shiftUpTo(shifts, key);
    const todayDay = planDay(todayKey);

    const ranges = [...template.stages]
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(s => ({ s, from: getStageStartDay(s, instance), to: getStageEndDay(s, instance) }));
    const firstStart = ranges.length ? Math.min(...ranges.map(r => r.from)) : 0;
    const lastEnd = ranges.length ? Math.max(...ranges.map(r => r.to)) : -1;
    const stageAt = (day: number) => ranges.find(r => day >= r.from && day <= r.to) ?? null;
    // Only a stage today is inside is "where you are" (never the first one before it starts, nor the last after it ended).
    const currentRange = stageAt(todayDay);
    const ended = ranges.length > 0 && todayDay > lastEnd;

    const stages: StageView[] = ranges.map((r, index) => {
        const len = Math.max(1, r.to - r.from + 1);
        const filled = todayDay >= r.to ? 100 : todayDay < r.from ? 0 : ((todayDay - r.from + 1) / len) * 100;
        return { id: r.s.id, name: stageNameMr(r.s.name), from: r.from, to: r.to, index, filledPct: Math.round(filled), current: r === currentRange, past: todayDay > r.to };
    });
    const totalDays = template.totalDurationDays && template.totalDurationDays > 0 ? template.totalDurationDays : (ranges.length ? lastEnd : null);
    const progressPct = totalDays ? Math.min(100, Math.max(0, Math.round((todayDay / totalDays) * 100))) : null;

    // From PREP_DAYS before day 0 (never after today, never more than MAX_BACK_DAYS back).
    const prepKey = addDays(refKey, -PREP_DAYS);
    const oldest = addDays(todayKey, -MAX_BACK_DAYS);
    const firstKey = prepKey > todayKey ? todayKey : prepKey < oldest ? oldest : prepKey;
    // The lists look 8 days ahead; the day-by-day grid shows the rest of the schedule, so build to its end.
    const lastKey = addDays(todayKey, Math.max(LOOK_AHEAD_DAYS, Math.min(MAX_AHEAD_DAYS, lastEnd - todayDay)));
    const byDay = plotLogsByDay(input.logs, plotId);

    const days: ScheduleDay[] = [];
    for (let key = firstKey; key <= lastKey; key = addDays(key, 1)) {
        const day = planDay(key);
        const range = stageAt(day);
        const inSchedule = ranges.length > 0 && day >= firstStart && day <= lastEnd;
        const plan = inSchedule ? derivePlannedItemsForDay(template, instance, day) : null;
        const stageStart = plan?.stage ? getStageStartDay(plan.stage, instance) : firstStart;
        const items: ExpectedItem[] = (plan?.plannedItems ?? [])
            .filter(it => keepItem(template, instance, it, day, stageStart))
            .map(it => {
                const part = partOf(it.category);
                const title = opNameMr(it.operationId) ?? PART_LABEL[part];
                const own = it.notes ? taskNameMr(it.notes) : '';
                const detail = own && own !== title && own !== PART_LABEL[part] ? own : null;
                return { key: `${it.originalId}@${day}`, part, opId: it.operationId, title, detail, once: it.type === 'ONE_TIME' };
            });
        const logs = byDay.get(key) ?? [];
        const doneParts = partsDone(logs);
        const when: When = key < todayKey ? 'past' : key === todayKey ? 'today' : 'future';
        const cells = {} as Record<Part, DayCell>;
        for (const part of PARTS) {
            const mine = items.filter(i => i.part === part);
            const done = doneParts.has(part);
            const status: CellStatus = mine.length > 0
                ? (done ? 'done' : when === 'past' ? 'missed' : when === 'today' ? 'due' : 'planned')
                : (done ? 'extra' : 'none');
            cells[part] = { part, items: mine, done, status };
        }
        days.push({ key, day, when, prep: day < 0, stageId: range?.s.id ?? null, items, cells, logs });
    }

    const currentStage = stages.find(s => s.current) ?? null;
    return {
        todayKey,
        todayDay,
        totalDays,
        progressPct,
        stages,
        currentStage,
        tallyStage: currentStage ?? (ended ? stages[stages.length - 1] ?? null : null),
        ended,
        days,
        byKey: new Map(days.map(d => [d.key, d])),
    };
}

// ---- what the page reads --------------------------------------------------------------------------------

export interface Tally { expected: number; done: number; missed: number; extra: number }

/** Expected vs done for the current stage (the last one once the schedule ended), days already gone, one count per (day, part) (S7). */
export function stageTally(model: ScheduleModel, part?: Part): Tally {
    const out: Tally = { expected: 0, done: 0, missed: 0, extra: 0 };
    const st = model.tallyStage;
    if (!st) return out;
    for (const d of model.days) {
        if (d.when !== 'past' || d.day < st.from || d.day > st.to) continue;
        for (const p of PARTS) {
            if (part && p !== part) continue;
            const c = d.cells[p];
            if (c.items.length > 0) {
                out.expected += 1;
                if (c.status === 'done') out.done += 1; else out.missed += 1;
            } else if (c.status === 'extra') out.extra += 1;
        }
    }
    return out;
}

export type Verdict = 'allDone' | 'missed' | 'mixed' | 'none';
/** How a past day went, over the parts the schedule expected that day. */
export function dayVerdict(day: ScheduleDay): Verdict {
    const expected = PARTS.map(p => day.cells[p]).filter(c => c.items.length > 0);
    if (expected.length === 0) return 'none';
    const done = expected.filter(c => c.status === 'done').length;
    return done === expected.length ? 'allDone' : done === 0 ? 'missed' : 'mixed';
}

export interface OwedEntry { id: string; part: Part; title: string; detail: string | null; firstDay: number; lastDay: number; lastKey: string; times: number }

/**
 * आधी राहिलेलं काम (S6): work expected on a day already gone whose part has NOT been done on any day since
 * (up to today). Looks back over the current stage, and never less than the last 7 days (so yesterday's miss
 * does not vanish on a stage's first day). One line per part + task (the schedule's own task name keeps two
 * different sprays apart), with how many times it was owed.
 */
export function owedWork(model: ScheduleModel): OwedEntry[] {
    const st = model.tallyStage;
    const from = Math.max(0, Math.min(st ? st.from : model.todayDay, model.todayDay - 7));
    const lastDone: Partial<Record<Part, string>> = {};
    for (const d of model.days) {
        if (d.key > model.todayKey) break;
        for (const p of PARTS) if (d.cells[p].done) lastDone[p] = d.key;
    }
    const groups = new Map<string, OwedEntry>();
    for (const d of model.days) {
        if (d.when !== 'past' || d.day < from) continue;
        for (const p of PARTS) {
            const c = d.cells[p];
            if (c.status !== 'missed') continue;
            const doneSince = lastDone[p];
            if (doneSince && doneSince > d.key) continue;
            for (const it of c.items) {
                const id = `${p}|${it.title}|${it.detail ?? ''}`;
                const g = groups.get(id);
                if (g) { g.times += 1; g.lastDay = d.day; g.lastKey = d.key; } else groups.set(id, { id, part: p, title: it.title, detail: it.detail, firstDay: d.day, lastDay: d.day, lastKey: d.key, times: 1 });
            }
        }
    }
    return [...groups.values()].sort((a, b) => PARTS.indexOf(a.part) - PARTS.indexOf(b.part) || b.lastDay - a.lastDay);
}

/** Days after today, up to `n`, that the schedule expects something on (S12). */
export const upcomingDays = (model: ScheduleModel, n: number): ScheduleDay[] =>
    model.days.filter(d => d.when === 'future' && daysBetween(model.todayKey, d.key) <= n && d.items.length > 0);

export const aheadItemCount = (model: ScheduleModel, n: number): number =>
    upcomingDays(model, n).reduce((sum, d) => sum + d.items.length, 0);

/** Days already gone, newest first (S8). */
export const pastDays = (model: ScheduleModel): ScheduleDay[] => model.days.filter(d => d.when === 'past').reverse();

export const todayOf = (model: ScheduleModel): ScheduleDay | undefined => model.byKey.get(model.todayKey);

/** Parts done that day although the schedule did not ask for them (जास्तीचं). */
export const extrasOn = (day: ScheduleDay): Part[] => PARTS.filter(p => day.cells[p].status === 'extra');
