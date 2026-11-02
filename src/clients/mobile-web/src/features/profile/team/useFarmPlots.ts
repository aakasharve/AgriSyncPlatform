/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane MU-4 — the plots of ONE farm as this phone holds them (the server's copies), kept live, for the
 * owner's plot choice on a person's team card. Names only; an unnamed plot shows the word for it, never a made-up name.
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

export interface FarmPlot {
    id: string;
    name: string;
}

/** The farm's plots (sorted by name), or `[]` until read / with no farm. */
export function useFarmPlots(farmId: string | null | undefined): FarmPlot[] {
    const [plots, setPlots] = useState<FarmPlot[]>([]);
    useEffect(() => {
        if (!farmId) {
            setPlots([]);
            return undefined;
        }

        let alive = true;
        const subscription = liveQuery(() => getDatabase().plots.where('farmId').equals(farmId).toArray()).subscribe({
            next: rows => {
                if (!alive) return;
                setPlots(rows
                    .map(row => ({ id: row.id, name: String((row.payload as { name?: unknown } | null)?.name ?? '').trim() }))
                    .sort((a, b) => a.name.localeCompare(b.name)));
            },
            error: () => { if (alive) setPlots([]); },
        });
        return () => { alive = false; subscription.unsubscribe(); };
    }, [farmId]);
    return plots;
}
