/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (twelve-hour-time-display)
 *
 * THE ONE PLACE A TIME OF DAY IS TURNED INTO SOMETHING A PERSON READS.
 *
 * Founder decision (2026-08-16): *"Indian time strictly and use 12 hrs cycle
 * properly AM and PM."*
 *
 * WHY A HELPER AND NOT A SWEEP OF CALL SITES
 * ------------------------------------------
 * There were sixteen inline formatters and three partial helpers, none of which
 * knew about the others: `formatDisplayTime` (living, oddly, in `cropEmojis.ts`),
 * `formatLogTime` (`core/navigation/helpers.ts`) and a private `format12h`
 * inside `ElectricityTimingConfigurator`. Editing sixteen call sites guarantees
 * the seventeenth is missed and the eighteenth is written wrong. Everything now
 * routes here, including those three.
 *
 * WHAT WAS ACTUALLY BROKEN — measured, not assumed. Run against this repo's own
 * ICU at 09:05, 14:30, 00:00 and 12:00 IST:
 *
 *   en-IN  { hour:'numeric' }  -> 9:05 am · 2:30 pm · 12:00 am · 12:00 pm
 *   en-GB  { hour:'2-digit' }  -> 09:05 · 14:30 · 00:00 · 12:00     <- 24-HOUR
 *   []     { hour:'2-digit' }  -> whatever the DEVICE is set to
 *   (no args)                  -> device again, plus seconds
 *
 * So three distinct defects: `WeatherWidget` was hard 24-hour via `en-GB`; five
 * surfaces deferred to the device locale and would show 24-hour on any handset
 * configured for it; and the rest were correct only by accident, relying on an
 * `en-IN` default nobody had stated, in lower case (`am`), where the founder
 * asked for `AM`.
 *
 * WHY `formatToParts` RATHER THAN A FORMATTED STRING
 * --------------------------------------------------
 * ICU does the two things that are genuinely hard — the IST conversion and the
 * 24→12 hour mapping, including the midnight/noon cases below — and this module
 * assembles the presentation, so locale punctuation drift (a narrow no-break
 * space before the day period, a trailing dot, lower case) cannot reach a
 * farmer's screen. The output shape is ours and is pinned by test.
 *
 * MIDNIGHT AND NOON are the classic off-by-twelve and both are tested
 * explicitly: 00:15 must read `12:15 AM`, not `0:15 AM`; 12:15 must read
 * `12:15 PM`, not `0:15 PM`.
 *
 * DISPLAY ONLY. Nothing here is persisted, hashed, sent or compared. Stored and
 * transmitted timestamps stay ISO/UTC and untouched — `DateKeyService` remains
 * the authority for date KEYS, and `startTime`/`endTime` config values stay in
 * their stored `HH:mm` form; only their rendering passes through here.
 */

/**
 * Founder: *"Indian time strictly"*. Pinned rather than left to the device, so
 * a handset in another zone shows the farm's clock and not its own. Matches the
 * IST convention `DateKeyService` already enforces for date keys.
 */
export const DISPLAY_TIME_ZONE = 'Asia/Kolkata';

/** en-IN because the product is India-only; the day period is upper-cased below. */
const DISPLAY_LOCALE = 'en-IN';

/** `Intl.DateTimeFormat` construction is expensive; these are hot in lists. */
let timeFormatter: Intl.DateTimeFormat | null = null;
let timeWithSecondsFormatter: Intl.DateTimeFormat | null = null;
let dateTimeFormatter: Intl.DateTimeFormat | null = null;

function getTimeFormatter(): Intl.DateTimeFormat {
    timeFormatter ??= new Intl.DateTimeFormat(DISPLAY_LOCALE, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: DISPLAY_TIME_ZONE,
    });
    return timeFormatter;
}

function getTimeWithSecondsFormatter(): Intl.DateTimeFormat {
    timeWithSecondsFormatter ??= new Intl.DateTimeFormat(DISPLAY_LOCALE, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: DISPLAY_TIME_ZONE,
    });
    return timeWithSecondsFormatter;
}

function getDateTimeFormatter(): Intl.DateTimeFormat {
    dateTimeFormatter ??= new Intl.DateTimeFormat(DISPLAY_LOCALE, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: DISPLAY_TIME_ZONE,
    });
    return dateTimeFormatter;
}

function toDate(input: Date | string | number | null | undefined): Date | null {
    if (input === null || input === undefined || input === '') {
        return null;
    }
    const date = input instanceof Date ? input : new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
}

function partsOf(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of formatter.formatToParts(date)) {
        out[part.type] = part.value;
    }
    return out;
}

/**
 * `h:mm AM`. The single clock the farmer sees.
 *
 * @param fallback what to render when the input is absent or unparseable.
 *        Defaults to empty so a missing timestamp renders nothing rather than a
 *        made-up time; call sites that already showed a placeholder pass theirs.
 */
export function formatDisplayTime(
    input: Date | string | number | null | undefined,
    fallback = '',
): string {
    const date = toDate(input);
    if (!date) return fallback;

    const p = partsOf(getTimeFormatter(), date);
    if (!p.hour || !p.minute) return fallback;

    // `dayPeriod` is present whenever `hour12` is on; the guard is for an ICU
    // build that omits it rather than for normal operation.
    const period = p.dayPeriod ? ` ${p.dayPeriod.toUpperCase()}` : '';
    return `${p.hour}:${p.minute}${period}`;
}

/** `h:mm:ss AM` — for the one admin surface that shows seconds. */
export function formatDisplayTimeWithSeconds(
    input: Date | string | number | null | undefined,
    fallback = '',
): string {
    const date = toDate(input);
    if (!date) return fallback;

    const p = partsOf(getTimeWithSecondsFormatter(), date);
    if (!p.hour || !p.minute || !p.second) return fallback;

    const period = p.dayPeriod ? ` ${p.dayPeriod.toUpperCase()}` : '';
    return `${p.hour}:${p.minute}:${p.second}${period}`;
}

/**
 * `16 Aug, h:mm AM` — where a surface shows a date AND a time together.
 *
 * The DATE half is deliberately left in the shape those call sites already
 * used (`day: 'numeric', month: 'short'`). This task changes clocks, not dates.
 */
export function formatDisplayDateTime(
    input: Date | string | number | null | undefined,
    fallback = '',
): string {
    const date = toDate(input);
    if (!date) return fallback;

    const p = partsOf(getDateTimeFormatter(), date);
    if (!p.hour || !p.minute || !p.day || !p.month) return fallback;

    const period = p.dayPeriod ? ` ${p.dayPeriod.toUpperCase()}` : '';
    return `${p.day} ${p.month}, ${p.hour}:${p.minute}${period}`;
}

/**
 * Render a stored `HH:mm` wall-clock config value as `h:mm AM`.
 *
 * Separate from the others because the input is NOT an instant — it is a
 * wall-clock string the farmer set (electricity window start/end), with no date
 * and no timezone. Converting it through a `Date` would silently apply an offset
 * to a value that never had one, which is the sort of quiet shift this whole
 * task exists to remove. The stored string is unchanged; only its rendering
 * passes through here.
 *
 * Returns the input verbatim when it is not `HH:mm`, so a malformed config
 * value is shown as-is rather than replaced with an invented time.
 */
export function formatDisplayTimeFromHHmm(value: string, fallback?: string): string {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
    if (!match) return fallback ?? value;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return fallback ?? value;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback ?? value;

    // Midnight and noon, explicitly: 0 -> 12 AM, 12 -> 12 PM.
    const period = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}
