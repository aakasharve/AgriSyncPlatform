/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-1 A9) — WHICH DAY a manual हजेरी is for.
 *
 * The manual हजेरी घ्या screen could only ever mark TODAY (`LabourFeature.tsx` sent
 * `getDateKey()` as every mark's `workDate`), so a farmer who did not take हजेरी yesterday
 * had no way to put it in. The server takes any `workDate`; the phone now offers today and
 * the six days before it — never a future day — but only where it is safe.
 *
 * WHY "ONLY WHERE IT IS SAFE". The screen pre-fills what the register already holds for the
 * chosen day and will not let it be un-said. A day whose marks are NOT on screen looks empty;
 * a mark tapped there is not refused by the server — it silently AMENDS the stored fact
 * (`RecordAttendanceMarkHandler.cs`, `AttendanceMark.Amend`), and nobody is asked. So past
 * days are offered only when the open register is known to show every mark of every recent day:
 *   - the SERVER's current answer (not a cached read-out from an outage, not the phone-only
 *     register): an old copy is missing whatever synced since;
 *   - the OWNER's view: a crew view shows one crew and the own-row view shows nobody's rows
 *     (`GetLabourDataHandler.cs` ApplyRegisterView), while the roster lists everyone;
 *   - आजपर्यंत: the server then draws every date carrying a fact, so a recent day missing
 *     from it truly holds none. A narrower window can end before the day, and the phone lays
 *     its own queued marks over it outside the window (`attendanceOverlay.ts`).
 * Anything else: today only, exactly as before.
 *
 * Date keys are farm-local `yyyy-MM-dd` strings (`DateKeyService`); the arithmetic below is
 * done on those keys in UTC so no device time zone can shift a day.
 */
import { MARATHI_MONTHS, MARATHI_MONTHS_FULL, parseIsoDate, toMarathiDigits } from './marathiDate';
import type { LabourWindow } from './labourWindow';

/** Today and the six days before it. */
export const RECENT_ATTENDANCE_DAYS = 7;

/** What the open register is, as far as choosing a past day is concerned. */
export interface RegisterOnScreen {
    window: LabourWindow;
    view: 'owner' | 'crew' | 'own';
    /** The server's current answer — no failed fetch, no cached read-out. */
    fresh: boolean;
}

const keyToUtc = (key: string): number => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
};

const utcToKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Today first, then each day before it. */
export function recentWorkDates(todayKey: string, count = RECENT_ATTENDANCE_DAYS): string[] {
    const today = keyToUtc(todayKey);
    return Array.from({ length: count }, (_, back) => utcToKey(today - back * 86_400_000));
}

/** The days the farmer may take हजेरी for on this screen (see the header). */
export function choosableWorkDates(todayKey: string, register: RegisterOnScreen | undefined): string[] {
    const showsEveryMark = register !== undefined
        && register.fresh && register.view === 'owner' && register.window === 'alltime';
    return showsEveryMark ? recentWorkDates(todayKey) : [todayKey];
}

const daysBefore = (key: string, todayKey: string): number =>
    Math.round((keyToUtc(todayKey) - keyToUtc(key)) / 86_400_000);

/** The day as a chip says it: आज · काल · २३ ऑक्टो (the register's own digits and months). */
export function workDateChipLabel(key: string, todayKey: string): string {
    const back = daysBefore(key, todayKey);
    if (back === 0) return 'आज';
    if (back === 1) return 'काल';
    const date = parseIsoDate(key);
    return date ? `${toMarathiDigits(date.getDate())} ${MARATHI_MONTHS[date.getMonth()]}` : key;
}

/** The screen's title for that day: आजची हजेरी (unchanged) · कालची हजेरी · २३ ऑक्टोबरची हजेरी. */
export function attendanceTitleFor(key: string, todayKey: string): string {
    const back = daysBefore(key, todayKey);
    if (back === 0) return 'आजची हजेरी';
    if (back === 1) return 'कालची हजेरी';
    const date = parseIsoDate(key);
    return date ? `${toMarathiDigits(date.getDate())} ${MARATHI_MONTHS_FULL[date.getMonth()]}ची हजेरी` : 'हजेरी';
}
