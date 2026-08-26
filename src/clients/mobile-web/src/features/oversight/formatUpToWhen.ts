/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * TURNS `lastSyncAt` INTO THE `{when}` A FARMER READS — OR INTO NOTHING.
 *
 * Founder decision 2026-08-26: the oversight bar carries one line saying how
 * recent the work on screen is ("up to date till, let's say, 12am Tuesday").
 * The fact itself already exists — `syncCursors.lastSyncAt`, read by
 * `features/sync/hooks/useSyncQueueStatus.ts` and already rendered as "Last
 * synced:" inside `SyncStatusDrawer.tsx`. This module invents no timestamp
 * and performs no fetch; it only formats the one this app already has.
 *
 * IT RETURNS `null` RATHER THAN GUESSING. Doctrine `P4`. There are three
 * ways in and only one way to a rendered string:
 *
 *   `null` input        -> `null`. The device has never completed a pull, or
 *                          the first Dexie read has not landed yet
 *                          (`EMPTY_STATUS.lastSyncAt`). Both are "we cannot
 *                          state an up-to time", and the caller says so out
 *                          loud with `showingWorkUpToUnknown`.
 *   unparseable input   -> `null`. NOT the device clock, NOT "now". This
 *                          guard is load-bearing rather than defensive:
 *                          `DateKeyService.getDateKey()` deliberately
 *                          FALLS BACK TO THE CURRENT TIME on an invalid
 *                          date, so handing it a malformed cursor value
 *                          would silently print today's date as the app's
 *                          freshness. Every input is validated here, before
 *                          that function can be reached.
 *   valid instant       -> `'काल दुपारी 12:00'` / `'Yesterday 12:00 PM'`.
 *
 * NO NEW CLOCK AND NO NEW CALENDAR. The time comes from
 * `shared/utils/displayTime.ts` — `formatFarmerTime` for Marathi (the
 * founder-directed natural-language form, `दुपारी 12:00`) and
 * `formatDisplayTime` for English (`12:00 PM`). The day comes from
 * `core/domain/services/DateKeyService.ts`, whose date keys are IST-pinned,
 * which is the same clock the rest of the farm's day boundaries use. Adding
 * a second formatter here would put a fourth clock in an app that spent a
 * whole task collapsing sixteen into one.
 *
 * WHY `आज`/`काल` AND THEN A DATE, RATHER THAN A WEEKDAY. The founder's own
 * example was a weekday ("12am Tuesday"), but NO Marathi weekday name exists
 * anywhere under `src/clients/` — rendering one would mean inventing seven
 * farmer-facing Marathi words, which the Hard Rule forbids outright. `आज` and
 * `काल` DO ship (`translations.ts` mr `logPage.today` / `logPage.yesterday`)
 * and cover the case a farmer actually meets, since a device that syncs at
 * all syncs within a day. Anything older falls back to
 * `formatDateKeyForDisplay`'s `16 Aug` — Latin script inside a Marathi
 * sentence, which the founder's own approved copy already does
 * (`approvalAvailabilityTranslations.mr.approvalUnavailableTitle` is
 * 'approval आजून उपलब्ध नाहीये').
 */
import {
    formatDateKeyForDisplay,
    getDateKey,
} from '../../core/domain/services/DateKeyService';
import type { Language } from '../../i18n/language';
import { resolveDataFreshnessString } from '../../i18n/dataFreshnessTranslations';
import { formatDisplayTime, formatFarmerTime } from '../../shared/utils/displayTime';

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * THE SHAPE THE APP ACTUALLY WRITES, and the only shape accepted here.
 *
 * `infrastructure/sync/MutationQueue.ts:477` stamps the cursor with
 * `systemClock.nowISO()` — a zone-bearing ISO-8601 instant. Anything else in
 * that column is corrupt, not a sync that happened.
 *
 * WHY A REGEX AND NOT JUST `new Date(...)`. `new Date` is far more permissive
 * than it looks and the difference is a fabrication, not a nicety: this guard
 * was added because `formatUpToWhen('0000', 'mr', …)` returned
 * `'0-01-01 पहाटे 5:53'` — a four-character string became a rendered date and
 * a rendered clock, on the one line whose entire job is to say how current
 * the screen is. Caught by `__tests__/formatUpToWhen.test.ts`, not by review.
 *
 * A ZONE IS REQUIRED (`Z` or `±HH:mm`). A zone-less literal is a wall clock
 * with no instant behind it (`displayTime.ts`'s `parseZoneless` exists for
 * exactly that distinction), and a freshness line has to be an instant.
 */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The day half of `{when}`: `आज` / `काल` when the instant falls on today's or
 * yesterday's IST date key, otherwise the date itself (`16 Aug`).
 *
 * Compared as DATE KEYS, never as elapsed hours: "yesterday" is a calendar
 * word to a farmer, so 23:55 last night is काल and 00:05 this morning is आज,
 * which an hours-based test would get backwards for both.
 */
function dayLabel(instant: Date, now: Date, language: Language): string {
    const key = getDateKey(instant);
    if (key === getDateKey(now)) {
        return resolveDataFreshnessString(language, 'dayToday');
    }
    if (key === getDateKey(new Date(now.getTime() - MILLIS_PER_DAY))) {
        return resolveDataFreshnessString(language, 'dayYesterday');
    }
    // Deliberately no year: the chip is about recency, and a year on a
    // freshness line reads as an archive date. `day`/`month` only — the same
    // shape `formatDisplayDateTime` uses for a date beside a time.
    return formatDateKeyForDisplay(key, { day: 'numeric', month: 'short' });
}

/**
 * `'काल दुपारी 12:00'` / `'Yesterday 12:00 PM'`, or `null` when no up-to
 * instant can be stated. Never throws, never invents a time.
 *
 * @param lastSyncAtISO the cursor value, exactly as `useSyncQueueStatus`
 *        reports it — including `null`.
 * @param now injected so a test can pin the day boundary without touching
 *        global time; production always passes the real clock by omission.
 */
export function formatUpToWhen(
    lastSyncAtISO: string | null | undefined,
    language: Language,
    now: Date = new Date(),
): string | null {
    if (!lastSyncAtISO) {
        return null;
    }

    const parts = ISO_INSTANT.exec(lastSyncAtISO);
    if (!parts) {
        return null;
    }

    // SHAPE IS NOT VALUE, AND THE COMPONENTS ROLL OVER SILENTLY — the exact
    // lesson `displayTime.ts`'s review B002 records, re-learned here by test:
    // `2026-02-30T10:00:00Z` has a perfect ISO shape, and V8 rolls it forward
    // to 2 March, so the chip would have told the farmer his screen was
    // current to a day that never existed. Parse AND verify: every component
    // must survive the round trip unchanged. Anything that rolled over is not
    // an instant this app was given.
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const hour = Number(parts[4]);
    const minute = Number(parts[5]);
    const second = Number(parts[6] ?? '0');
    const roundTrip = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (
        roundTrip.getUTCFullYear() !== year
        || roundTrip.getUTCMonth() !== month - 1
        || roundTrip.getUTCDate() !== day
        || roundTrip.getUTCHours() !== hour
        || roundTrip.getUTCMinutes() !== minute
        || roundTrip.getUTCSeconds() !== second
    ) {
        return null;
    }

    // The real instant, offset applied by the platform. The epoch floor
    // rejects a well-shaped but impossible cursor: a timestamp before the
    // representation's own zero is corrupt data, not a sync that happened,
    // and this line may not report corrupt data as a freshness fact.
    const instant = new Date(lastSyncAtISO);
    if (Number.isNaN(instant.getTime()) || instant.getTime() < 0) {
        return null;
    }

    // Empty fallback by default in both formatters, so an ICU build that
    // omits a part yields `''` here rather than a half-built time — and a
    // half-built time is exactly what must not reach the farmer.
    const time = language === 'mr' ? formatFarmerTime(instant) : formatDisplayTime(instant);
    if (time === '') {
        return null;
    }

    return `${dayLabel(instant, now, language)} ${time}`;
}
