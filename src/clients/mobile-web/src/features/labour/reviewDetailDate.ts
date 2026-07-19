/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reviewDetailDate — Decision 4b (2026-07-19, screen honesty) helpers for
 * `ReviewSheet`'s तपासणी queue.
 *
 * `GetLabourDataHandler` currently sends a bare ISO date (`yyyy-MM-dd`, e.g.
 * "2026-07-19") as `ReviewItem.detail` for real farm data — there is no
 * plot/task context wired into this field yet (a separate, tracked gap).
 * Rendering that verbatim leaks a raw, English-formatted date onto an
 * otherwise Marathi-only screen. Both helpers below detect that ONE specific
 * shape and act on it; anything else (e.g. the mock/preview's
 * "द्राक्ष-२ · आज") passes through untouched — neither function invents
 * content, they only recognise a date that's already there.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MARATHI_MONTHS = [
    'जाने', 'फेब्रु', 'मार्च', 'एप्रिल', 'मे', 'जून',
    'जुलै', 'ऑग', 'सप्टें', 'ऑक्टो', 'नोव्हें', 'डिसें',
];

const toMarathiDigits = (n: number): string => String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[Number(d)]);

/** Parses `detail` as a `yyyy-MM-dd` date ONLY if it is exactly that shape — never a loose/partial match. */
export function parseReviewDetailDate(detail: string): Date | null {
    if (!ISO_DATE_RE.test(detail)) return null;
    const parsed = new Date(`${detail}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const daysBetween = (earlier: Date, later: Date): number => {
    const startOfDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((startOfDay(later) - startOfDay(earlier)) / 86_400_000);
};

/**
 * आज / काल / "१९ जुलै" — mirrors the आज/काल convention already established
 * by `ReviewInboxSheet.tsx`'s `formatDate`, without that helper's English
 * "(Today)"/"(Yesterday)" suffix (this screen is Marathi-only). Non-ISO
 * `detail` strings (mock/preview) are returned unchanged.
 */
export function formatReviewDetail(detail: string, now: Date = new Date()): string {
    const parsed = parseReviewDetailDate(detail);
    if (!parsed) return detail;
    const diff = daysBetween(parsed, now);
    if (diff === 0) return 'आज';
    if (diff === 1) return 'काल';
    return `${toMarathiDigits(parsed.getDate())} ${MARATHI_MONTHS[parsed.getMonth()]}`;
}

/**
 * 14-day bound (Decision 4b) — the तपासणी queue must not grow forever (the
 * dev farm already had 76 unresolved items sitting in it). Only bounds items
 * whose `detail` is a parseable ISO date (today's real-data shape); anything
 * else (mock/preview) is kept, matching `formatReviewDetail`'s pass-through
 * so preview behaviour is unaffected.
 */
export function isReviewDetailWithinDays(detail: string, days: number, now: Date = new Date()): boolean {
    const parsed = parseReviewDetailDate(detail);
    if (!parsed) return true;
    return daysBetween(parsed, now) <= days;
}
