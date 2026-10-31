/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF fix pass 1, H1) — THE one rule for the day a record may be
 * put on: today or an earlier day, never a later one ("no future work"). The day is the farm's day (India time,
 * `DateKeyService.getDateKey`), compared as `yyyy-MM-dd` keys. Every write path that takes a chosen day asks this — the
 * voice save, the offline queue and "तपासा आणि जतन करा" — so no screen can get round it. (The server's own guard comes in
 * lane OF-S.)
 */
import { getDateKey } from './DateKeyService';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Is this a well-formed day key (`yyyy-MM-dd`)? */
export const isDayKey = (key: string | null | undefined): key is string => typeof key === 'string' && DAY_KEY.test(key);

/** Is this day AFTER the farm's today? (A malformed key is never a day a record may go on: it counts as after.) */
export function isAfterFarmToday(dayKey: string, todayKey: string = getDateKey()): boolean {
    if (!isDayKey(dayKey)) return true;
    return dayKey > todayKey;
}

/** Is this day BEFORE the farm's today (a past day that may be filled)? */
export function isBeforeFarmToday(dayKey: string, todayKey: string = getDateKey()): boolean {
    return isDayKey(dayKey) && dayKey < todayKey;
}

/** A chosen day a record may NOT go on: refused plainly, never quietly moved to another day. */
export class FutureDayRefused extends Error {
    constructor(dayKey: string) {
        super(`A record cannot be put on ${dayKey}: it is after the farm's today.`);
        this.name = 'FutureDayRefused';
    }
}

/** Throws `FutureDayRefused` for a day after today (or a malformed key). */
export function assertNotAfterFarmToday(dayKey: string, todayKey: string = getDateKey()): void {
    if (isAfterFarmToday(dayKey, todayKey)) throw new FutureDayRefused(dayKey);
}
