/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-60 and rule TAP-1) — a freshly built log put on
 * the day he chose ("त्या दिवसाचं काम सांगा", or the day chip on "तपासा आणि जतन करा").
 *
 * Only the DAY moves: the log's own `date` — the field `create_daily_log` sends as `logDate`, the server's own date for
 * the record — and the notes that were filed under the log's day. The time it was recorded (`meta.createdAtISO`) stays
 * the moment he spoke: no time is invented for the day he chose (doctrine P4).
 */
import type { DailyLog } from '../../types';
import { assertNotAfterFarmToday } from '../../core/domain/services/farmDay';

/**
 * Lane OF fix pass 1 (H1): a day after the farm's today (or a key that is not a day) is REFUSED — it throws
 * `FutureDayRefused`; it is never quietly put on another day. The callers (the voice save) write nothing then.
 */
export function onDay(log: DailyLog, dateKey: string): DailyLog {
    assertNotAfterFarmToday(dateKey);
    if (log.date === dateKey) return log;
    const was = log.date;
    return {
        ...log,
        date: dateKey,
        ...(log.observations && {
            observations: log.observations.map(o => (o.dateKey === was ? { ...o, dateKey } : o)),
        }),
    };
}
