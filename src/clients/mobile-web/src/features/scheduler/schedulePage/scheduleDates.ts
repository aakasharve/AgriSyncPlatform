/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15) — date-key arithmetic for the शेड्यूल page.
 * Pure: everything works on `YYYY-MM-DD` keys (the app's IST day, `DateKeyService.getDateKey`), so a
 * page that crosses midnight or a device in another zone never moves a log to the wrong schedule day.
 */
import { getDateKey } from '../../../core/domain/services/DateKeyService';

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const utcOf = (key: string): number => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
};

/** A stored date (a key, or a full timestamp) as the IST day key; `null` when it cannot be read. */
export function toDayKey(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0) return null;
    if (KEY.test(value)) return value;
    const head = value.slice(0, 10);
    // A timestamp WITH a time part is an instant: read it in IST. A bare "YYYY-MM-DDT…" without a zone is
    // what logs carry as their day, so its date half is the day.
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
        const t = Date.parse(value);
        return Number.isFinite(t) ? getDateKey(new Date(t)) : null;
    }
    return KEY.test(head) ? head : null;
}

export const addDays = (key: string, n: number): string => new Date(utcOf(key) + n * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `fromKey` to `toKey` (negative when `toKey` is earlier). */
export const daysBetween = (fromKey: string, toKey: string): number => Math.round((utcOf(toKey) - utcOf(fromKey)) / DAY_MS);

/**
 * The ONE place the farmer's day numbering meets the stored one (founder D-167: the start day - pruning day for grapes, planting day
 * for the other crops - is DAY 1, as in the printed schedules). Everything the app stores, compares, syncs and sends keeps counting
 * from 0 (the server's contract); only the number PRINTED for a schedule day goes through `shownScheduleDay`, and a number the farmer
 * TYPES as a schedule day goes back through `storedScheduleDay` before it is kept. A difference of days ("starts in 3 days",
 * "N days behind", "every N days") is not a day number and is never shifted.
 */
export const shownScheduleDay = (stored: number): number => stored + 1;

/** The inverse of `shownScheduleDay`: the day a farmer typed (day 1 = the start day) as the stored, 0-based day. */
export const storedScheduleDay = (shown: number): number => shown - 1;

/** "सोम, 26 ऑक्टो" — Marathi words, the app's Latin digits (same formatter as the money pages). */
export function dayDateLabel(key: string): string {
    try {
        return new Intl.DateTimeFormat('mr-IN-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
            .format(new Date(utcOf(key)));
    } catch {
        return key;
    }
}
