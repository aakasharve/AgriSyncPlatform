/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M, F88) — THE day a money entry sits on, as a `yyyy-MM-dd`
 * key. It used to be "whatever is in front of the `T`", which for an instant (`…Z`) is its UTC date: money saved between
 * 00:00 and 05:30 India time landed on the day before. Now:
 *   - a plain day (`2026-11-01`) is that day;
 *   - an instant with its zone (`2026-10-31T19:30:00.000Z`, `…+05:30`) is the farm's day, India time (`DateKeyService`);
 *   - a day with a local time and no zone (`2026-11-01T12:00:00`, the way a record's own day is written) is its own day;
 *   - nothing is today, India time.
 * The ONE copy, read by the queue (`financeCommandService`), the money book's day filters (`financeSelectors`) and the
 * phone's copy of the server's ledger (`financeService`).
 */
import { getDateKey } from '../../core/domain/services/DateKeyService';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ZONED = /T.*(?:Z|[+-]\d{2}:?\d{2})$/i;

export function moneyDayKey(value?: string): string {
    if (!value) return getDateKey();
    if (DAY.test(value)) return value;
    if (ZONED.test(value)) return getDateKey(value);
    return value.split('T')[0];
}
