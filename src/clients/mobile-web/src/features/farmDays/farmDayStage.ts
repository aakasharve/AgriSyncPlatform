/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2 (the day-3 / 7 / 14 / 18 cards on Home; CTO rulings
 * of 27 Nov). Which day of its life the open farm is on, and which card stage that day belongs to. Pure: no React, no storage.
 *
 * The day comes ONLY from data the phone really holds about this farm: its creation date as the server sent it in the pull
 * (`FarmDto.createdAtUtc`, kept in the phone's farms table). Anything that is not a real date gives no day, and no day gives no
 * card (never a guess, P4). Day 0 is the farm's first day, in the farm's own day (India time, `getDateKey`).
 *
 * Each stage owns the days up to the next one, so a phone that comes back after a gap sees only the card of the CURRENT stage,
 * never a backlog. From day 21 there is no card: in the pilot nothing stops and no price or plan is shown (founder, 27 Nov).
 */
import { getDateKey } from '../../core/domain/services/DateKeyService';

export type FarmDayStage = 'd3' | 'd7' | 'd14' | 'd18';

export const FARM_DAY_STAGES: readonly { stage: FarmDayStage; from: number; until: number }[] = [
    { stage: 'd3', from: 3, until: 7 },
    { stage: 'd7', from: 7, until: 14 },
    { stage: 'd14', from: 14, until: 18 },
    { stage: 'd18', from: 18, until: 21 },
];

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
/** A .NET default DateTime (year 1) or anything before the product existed is not a farm's creation date. */
const EARLIEST_REAL_YEAR = 2020;
const DAY_MS = 86_400_000;

/** The farm's first day (`YYYY-MM-DD`, India time) from the server's creation time; `null` when it is not a real date. */
export function farmStartKey(createdAtUtc: unknown): string | null {
    if (typeof createdAtUtc !== 'string') return null;
    const raw = createdAtUtc.trim();
    if (!ISO_TIME.test(raw)) return null;
    // The field is named Utc: a time sent with no zone is UTC, never the phone's local time.
    const ms = Date.parse(HAS_ZONE.test(raw) ? raw : `${raw}Z`);
    if (!Number.isFinite(ms)) return null;
    const when = new Date(ms);
    if (when.getUTCFullYear() < EARLIEST_REAL_YEAR) return null;
    return getDateKey(when);
}

const keyMs = (key: string): number => {
    const [y, m, d] = key.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
};

/** Whole days from `fromKey` to `toKey` (both `YYYY-MM-DD`). */
export function daysBetween(fromKey: string, toKey: string): number {
    return Math.round((keyMs(toKey) - keyMs(fromKey)) / DAY_MS);
}

/** The key `n` days after `key`. */
export function addDaysToKey(key: string, n: number): string {
    const d = new Date(keyMs(key) + n * DAY_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The farm's day today (0 = its first day); `null` with no first day, or one after today. */
export function farmDayOf(startKey: string | null, todayKey: string): number | null {
    if (!startKey) return null;
    const day = daysBetween(startKey, todayKey);
    return day >= 0 ? day : null;
}

/** The stage of that day, or `null` (before day 3, from day 21, or no day). */
export function currentStage(day: number | null): FarmDayStage | null {
    if (day === null) return null;
    return FARM_DAY_STAGES.find(s => day >= s.from && day < s.until)?.stage ?? null;
}
