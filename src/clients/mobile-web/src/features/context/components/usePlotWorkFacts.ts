/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a; the true quick buttons "कालचेच" and "आज बाकी")
 *
 * What this phone knows about work on yesterday and today, per plot: the plots named by the day's work records. The records are indexed
 * by date (`[date+isDeleted]`), so each day is one indexed read; nothing is scanned, nothing is sent, no table or index is added.
 *
 * Honest by construction: if the records cannot be read (no database, an error), the answer is `null` for that day and no button that
 * needs it is drawn - never a guess, never a zero that looks like a fact. Reads only when `enabled` (a screen with many plots), so a
 * small farm's screens never touch the database from here.
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getTodayKey, getYesterdayKey } from '../../../core/domain/services/DateKeyService';
import { plotIdsWithWorkOn, type PlotWorkFacts } from './plotSelectorRules';

/** The plots with work recorded on one day, or `null` when the day could not be read. */
export async function readPlotsWithWorkOn(dateKey: string): Promise<Set<string> | null> {
    try {
        const records = await getDatabase().logs.where('[date+isDeleted]').equals([dateKey, 0]).toArray();
        return plotIdsWithWorkOn(records.map(r => r.log), dateKey);
    } catch {
        return null;
    }
}

export function usePlotWorkFacts(enabled: boolean): PlotWorkFacts | null {
    const [facts, setFacts] = useState<PlotWorkFacts | null>(null);
    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        void (async () => {
            const [yesterday, today] = await Promise.all([readPlotsWithWorkOn(getYesterdayKey()), readPlotsWithWorkOn(getTodayKey())]);
            if (!cancelled) setFacts({ yesterday, today });
        })();
        return () => { cancelled = true; };
    }, [enabled]);
    return facts;
}
