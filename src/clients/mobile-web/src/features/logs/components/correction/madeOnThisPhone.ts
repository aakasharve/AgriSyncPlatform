/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M fix pass 5, N5) — "the maker" of an entry, decided the way
 * the SERVER decides it: the person who sends its create (`OperatorUserId` = the signed-in sender). On a non-owner's phone
 * a new entry is stamped with the primary owner's id (the sync's active operator) until its pull comes back, so the stamp
 * alone would lock a worker out of his own new entry's prices. The phone therefore also asks its own outbox: an entry
 * whose create this phone holds (its outbox belongs to the signed-in person) was made by him.
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

/** Does this phone's outbox hold the entry's create (sent or not)? `false` when the outbox cannot be read (said). */
export async function createdOnThisPhone(logId: string): Promise<boolean> {
    try {
        const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray();
        return rows.some(r => String((r.payload as { dailyLogId?: unknown } | null)?.dailyLogId ?? '') === logId);
    } catch (error) {
        console.warn('madeOnThisPhone: the sync queue could not be read', error);
        return false;
    }
}

/** The same for one entry, read when it opens; `false` until the outbox has answered. */
export function useCreatedOnThisPhone(logId: string | undefined, read: (id: string) => Promise<boolean> = createdOnThisPhone): boolean {
    const [made, setMade] = useState<{ logId: string; made: boolean } | null>(null);
    useEffect(() => {
        if (!logId) return undefined;
        let alive = true;
        void read(logId).then(answer => { if (alive) setMade({ logId, made: answer }); });
        return () => { alive = false; };
    }, [logId, read]);
    return !!logId && made?.logId === logId && made.made;
}
