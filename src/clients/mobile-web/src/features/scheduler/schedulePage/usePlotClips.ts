/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S8, S10)
 *
 * The recordings THIS PHONE holds for one plot, by IST day — the microphone count on each past day and the
 * playable list in the day sheet. Read from the same local store the voice diary plays from (Dexie
 * `voiceClips`: each row carries `plotId` + `recordedAtUtc`). Other people's recordings live on their phones
 * and on the server, and a clip carries no speaker or log link yet (PLR-D8 §4.4), so the page says
 * "फक्त या फोनवरचं रेकॉर्डिंग" rather than implying it is the whole day.
 * Only this plot's rows are read (the `plotId` index), and the counts follow the store while the page is
 * open (a Dexie live query, as `useReferenceData` does): a clip recorded meanwhile shows up.
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { getDatabase, type VoiceClipCacheRecord } from '../../../infrastructure/storage/DexieDatabase';

export type ClipsByDay = ReadonlyMap<string, VoiceClipCacheRecord[]>;

/** Group a plot's clips by the IST day they were recorded, oldest first within a day. */
export function groupClipsByDay(rows: readonly VoiceClipCacheRecord[], plotId: string): Map<string, VoiceClipCacheRecord[]> {
    const out = new Map<string, VoiceClipCacheRecord[]>();
    for (const row of rows) {
        if (!row || row.plotId !== plotId || typeof row.recordedAtUtc !== 'string') continue;
        if (!Number.isFinite(Date.parse(row.recordedAtUtc))) continue;
        const key = getDateKey(row.recordedAtUtc);
        const bucket = out.get(key);
        if (bucket) bucket.push(row); else out.set(key, [row]);
    }
    out.forEach(list => list.sort((a, b) => Date.parse(a.recordedAtUtc) - Date.parse(b.recordedAtUtc)));
    return out;
}

const EMPTY: ClipsByDay = new Map();

export function usePlotClips(plotId: string | null): ClipsByDay {
    const [byDay, setByDay] = useState<ClipsByDay>(EMPTY);
    useEffect(() => {
        if (!plotId) { setByDay(EMPTY); return undefined; }
        let alive = true;
        // No local store (private window / blocked): no counts, never a made-up number.
        const fail = () => { if (alive) setByDay(EMPTY); };
        let unsubscribe = () => {};
        try {
            const db = getDatabase();
            const sub = liveQuery(() => db.voiceClips.where('plotId').equals(plotId).toArray()).subscribe({
                next: rows => { if (alive) setByDay(groupClipsByDay(rows, plotId)); },
                error: fail,
            });
            unsubscribe = () => sub.unsubscribe();
        } catch {
            fail();
        }
        return () => { alive = false; unsubscribe(); };
    }, [plotId]);
    return byDay;
}
