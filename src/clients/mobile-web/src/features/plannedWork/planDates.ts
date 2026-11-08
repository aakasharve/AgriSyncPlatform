/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2, founder D-24c) - the "when" of a task: the preview's date helpers
 * (planModel.ts) over the real task. A dated task whose day has passed and that is not finished is LATE; a task with no date,
 * or only a loose "this week / this month / whenever", is never late (D-24c). Pure.
 */
import type { PlannedWorkLooseWhenName, PlannedWorkStatusName } from '../../infrastructure/storage/plannedWorkRow';
import type { PlannedWorkWords } from './plannedWorkWords';

const DAY = 86_400_000;

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const toIso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromIso = (iso: string): Date => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Days from today to the date (negative = past). */
export const daysAway = (iso: string, today: Date): number => Math.round((fromIso(iso).getTime() - startOfDay(today).getTime()) / DAY);

/** What he tapped under "कधी?". */
export type WhenPick = null | 'today' | 'tomorrow' | 'in8' | 'date' | PlannedWorkLooseWhenName;

/** The wire fields a pick stands for (never both a date and a loose word), or null while it is not complete. */
export function whenFields(pick: WhenPick, dateText: string, today: Date): { plannedDate?: string; looseWhen?: PlannedWorkLooseWhenName } | null {
    if (pick === 'today') return { plannedDate: toIso(today) };
    if (pick === 'tomorrow') return { plannedDate: toIso(addDays(today, 1)) };
    if (pick === 'in8') return { plannedDate: toIso(addDays(today, 8)) };
    if (pick === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? { plannedDate: dateText } : null;
    if (pick === 'Week' || pick === 'Month' || pick === 'Anytime') return { looseWhen: pick };
    return null;
}

/** The pick a resolved day stands for (so a spoken "उद्या" lights the "उद्या" chip). */
export function pickForDate(iso: string, today: Date): { pick: WhenPick; dateText: string } {
    const n = daysAway(iso, today);
    if (n === 0) return { pick: 'today', dateText: '' };
    if (n === 1) return { pick: 'tomorrow', dateText: '' };
    if (n === 8) return { pick: 'in8', dateText: '' };
    return { pick: 'date', dateText: iso };
}

const FINISHED: ReadonlySet<PlannedWorkStatusName> = new Set<PlannedWorkStatusName>(['Done', 'Cancelled']);

export interface WhenView {
    main: string;
    sub?: string;
    /** No date, or only a loose one: amber, never late. */
    undated: boolean;
    /** A dated task past its day and not finished: red. */
    late: boolean;
}

export function whenView(
    task: { plannedDate: string | null; looseWhen: PlannedWorkLooseWhenName | null; status: PlannedWorkStatusName },
    today: Date,
    words: PlannedWorkWords,
    language: string | null | undefined,
): WhenView {
    if (!task.plannedDate) {
        return { main: words.noDate, sub: task.looseWhen ? words.looseWhen[task.looseWhen] : undefined, undated: true, late: false };
    }
    const n = daysAway(task.plannedDate, today);
    const rel = n === 0 ? words.today : n === 1 ? words.tomorrow : n > 1 ? words.daysAway(n) : words.daysAgo(-n);
    let sub: string;
    try {
        sub = new Intl.DateTimeFormat(language === 'en' ? 'en-IN' : 'mr-IN-u-nu-latn', { day: 'numeric', month: 'short' }).format(fromIso(task.plannedDate));
    } catch {
        sub = task.plannedDate;
    }
    return { main: rel, sub, undated: false, late: n < 0 && !FINISHED.has(task.status) };
}

/** Dated first (soonest first), then the ones with no date; ties keep the given order. */
export function sortByWhen<T extends { plannedDate: string | null }>(items: readonly T[]): T[] {
    return [...items].sort((a, b) => {
        if (!a.plannedDate !== !b.plannedDate) return a.plannedDate ? -1 : 1;
        if (a.plannedDate && b.plannedDate) return a.plannedDate.localeCompare(b.plannedDate);
        return 0;
    });
}
