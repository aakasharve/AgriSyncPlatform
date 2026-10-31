/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-57 / D-60 and rule TAP-1) — how a DAY is said on
 * the new day chips and the calendar sheet, one language at a time (Marathi mode: Marathi only; English mode: English
 * only). Day keys are farm-local `yyyy-MM-dd` (`DateKeyService`); the arithmetic is done on them in UTC so no phone time
 * zone can shift a day. Every line is PROPOSED unless it says REUSED.
 */
const MONTH_SHORT_MR = ['जाने', 'फेब्रु', 'मार्च', 'एप्रि', 'मे', 'जून', 'जुलै', 'ऑग', 'सप्टें', 'ऑक्टो', 'नोव्हें', 'डिसें'];
const MONTH_LONG_MR = ['जानेवारी', 'फेब्रुवारी', 'मार्च', 'एप्रिल', 'मे', 'जून', 'जुलै', 'ऑगस्ट', 'सप्टेंबर', 'ऑक्टोबर', 'नोव्हेंबर', 'डिसेंबर'];
const WEEKDAY_MR = ['रवि', 'सोम', 'मंगळ', 'बुध', 'गुरु', 'शुक्र', 'शनि'];
const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Monday first, as the आढावा calendar. */
const HEAD_MR = ['सो', 'मं', 'बु', 'गु', 'शु', 'श', 'र'];
const HEAD_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export const isDayKey = (key: string | null | undefined): key is string => !!key && DAY_KEY.test(key);

/** The key as a UTC instant (noon-free: the arithmetic is whole days). */
export const keyToUtc = (key: string): number => {
    const m = DAY_KEY.exec(key);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
};
export const utcToKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDayKeys = (key: string, n: number): string => utcToKey(keyToUtc(key) + n * DAY_MS);
export const daysBetween = (from: string, to: string): number => Math.round((keyToUtc(to) - keyToUtc(from)) / DAY_MS);

const en = (language: string | null | undefined): boolean => language === 'en';

/** "30 ऑक्टो" / "30 Oct". */
export function dayShort(key: string, language?: string | null): string {
    if (!isDayKey(key)) return key;
    const d = new Date(keyToUtc(key));
    return `${d.getUTCDate()} ${(en(language) ? MONTH_SHORT_EN : MONTH_SHORT_MR)[d.getUTCMonth()]}`;
}

/** "शुक्र, 30 ऑक्टो" / "Fri, 30 Oct". */
export function dayFull(key: string, language?: string | null): string {
    if (!isDayKey(key)) return key;
    const d = new Date(keyToUtc(key));
    return `${(en(language) ? WEEKDAY_EN : WEEKDAY_MR)[d.getUTCDay()]}, ${dayShort(key, language)}`;
}

/** आज · काल · "शुक्र, 30 ऑक्टो" (Today · Yesterday · "Fri, 30 Oct"). */
export function dayRel(key: string, todayKey: string, language?: string | null): string {
    const back = daysBetween(key, todayKey);
    if (back === 0) return en(language) ? 'Today' : 'आज'; // REUSED (Marathi) — the app's own "आज"; PROPOSED (English)
    if (back === 1) return en(language) ? 'Yesterday' : 'काल'; // REUSED (Marathi) — "काल"; PROPOSED (English)
    return dayFull(key, language);
}

/** "ऑक्टोबर 2026" / "October 2026" for a month (`yyyy-MM`). */
export function monthTitle(year: number, month0: number, language?: string | null): string {
    return `${(en(language) ? MONTH_LONG_EN : MONTH_LONG_MR)[month0]} ${year}`;
}

export const weekHeads = (language?: string | null): readonly string[] => (en(language) ? HEAD_EN : HEAD_MR);

/** The month grid (Monday first): `null` before the 1st, then each day's key. */
export function monthCells(year: number, month0: number): (string | null)[] {
    const first = Date.UTC(year, month0, 1);
    const lead = (new Date(first).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
    return [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => utcToKey(first + i * DAY_MS))];
}
