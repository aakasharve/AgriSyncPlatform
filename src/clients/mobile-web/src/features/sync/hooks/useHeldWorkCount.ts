/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec R-11 (c) — how many records OF THE OPEN FARM this phone is HOLDING because the server
 * refused them for the farm's trial / plan (`isEntitlementHeldRejection`), not for anything about
 * the record. Only the open farm's: a person on farms under two owners must not read "the farm's
 * term has ended" on a farm that is fine because another farm's records are held. The farm is the
 * one stamped on the row at enqueue (`queuedRowFarmId`); a row that names no farm is not counted.
 *
 * Read from Dexie: a held row is a FAILED / PENDING / SENDING mutation whose persisted `errorCode`
 * is one of the held entitlement codes (`MutationQueue.markFailed(..., 'HELD', code)` writes it;
 * `markApplied` and any non-held failure clear it). Polled like `useSyncQueueStatus` — a held row
 * changes only on a sync cycle, so a few seconds of lag is invisible.
 */
import { useCallback, useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { MutationQueueItem } from '../../../infrastructure/storage/DexieDatabase';
import { isEntitlementHeldRejection } from '../../../infrastructure/sync/RejectionPolicy';
import { queuedRowFarmId } from '../../../infrastructure/sync/MutationQueue';

const HELD_STATUSES: ReadonlyArray<MutationQueueItem['status']> = ['FAILED', 'PENDING', 'SENDING'];
const POLL_MS = 5000;

type HeldRowFields = Pick<MutationQueueItem, 'status' | 'errorCode'> & Partial<Pick<MutationQueueItem, 'farmId' | 'payload'>>;

/** Pure: the held rows of `farmId` among `rows`; none without an open farm (exported for the tests). */
export function countHeldRows(rows: ReadonlyArray<HeldRowFields>, farmId: string | null | undefined): number {
    if (!farmId) return 0;
    return rows.filter(r =>
        HELD_STATUSES.includes(r.status)
        && isEntitlementHeldRejection(r)
        && queuedRowFarmId(r) === farmId).length;
}

export function useHeldWorkCount(farmId: string | null | undefined): number {
    const [count, setCount] = useState(0);

    const refresh = useCallback(async () => {
        try {
            const rows = await getDatabase().mutationQueue
                .where('status')
                .anyOf([...HELD_STATUSES])
                .toArray();
            setCount(countHeldRows(rows, farmId));
        } catch (error) {
            // A failed read claims nothing: the count stays what it was.
            console.warn('[useHeldWorkCount] Failed to read the queue', error);
        }
    }, [farmId]);

    useEffect(() => {
        void refresh();
        const interval = setInterval(() => { void refresh(); }, POLL_MS);
        return () => clearInterval(interval);
    }, [refresh]);

    return count;
}
