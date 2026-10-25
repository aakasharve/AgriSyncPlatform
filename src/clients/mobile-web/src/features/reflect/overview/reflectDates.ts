/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * Calendar-day helpers for "पूर्ण शेतीचा आढावा", in plain Marathi. Pure: no React, no store.
 *
 * Every day is held at LOCAL NOON, never midnight. `getDateKey` (the app's one date-key service)
 * reads a Date in IST; a midnight Date on a phone whose zone is ahead of IST would read as the day
 * before. Noon is the same calendar day in every zone, so a day picked here and the key the logs
 * carry can never drift apart. Dates only — no time of day is formatted here (the time-of-day
 * formatters live in `shared/utils/displayTime.ts`).
 *
 * Every Marathi string is PROPOSED (the Marathi review pass has not seen it).
 */

const WEEKDAY = ['रविवार', 'सोमवार', 'मंगळवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
const WEEKDAY_SHORT = ['रवि', 'सोम', 'मंगळ', 'बुध', 'गुरु', 'शुक्र', 'शनि'];
const MONTH = ['जाने', 'फेब्रु', 'मार्च', 'एप्रिल', 'मे', 'जून', 'जुलै', 'ऑग', 'सप्टें', 'ऑक्टो', 'नोव्हें', 'डिसें'];
const MONTH_LONG = ['जानेवारी', 'फेब्रुवारी', 'मार्च', 'एप्रिल', 'मे', 'जून', 'जुलै', 'ऑगस्ट', 'सप्टेंबर', 'ऑक्टोबर', 'नोव्हेंबर', 'डिसेंबर'];

const DAY_MS = 86_400_000;

/** The same calendar day, at local noon. */
export const atNoon = (d: Date): Date => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; };
export const addDays = (d: Date, n: number): Date => { const x = atNoon(d); x.setDate(x.getDate() + n); return x; };
export const sameDay = (a: Date, b: Date): boolean => atNoon(a).getTime() === atNoon(b).getTime();
/** Whole days from `today` (0 = today, -1 = yesterday, +1 = tomorrow). */
export const offsetOf = (d: Date, today: Date = new Date()): number =>
    Math.round((atNoon(d).getTime() - atNoon(today).getTime()) / DAY_MS);
/** `YYYY-MM-DD` (a log's `date`, a task's `dueDate`) as a local-noon Date. */
export const fromDateKey = (key: string): Date => {
    const [y, m, d] = key.slice(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
};

export const weekdayOf = (d: Date): string => WEEKDAY[d.getDay()];
export const weekdayShortOf = (d: Date): string => WEEKDAY_SHORT[d.getDay()];
export const WEEKDAY_SHORT_LIST: readonly string[] = WEEKDAY_SHORT;
/** `25 ऑक्टो` */
export const dateLabel = (d: Date): string => `${d.getDate()} ${MONTH[d.getMonth()]}`;
/** `ऑक्टोबर 2026` */
export const monthLabel = (d: Date): string => `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;

/** आज / काल / परवा / उद्या, else the weekday and the date. */
export const relLabel = (d: Date, today: Date = new Date()): string => {
    const o = offsetOf(d, today);
    if (o === 0) return 'आज';
    if (o === -1) return 'काल';
    if (o === -2) return 'परवा';
    if (o === 1) return 'उद्या';
    return `${weekdayOf(d)}, ${dateLabel(d)}`;
};

/** The seven days (Sunday first, as the calendar has always drawn them) of the week holding `d`. */
export const weekOf = (d: Date): Date[] => {
    const start = addDays(d, -atNoon(d).getDay());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};

/** The month grid holding `d`: blanks before the 1st so the 1st sits under its weekday. */
export const monthGridOf = (d: Date): (Date | null)[] => {
    const first = new Date(d.getFullYear(), d.getMonth(), 1, 12);
    const n = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
    return [
        ...Array<null>(first.getDay()).fill(null),
        ...Array.from({ length: n }, (_, i) => new Date(d.getFullYear(), d.getMonth(), i + 1, 12)),
    ];
};

/** `₹ 1,250` — Indian grouping. Only ever called with a number that was recorded. */
export const rupees = (n: number): string => `₹ ${Math.round(n).toLocaleString('en-IN')}`;
