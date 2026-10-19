/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE ONE CHECK BETWEEN THE STORED DIARY AND THE `history` EVERY SCREEN READS.
 *
 * `DailyLog.date` is required by the type, and every reader trusts it. Stored
 * data does not have to agree. APK 1.0.14's voice-attendance बरोबर saved rows
 * with `date: undefined` (fixed at the source in 1.0.15:
 * `toAttendanceSubmission` always dates a new record), and an in-place upgrade
 * keeps them. On 1.0.15 the saved screen's `computePreviousLog` read `.includes`
 * on that missing date and the screen crashed.
 *
 * WHY HERE AND NOT IN EACH READER. Every screen reads the same `history`
 * state, and some twenty readers of `log.date` sit behind it, several with
 * their own private `normalizeDateKey`. Two had already been patched one at a
 * time (`dayState.withUsableDates`, the router's `todayLogs` filter) before the
 * third crashed. Checking once, where stored rows become `history`, makes the
 * type true for every reader downstream, including ones not written yet.
 *
 * WHAT HAPPENS TO SUCH A ROW: it is left out of `history`, and that is all.
 *   - No date is invented for it (P4). A record with no day cannot be put on one.
 *   - It is not deleted. It stays in Dexie exactly as stored.
 *   - It is not re-sent. Nothing here touches the sync queue.
 * One console line says how many rows were left out. It names none of them.
 *
 * spec: 2026-08-25-prod-cutover-waves (release 1.0.16)
 */
import type { DailyLog } from '../../types';

/** 'YYYY-MM-DD', the shape every writer produces (`getDateKey`, the server's `logDate`). */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Can this row be placed on a day? True for a 'YYYY-MM-DD' date, or an ISO
 * date-time whose day part is one (readers take the part before 'T').
 */
export function hasDateKey(log: DailyLog | null | undefined): boolean {
    const date: unknown = log?.date;
    return typeof date === 'string' && DATE_KEY.test(date.split('T')[0]);
}

/** The stored rows that can be placed on a day, in their stored order. See the header. */
export function keepDatedLogs(logs: DailyLog[]): DailyLog[] {
    const dated = logs.filter(log => hasDateKey(log));
    const leftOut = logs.length - dated.length;
    if (leftOut > 0) {
        console.warn(
            `[history] ${leftOut} stored log(s) have no valid date and are not shown. They stay on this device; nothing was deleted or re-sent.`,
        );
    }
    return dated;
}
