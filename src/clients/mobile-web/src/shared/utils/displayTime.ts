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

/**
 * `Intl.DateTimeFormat` construction is expensive and these are hot in lists,
 * so each shape is cached twice: once pinned to IST for real instants, and once
 * to UTC for zone-less wall-clock literals (see `parseZoneless`). The UTC twin
 * is not a timezone choice — it is how the digits are passed through unchanged.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions, wallClock: boolean): Intl.DateTimeFormat {
    const cacheKey = `${key}:${wallClock ? 'wall' : 'ist'}`;
    let cached = formatterCache.get(cacheKey);
    if (!cached) {
        cached = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
            ...options,
            timeZone: wallClock ? 'UTC' : DISPLAY_TIME_ZONE,
        });
        formatterCache.set(cacheKey, cached);
    }
    return cached;
}

const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
const TIME_SECONDS_OPTS: Intl.DateTimeFormatOptions = { ...TIME_OPTS, second: '2-digit' };
const DATE_TIME_OPTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', ...TIME_OPTS };
const TIMESTAMP_OPTS: Intl.DateTimeFormatOptions = {
    day: 'numeric', month: 'short', year: 'numeric', ...TIME_SECONDS_OPTS,
};

/**
 * An ISO-ish local timestamp carrying NO zone: `2026-08-16T12:00:00`, no `Z`
 * and no `+05:30`.
 */
const ZONELESS_ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/**
 * REVIEW M-1 — A STRING WITH NO ZONE HAS NO OFFSET TO APPLY.
 *
 * `log-factory-helpers.ts:288` synthesises `createdAtISO: \`${log.date}T12:00:00\``
 * as a deliberate midday placeholder, and `transcriptTimelineService.ts:86`
 * uses the same fallback. Before this task both halves were device-local — the
 * string parsed device-local and rendered device-local — so the round trip
 * cancelled and it always read `12:00 pm`. Pinning only the RENDER to IST broke
 * that: on a UTC handset the placeholder started reading `5:30 PM`.
 *
 * That is the identical hazard I named for `formatDisplayTimeFromHHmm` and then
 * failed to check for on this input. A zone-less literal is a wall clock, so it
 * is rendered as one: parsed as UTC and formatted in UTC, which passes the
 * digits through untouched. Anything carrying `Z` or an offset is a real
 * instant and is converted to IST as normal.
 */
function parseZoneless(value: string): Date | null {
    const m = ZONELESS_ISO.exec(value.trim());
    if (!m) return null;
    const [, y, mo, d, hh, mm, ss] = m;
    const date = new Date(Date.UTC(
        Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? '0'),
    ));
    return Number.isNaN(date.getTime()) ? null : date;
}

interface Resolved {
    date: Date;
    /** True when the input carried no zone, so it must be rendered as written. */
    wallClock: boolean;
}

function toDate(input: Date | string | number | null | undefined): Resolved | null {
    if (input === null || input === undefined || input === '') {
        return null;
    }
    if (typeof input === 'string') {
        const wall = parseZoneless(input);
        if (wall) return { date: wall, wallClock: true };
    }
    const date = input instanceof Date ? input : new Date(input);
    return Number.isNaN(date.getTime()) ? null : { date, wallClock: false };
}

function partsOf(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of formatter.formatToParts(date)) {
        out[part.type] = part.value;
    }
    return out;
}

/**
 * `h:mm AM`. Every time-of-day the farmer sees goes through here — enforced by
 * `__tests__/displayTime.sweep.test.ts` rather than asserted.
 *
 * @param fallback what to render when the input is absent or unparseable.
 *        Defaults to empty so a missing timestamp renders nothing rather than a
 *        made-up time; call sites that already showed a placeholder pass theirs.
 */
export function formatDisplayTime(
    input: Date | string | number | null | undefined,
    fallback = '',
): string {
    const r = toDate(input);
    if (!r) return fallback;

    const p = partsOf(formatter('time', TIME_OPTS, r.wallClock), r.date);
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
    const r = toDate(input);
    if (!r) return fallback;

    const p = partsOf(formatter('timeSeconds', TIME_SECONDS_OPTS, r.wallClock), r.date);
    if (!p.hour || !p.minute || !p.second) return fallback;

    const period = p.dayPeriod ? ` ${p.dayPeriod.toUpperCase()}` : '';
    return `${p.hour}:${p.minute}:${p.second}${period}`;
}

/**
 * `16 Aug, h:mm AM` — where a surface shows a date AND a time together.
 *
 * The DATE half is deliberately left in the shape those call sites already
 * used (`day: 'numeric', month: 'short'`). This task changes clocks, not dates.
 *
 * ONLY for sites that already showed day+month and no year. Sites that rendered
 * a bare `toLocaleString()` carried a year and seconds; sending them here drops
 * both, which is why `formatDisplayTimestamp` exists (review M-2).
 */
export function formatDisplayDateTime(
    input: Date | string | number | null | undefined,
    fallback = '',
): string {
    const r = toDate(input);
    if (!r) return fallback;

    const p = partsOf(formatter('dateTime', DATE_TIME_OPTS, r.wallClock), r.date);
    if (!p.hour || !p.minute || !p.day || !p.month) return fallback;

    const period = p.dayPeriod ? ` ${p.dayPeriod.toUpperCase()}` : '';
    return `${p.day} ${p.month}, ${p.hour}:${p.minute}${period}`;
}

/**
 * `16 Aug 2026, 2:30:07 PM` — for the surfaces that previously rendered a bare
 * `toLocaleString()`.
 *
 * REVIEW M-2 — THE YEAR AND THE SECONDS ARE HERE ON PURPOSE. Routing those
 * sites through `formatDisplayDateTime` silently dropped both, and in a
 * recent-failures table a stale row then looks like a current one. A bare
 * `toLocaleString()` had no stable style to preserve — it rendered in whatever
 * the device was set to — so what is preserved is the INFORMATION it carried,
 * not a shape it never reliably had.
 */
export function formatDisplayTimestamp(
    input: Date | string | number | null | undefined,
    fallback = '',
): string {
    const r = toDate(input);
    if (!r) return fallback;

    const p = partsOf(formatter('timestamp', TIMESTAMP_OPTS, r.wallClock), r.date);
    if (!p.hour || !p.minute || !p.second || !p.day || !p.month || !p.year) return fallback;

    const period = p.dayPeriod ? ` ${p.dayPeriod.toUpperCase()}` : '';
    return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}:${p.second}${period}`;
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
