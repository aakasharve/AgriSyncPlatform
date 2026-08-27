/**
 * dueDateResolver — turn a free-text due-date hint into a concrete date key.
 *
 * WHY THIS EXISTS (Daily Clarity Loop v1, DFES companion):
 * Voice parse extracts a spoken plan ("उद्या फवारायचं आहे") as a PlannedTask
 * carrying a free-text `dueHint` ('उद्या'). Downstream day-state math
 * (`shared/utils/dayState.ts`) drops any task with no concrete `dueDate`
 * (`if (!task.dueDate) return false`), so spoken tasks silently vanished from
 * every pending/overdue count. This resolver gives those tasks a real
 * `YYYY-MM-DD` so they carry forward — the spine of the loop.
 *
 * FOUNDER DECISION — CLEAR-ONLY:
 * Only UNAMBIGUOUS temporal cues resolve to a date. Vague hints
 * (नंतर / लवकर / या आठवड्यात / कधीतरी), and absent/empty hints, return `null`
 * so they never clutter tomorrow's line with dates the farmer never committed
 * to. A `null` dueDate is the intended "no scheduled day yet" state.
 *
 * PURITY / DATE-MATH APPROACH:
 * Pure and deterministic — NO `Date.now()`. The caller passes `todayLocalISO`
 * (the factory's IST "today", derived from its own clock via `getDateKey`).
 * Day arithmetic mirrors `DateKeyService`'s approach but is done in UTC-space
 * (`Date.UTC` normalises day overflow), so it is timezone-agnostic and rolls
 * over month and year boundaries correctly without importing a clock.
 */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Devanagari digits (०-९, U+0966–U+096F) → ASCII digits. */
const toLatinDigits = (s: string): string =>
    s.replace(/[०-९]/g, (ch) => String(ch.charCodeAt(0) - 0x0966));

/** Weekday markers, `dow` matching JS getUTCDay (0=Sunday … 6=Saturday). */
const WEEKDAYS: ReadonlyArray<{ dow: number; markers: readonly string[] }> = [
    { dow: 0, markers: ['रविवार', 'sunday'] },
    { dow: 1, markers: ['सोमवार', 'monday'] },
    { dow: 2, markers: ['मंगळवार', 'tuesday'] },
    { dow: 3, markers: ['बुधवार', 'wednesday'] },
    { dow: 4, markers: ['गुरुवार', 'thursday'] },
    { dow: 5, markers: ['शुक्रवार', 'friday'] },
    { dow: 6, markers: ['शनिवार', 'saturday'] },
];

/** Add `n` days to a YYYY-MM-DD key, rolling over month/year via UTC math. */
const addDays = (todayLocalISO: string, n: number): string => {
    const [y, m, d] = todayLocalISO.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

/** Day-of-week (0=Sun … 6=Sat) for a YYYY-MM-DD key. */
const dayOfWeek = (todayLocalISO: string): number => {
    const [y, m, d] = todayLocalISO.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/**
 * Resolve a spoken/typed due-date hint to a concrete `YYYY-MM-DD`, or `null`.
 *
 * @param dueHint       Free-text temporal cue (e.g. 'उद्या', '३ दिवसांनी',
 *                      'Friday'). `undefined`/empty → `null`.
 * @param todayLocalISO The reference "today" as a `YYYY-MM-DD` key. Malformed
 *                      input → `null` (defensive; never throws).
 * @returns A concrete date key for CLEAR hints, else `null`.
 */
export function resolveDueDate(
    dueHint: string | undefined,
    todayLocalISO: string
): string | null {
    if (!dueHint) return null;
    if (!DATE_KEY_RE.test(todayLocalISO)) return null;

    const hint = dueHint.trim().toLowerCase();
    if (!hint) return null;

    // 1) Explicit day count: "N दिवसांनी" / "N days" / "in N days".
    const nDays = toLatinDigits(hint).match(/(\d+)\s*(?:दिवस|day)/);
    if (nDays) {
        const n = Number.parseInt(nDays[1], 10);
        if (Number.isFinite(n) && n >= 0) return addDays(todayLocalISO, n);
    }

    // 2) परवा (day after tomorrow) — checked before उद्या; distinct tokens.
    if (hint.includes('परवा')) return addDays(todayLocalISO, 2);

    // 3) उद्या / tomorrow.
    if (hint.includes('उद्या') || hint.includes('tomorrow')) {
        return addDays(todayLocalISO, 1);
    }

    // 4) आज / today.
    if (hint.includes('आज') || hint.includes('today')) {
        return addDays(todayLocalISO, 0);
    }

    // 5) Named weekday → next occurrence (strictly future; same day → +7,
    //    since a farmer wanting today would say आज).
    const todayDow = dayOfWeek(todayLocalISO);
    for (const wd of WEEKDAYS) {
        if (wd.markers.some((marker) => hint.includes(marker))) {
            const delta = ((wd.dow - todayDow + 7) % 7) || 7;
            return addDays(todayLocalISO, delta);
        }
    }

    // Vague / unrecognised (नंतर, लवकर, या आठवड्यात, कधीतरी, …) → no date.
    return null;
}
