/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * attendanceManual — the manual door's status -> wire mapping, in ONE pure
 * module so the vocabulary cannot fork between screens.
 *
 * Per person there are two independent controls (PLAN D-H3 split cell):
 *   day chip   आला -> Full · अर्धा -> Half · आला नाही -> Absent   (none by default)
 *   night      रात्र -> nightMark Worked                           (off by default)
 * plus optional stated hours / extra hours (counts, never day fractions).
 *
 * UNTOUCHED IS NOT ABSENT (rule 4): a person with no selection yields NO mark.
 * A selection equal to what the register already holds (`prefill`) is not
 * re-sent. Nothing here ever produces a headcount or a money figure.
 */
import type { LedgerCell } from './labour.types';

export type DayChoice = 'Full' | 'Half' | 'Absent';

/** What the farmer has chosen for one person on this screen. */
export interface PersonSelection {
    day: DayChoice | null;
    night: boolean;
    /** Raw text of the optional hours box ('' = nothing stated). */
    hours: string;
    /** Raw text of the optional extra-hours box. */
    extraHours: string;
}

/** What the register already holds for the person today (read-only context). */
export interface PersonPrefill {
    day: DayChoice | null;
    night: boolean;
    hours: number | null;
    extraHours: number | null;
}

export interface ManualMarkFacts {
    dayMark?: DayChoice;
    nightMark?: 'Worked';
    hoursWorked?: number;
    extraHours?: number;
}

export const EMPTY_SELECTION: PersonSelection = { day: null, night: false, hours: '', extraHours: '' };
export const EMPTY_PREFILL: PersonPrefill = { day: null, night: false, hours: null, extraHours: null };

/** Largest hours figure a day can honestly hold; also bounds the input box. */
export const MAX_HOURS = 24;

/**
 * Text -> a stated positive number, or null when nothing (usable) is stated.
 * The wire requires > 0 (the server refuses 0), so '' / '0' / junk mean
 * "nothing stated", never a zero.
 */
export function parseHours(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_HOURS) return null;
    return n;
}

/** Keeps the hours boxes numeric: digits and at most one dot, bounded. */
export function sanitizeHoursInput(raw: string): string {
    const cleaned = raw.replace(/[^\d.]/g, '');
    const firstDot = cleaned.indexOf('.');
    const single = firstDot === -1
        ? cleaned
        : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    const n = Number(single);
    if (Number.isFinite(n) && n > MAX_HOURS) return '';
    return single;
}

const DAY_FROM_CELL: Record<'full' | 'half' | 'absent', DayChoice> = {
    full: 'Full', half: 'Half', absent: 'Absent',
};

/** Today's register cell -> the prefill the screen shows as already recorded. */
export function prefillFromCell(cell: LedgerCell | null | undefined): PersonPrefill {
    if (!cell) return EMPTY_PREFILL;
    return {
        day: cell.day ? DAY_FROM_CELL[cell.day] : null,
        night: cell.night === 'worked',
        hours: cell.hours,
        extraHours: cell.extraHours,
    };
}

/** The selection a screen starts a person with: exactly what is already recorded. */
export function selectionFromPrefill(prefill: PersonPrefill): PersonSelection {
    return {
        day: prefill.day,
        night: prefill.night,
        hours: prefill.hours == null ? '' : String(prefill.hours),
        extraHours: prefill.extraHours == null ? '' : String(prefill.extraHours),
    };
}

/**
 * The facts to send for one person, or null when the farmer stated nothing
 * new (untouched, or everything equals what is already recorded).
 */
export function toMarkPayload(sel: PersonSelection, prefill: PersonPrefill = EMPTY_PREFILL): ManualMarkFacts | null {
    const facts: ManualMarkFacts = {};
    if (sel.day !== null && sel.day !== prefill.day) facts.dayMark = sel.day;
    if (sel.night && !prefill.night) facts.nightMark = 'Worked';
    const hours = parseHours(sel.hours);
    if (hours !== null && hours !== prefill.hours) facts.hoursWorked = hours;
    const extra = parseHours(sel.extraHours);
    if (extra !== null && extra !== prefill.extraHours) facts.extraHours = extra;
    return Object.keys(facts).length === 0 ? null : facts;
}
