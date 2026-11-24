/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (F2) - the voice layer's right-hand chip "या महिन्यात N दिवस": the number of distinct days of this calendar
 * month on which the phone holds a saved log for THIS plot. Only real data, and only when the count can be trusted:
 *   - the phone's pull is cursor-based from the beginning on a fresh install (`GetDailyLogsChangedSinceAsync` has no date window), so once
 *     a pull has completed (`syncCursors.shramsafal.lastSyncAt` is set) the phone's store holds every log this person may see;
 *   - before that first pull, or with no plot (a whole-farm place), the chip is NOT drawn - never a guessed number.
 */
import { useEffect, useState } from 'react';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import type { DailyLog } from '../../../../types';

const SYNC_SCOPE = 'shramsafal';

/** Distinct days of `today`'s month with a saved (not deleted) log on this plot. Pure. */
export function monthDaysOf(history: readonly DailyLog[], plotId: string, todayKey: string): number {
    const month = todayKey.slice(0, 7);
    const days = new Set<string>();
    for (const l of history) {
        if (l.deletion || !l.date || !l.date.startsWith(month)) continue;
        if ((l.context?.selection ?? []).some(s => (s.selectedPlotIds ?? []).includes(plotId))) days.add(l.date);
    }
    return days.size;
}

export const monthChipWords = (n: number, language: string | null | undefined): string =>
    (language === 'en' ? `${n} ${n === 1 ? 'day' : 'days'} this month` : `या महिन्यात ${digitsFor(String(n), 'mr')} दिवस`);

/** The chip text, or undefined when it cannot be shown truthfully (no single plot, or the phone has not completed its first pull). */
export function useMonthChip(history: readonly DailyLog[] | undefined, plotId: string | null | undefined, language: string | null | undefined): string | undefined {
    const [pulled, setPulled] = useState(false);
    useEffect(() => {
        let alive = true;
        void getDatabase().syncCursors.get(SYNC_SCOPE).then(c => { if (alive) setPulled(!!c?.lastSyncAt); }).catch(() => { if (alive) setPulled(false); });
        return () => { alive = false; };
    }, []);
    if (!pulled || !history || !plotId) return undefined;
    const n = monthDaysOf(history, plotId, getDateKey());
    return n > 0 ? monthChipWords(n, language) : undefined;
}
