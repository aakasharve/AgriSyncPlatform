/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1) — the meter card's 7 days ("गेले ७ दिवस · भरलेले = बोललेले दिवस"):
 * for each of the last seven farm days (today last), whether a talk was told to Sathi on this farm that day. Worked out on the phone
 * from its OWN log history; no server change.
 *
 * Only real data, and only when it can be trusted (P4):
 *   - a day is filled only when the phone holds a saved, not deleted log of that day that was told to Sathi (by voice, or typed to
 *     Sathi); a log filled in on the form (`provenance.source = 'manual'`) is not a talk, the same rule as "आज कोणी सांगितलं";
 *   - a log the phone KNOWS belongs to another farm never counts (both farms recorded and different; no guess either way);
 *   - an empty dot says "no talk that day", so the row is drawn only once the phone has completed its first pull (the pull is
 *     cursor-based from the beginning, so after it the phone holds every log this person may see: the rule of `monthChip`). Before
 *     that, no row at all — never a guessed gap.
 */
import { useEffect, useState } from 'react';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../types';

const SYNC_SCOPE = 'shramsafal';
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface StreakDay {
    dateKey: string;
    /** 0 = Sunday … 6 = Saturday. */
    weekday: number;
    told: boolean;
    today: boolean;
}

/** The seven date keys ending with `todayKey`, oldest first. Empty for a key that is not "YYYY-MM-DD". Pure. */
export function lastSevenDays(todayKey: string): string[] {
    const m = KEY.exec(todayKey);
    if (!m) return [];
    const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Array.from({ length: 7 }, (_, i) => new Date(end - (6 - i) * DAY_MS).toISOString().slice(0, 10));
}

const weekdayOf = (dateKey: string): number => {
    const m = KEY.exec(dateKey);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() : 0;
};

/** Told to Sathi: by voice, or typed to Sathi — never a form entry, never a deleted log. */
const isTalk = (log: DailyLog): boolean => !log.deletion && log.meta?.provenance?.source !== 'manual';

/** The last seven days of this farm (today last), each filled when the phone holds a talk of that day. Pure. */
export function streakWeekOf(history: readonly DailyLog[], farmId: string | null | undefined, todayKey: string): StreakDay[] {
    const keys = lastSevenDays(todayKey);
    const told = new Set<string>();
    for (const l of history) {
        if (!l.date || !isTalk(l)) continue;
        if (farmId && l.meta?.farmId && l.meta.farmId !== farmId) continue;
        told.add(l.date);
    }
    return keys.map(dateKey => ({ dateKey, weekday: weekdayOf(dateKey), told: told.has(dateKey), today: dateKey === todayKey }));
}

/** The phone has completed its first pull (`syncCursors.shramsafal.lastSyncAt` is set). False while unknown or on any failure. */
export function useFirstPullDone(): boolean {
    const [pulled, setPulled] = useState(false);
    useEffect(() => {
        let alive = true;
        try {
            void getDatabase().syncCursors.get(SYNC_SCOPE)
                .then(c => { if (alive) setPulled(!!c?.lastSyncAt); })
                .catch(() => { if (alive) setPulled(false); });
        } catch {
            setPulled(false);
        }
        return () => { alive = false; };
    }, []);
    return pulled;
}

/** The seven days to draw, or null when they cannot be shown truthfully (no history, or the first pull has not completed). */
export function useStreakWeek(history: readonly DailyLog[] | undefined, farmId: string | null | undefined): StreakDay[] | null {
    const pulled = useFirstPullDone();
    if (!pulled || !history) return null;
    const days = streakWeekOf(history, farmId, getDateKey());
    return days.length === 7 ? days : null;
}
