/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2. The open farm's first day, as the PHONE holds it: the
 * farm row the pull keeps (`farmsPlotsCyclesReconciler` → `db.farms`, its payload the server's `FarmDto` with `createdAtUtc`).
 * Read when the farm changes and again after every pull (`agrisync:sync-reconciled`). No row, no date, a failed read or a
 * date that is not real: `null` — and no card (never a guess). Nothing here is written.
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { farmStartKey } from './farmDayStage';

/** The farm's first day (`YYYY-MM-DD`) from the phone's farm row; `null` when the phone does not know it. */
export async function readFarmStartKey(farmId: string): Promise<string | null> {
    try {
        const row = await getDatabase().farms.get(farmId);
        return farmStartKey((row?.payload as { createdAtUtc?: unknown } | null | undefined)?.createdAtUtc);
    } catch {
        return null;
    }
}

export function useFarmStartKey(farmId: string | null | undefined): string | null {
    const [read, setRead] = useState<{ farmId: string; startKey: string | null } | null>(null);

    useEffect(() => {
        if (!farmId) return;
        let alive = true;
        const reread = () => { void readFarmStartKey(farmId).then(startKey => { if (alive) setRead({ farmId, startKey }); }); };
        reread();
        window.addEventListener('agrisync:sync-reconciled', reread);
        return () => { alive = false; window.removeEventListener('agrisync:sync-reconciled', reread); };
    }, [farmId]);

    // Only the open farm's own answer: after a farm switch the last farm's day is never shown for the new one.
    return farmId && read?.farmId === farmId ? read.startKey : null;
}
