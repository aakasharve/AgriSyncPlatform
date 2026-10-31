/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * करायची कामे — the page's to-do list, from the REAL planned tasks. Pure.
 *
 * Source: the task store (`plannedTasks`, persisted by `useAppData`) plus the tasks carried by the chosen
 * day's logs — the same union the old "To Do Tasks" block read. A reminder the farmer spoke or wrote
 * reaches this list as an `observation_derived` task (`LogFactory` mirrors every reminder note into one),
 * so "reminders are the to-do list" is true of the real data, not a second store.
 *
 * Read by time, as the founder asked: वेळ उलटली (due before today, still open) → आज → पुढचे दिवस → तारीख
 * नाही (the old block's "No Due Date" group) → झालेली. Late tasks keep feeding what they fed before (the
 * day-closure count in `shared/utils/dayState.ts`); this page adds no second path.
 *
 * Two fixes ride along, both found while moving the block:
 *   - `mergeTasks`: the store's copy WINS over a log's copy. The old merge let the log's stale copy win,
 *     so a task ticked done in the store could still read as open here.
 *   - `canToggle`: only a task the store holds can be ticked from here — the store is what the tick
 *     updates, so a tick on any other task would look like it worked and change nothing (P5).
 * Every Marathi string is PROPOSED.
 */
import type { CropProfile, PlannedTask } from '../../../types';
import { dateLabel, fromDateKey, offsetOf, weekdayOf } from './reflectDates';
import type { ViewScope } from './reflectSelection';
import { cropNameIn } from '../../../shared/names/namesIn';

const FARM_GLOBAL = 'FARM_GLOBAL';

export type TodoGroup = 'late' | 'today' | 'later' | 'nodate' | 'done';

export interface TodoItem {
    id: string;
    title: string;
    task: PlannedTask;
    group: TodoGroup;
    done: boolean;
    dueText: string;
    kindLabel: 'आठवण' | 'काम';
    fromLabel: string;
    priorityLabel?: 'तातडीचं' | 'महत्त्वाचं';
    /** Plot · crop (with the crop's colour), the whole farm, or nothing when the place is not known. */
    place?: { label: string; color?: string };
    canToggle: boolean;
}

export interface TodoList {
    late: TodoItem[];
    today: TodoItem[];
    later: TodoItem[];
    noDate: TodoItem[];
    done: TodoItem[];
    openCount: number;
    total: number;
}

const FROM_LABEL: Record<PlannedTask['sourceType'], string> = {
    schedule: 'शेड्यूलमधून',
    manual: 'हाताने जोडलं',
    ai_extracted: 'बोलण्यातून',
    observation_derived: 'नोंदीतून',
};

const PRIORITY_RANK: Record<PlannedTask['priority'], number> = { urgent: 3, high: 2, normal: 1 };

const isClosed = (t: PlannedTask) => t.status === 'done' || t.status === 'cancelled';
const isFarmWide = (t: PlannedTask) => (!t.plotId || t.plotId === FARM_GLOBAL) && (!t.cropId || t.cropId === FARM_GLOBAL);

/** Store first, then the logs' tasks it does not already hold: the store's copy wins. */
export function mergeTasks(store: readonly PlannedTask[], fromLogs: readonly PlannedTask[]): PlannedTask[] {
    const byId = new Map<string, PlannedTask>();
    for (const t of fromLogs) byId.set(t.id, t);
    for (const t of store) byId.set(t.id, t);
    const order = [...store.map(t => t.id), ...fromLogs.map(t => t.id)];
    return [...new Set(order)].map(id => byId.get(id)!);
}

/** The tick: open → done (stamped now), done → open again. The whole task, as the page's `onUpdateTask` expects. */
export function toggledTask(t: PlannedTask, now: Date = new Date()): PlannedTask {
    const status = t.status === 'done' ? 'pending' : 'done';
    return { ...t, status, completedAt: status === 'done' ? now.toISOString() : undefined };
}

/** When a to-do typed on this page is due (spec plr-d10 I14, T2). */
export type TodoWhen = 'today' | 'tomorrow' | 'next_week' | 'no_date';

/** The days each choice adds to today — the same four the app's task sheet offers. */
const WHEN_DAYS: Record<Exclude<TodoWhen, 'no_date'>, number> = { today: 0, tomorrow: 1, next_week: 7 };

const addDaysToKey = (key: string, n: number): string => {
    const [y, m, d] = key.slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};

/**
 * spec: plr-d10 (I22, founder D-1) — "वेळ बदला" on a reminder: the same task, a new due day from the same four
 * choices, in the same store (so करायची कामे and लक्ष द्या both move it). Nothing else on the task changes.
 */
export function rescheduledTask(t: PlannedTask, when: TodoWhen, todayKey: string): PlannedTask {
    return { ...t, dueDate: when === 'no_date' ? undefined : addDaysToKey(todayKey, WHEN_DAYS[when]) };
}

export interface NewTodo {
    title: string;
    when: TodoWhen;
    priority: PlannedTask['priority'];
    /** The one plot the page is narrowed to; absent → the whole farm. */
    place?: { plotId: string; cropId: string };
}

/**
 * spec: plr-d10 (I14, T2) — a to-do typed inline ("आठवण जोडा") as the SAME record the app's task sheet
 * makes (`TaskCreationSheet.handleSave`: manual, pending, a due date from the same four choices), saved to
 * the same store. One difference, on purpose: with no plot chosen it belongs to the whole farm
 * (`FARM_GLOBAL`, as `LogFactory` files a spoken reminder), never the sheet's made-up `'unknown_plot'`.
 */
export function newTodoTask(todo: NewTodo, todayKey: string, id: string, now: Date = new Date()): PlannedTask {
    return {
        id,
        title: todo.title.trim(),
        plotId: todo.place?.plotId ?? FARM_GLOBAL,
        cropId: todo.place?.cropId ?? FARM_GLOBAL,
        priority: todo.priority,
        status: 'pending',
        sourceType: 'manual',
        dueDate: todo.when === 'no_date' ? undefined : addDaysToKey(todayKey, WHEN_DAYS[todo.when]),
        createdAt: now.toISOString(),
        tags: [],
    };
}

interface BuildArgs {
    tasks: readonly PlannedTask[];
    /** Ids the task store holds (the only ones a tick can change). */
    storeIds: ReadonlySet<string>;
    crops: readonly CropProfile[];
    scope: ViewScope;
    /** Nothing narrowed: every task shows, as the old block showed every task. */
    wholeFarm: boolean;
    todayKey: string;
    /** spec I18 — the language crop names are shown in (default Marathi, the screen's language). */
    language?: string;
}

export function buildTodoList({ tasks, storeIds, crops, scope, wholeFarm, todayKey, language = 'mr' }: BuildArgs): TodoList {
    const plotOwner = new Map<string, CropProfile>();
    for (const c of crops) for (const p of c.plots ?? []) plotOwner.set(p.id, c);

    const inScope = (t: PlannedTask): boolean => {
        if (wholeFarm || isFarmWide(t)) return true;
        const owner = t.plotId ? plotOwner.get(t.plotId) : undefined;
        if (owner) {
            if (!scope.viewCrops.includes(owner.id)) return false;
            const picked = scope.viewPlots[owner.id] ?? [];
            return picked.length === 0 || picked.includes(t.plotId);
        }
        if (t.cropId && crops.some(c => c.id === t.cropId)) return scope.viewCrops.includes(t.cropId);
        return true;
    };

    const placeOf = (t: PlannedTask): TodoItem['place'] => {
        if (isFarmWide(t)) return { label: 'पूर्ण शेत' };
        const owner = t.plotId ? plotOwner.get(t.plotId) : undefined;
        // spec I18 — the crop in his language; the plot's own name as he wrote it.
        if (owner) return { label: `${owner.plots.find(p => p.id === t.plotId)!.name} · ${cropNameIn(owner.name, language, owner.masterId)}`, color: owner.color };
        const cropOf = crops.find(c => c.id === t.cropId);
        return cropOf ? { label: cropNameIn(cropOf.name, language, cropOf.masterId), color: cropOf.color } : undefined;
    };

    const today = fromDateKey(todayKey);
    const toItem = (t: PlannedTask): TodoItem => {
        const due = t.dueDate ? t.dueDate.slice(0, 10) : undefined;
        const o = due ? offsetOf(fromDateKey(due), today) : undefined;
        const group: TodoGroup = isClosed(t) ? 'done' : o === undefined ? 'nodate' : o < 0 ? 'late' : o === 0 ? 'today' : 'later';
        const dueText = t.status === 'cancelled' ? 'रद्द'
            : t.status === 'done' ? 'झालं'
                : o === undefined ? 'तारीख नाही'
                    : o < 0 ? `${-o} दिवस उशीर`
                        : o === 0 ? 'आज'
                            : o === 1 ? 'उद्या'
                                : `${weekdayOf(fromDateKey(due!))}, ${dateLabel(fromDateKey(due!))}`;
        return {
            id: t.id,
            title: t.title,
            task: t,
            group,
            done: isClosed(t),
            dueText,
            // A reminder he spoke (`observation_derived`) or typed himself (`manual` — what "आठवण जोडा" saves,
            // and what the old task sheet saved) is an आठवण, as the approved preview files a typed line; work
            // the schedule or a parse put on the list is a काम (I14-V2-02: "आठवण जोडा" must not land as "काम").
            kindLabel: t.sourceType === 'observation_derived' || t.sourceType === 'manual' ? 'आठवण' : 'काम',
            fromLabel: FROM_LABEL[t.sourceType] ?? '',
            priorityLabel: t.priority === 'urgent' ? 'तातडीचं' : t.priority === 'high' ? 'महत्त्वाचं' : undefined,
            place: placeOf(t),
            canToggle: storeIds.has(t.id),
        };
    };

    const items = tasks.filter(inScope).map(toItem);
    const byPriority = (a: TodoItem, b: TodoItem) => PRIORITY_RANK[b.task.priority] - PRIORITY_RANK[a.task.priority];
    const byDue = (a: TodoItem, b: TodoItem) => (a.task.dueDate ?? '').localeCompare(b.task.dueDate ?? '');
    const of = (g: TodoGroup) => items.filter(i => i.group === g);

    return {
        late: of('late').sort((a, b) => byPriority(a, b) || byDue(a, b)),
        today: of('today').sort(byPriority),
        later: of('later').sort((a, b) => byDue(a, b) || byPriority(a, b)),
        noDate: of('nodate').sort(byPriority),
        done: of('done'),
        openCount: items.filter(i => !i.done).length,
        total: items.length,
    };
}
