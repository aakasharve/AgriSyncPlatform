/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reviewDetailDate — Decision 4b (2026-07-19, screen honesty) helpers for
 * `ReviewSheet`'s तपासणी queue.
 *
 * `GetLabourDataHandler` sends a bare ISO date (`yyyy-MM-dd`, e.g.
 * "2026-07-19") as `ReviewItem.detail` for real farm data. Rendering that
 * verbatim leaks a raw, English-formatted date onto an otherwise Marathi-only
 * screen. The helpers below detect that ONE specific shape and act on it;
 * anything else (e.g. the mock/preview's "द्राक्ष-२ · आज") passes through
 * untouched — neither function invents content, they only recognise a date
 * that's already there.
 *
 * Task 20 (spec: 2026-08-28-labour-v2-release-1) — `isReviewDetailWithinDays`
 * used to live here too, and `ReviewSheet` used it to drop anything older than
 * 14 days from the तपासणी queue while the तपासा badge went on counting the
 * unbounded server total. The two disagreed on screen and work older than a
 * fortnight became unreachable from every screen in the app. Deleted rather
 * than left unused: a ready-made "hide the old ones" helper sitting in this
 * module is an invitation to reintroduce exactly that. The card's own
 * plot/task context, whose absence this file's header used to note as a
 * tracked gap, now ships on `ReviewItem` (`plot`/`plotScope`/`points`).
 */

import { MARATHI_MONTHS, parseIsoDate, toMarathiDigits } from './marathiDate';

/**
 * Parses `detail` as a `yyyy-MM-dd` date ONLY if it is exactly that shape —
 * never a loose/partial match. The month names and digits this module formats
 * with now come from `marathiDate.ts`, shared with the dashboard window range
 * so two screens cannot spell the same month differently.
 */
export const parseReviewDetailDate = parseIsoDate;

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
