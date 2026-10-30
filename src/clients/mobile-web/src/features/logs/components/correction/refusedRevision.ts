/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF2 fix pass, review B002) — did the server REFUSE a change
 * he saved for this entry? The phone now refuses a हजेरी-door record before queueing, but a refusal can still come back
 * (a version conflict, a document the server will not take). Then the "बदला" screen says so honestly — the change is
 * only on this phone — never that it was sent. Read from the sync queue's own row for that change (the same evidence
 * rule as `useLogSyncState`): parked for review, or failed past the retry cap.
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { MAX_AUTO_RETRY_COUNT } from '../../../../infrastructure/sync/retryCap';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

/** A change to this entry the server refused (and that is not since replaced by an accepted one). */
export async function readRefusedRevision(logId: string): Promise<boolean> {
    try {
        const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.ReviseLogContent).toArray();
        const mine = rows.filter(r => String((r.payload as { dailyLogId?: unknown } | null)?.dailyLogId ?? '') === logId);
        const last = [...mine].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
        return !!last && (last.status === 'REJECTED_USER_REVIEW' || last.status === 'REJECTED_DROPPED'
            || (last.status === 'FAILED' && last.retryCount >= MAX_AUTO_RETRY_COUNT));
    } catch {
        return false; // no evidence either way: no claim
    }
}

export function useRefusedRevision(logId: string | undefined, read: (id: string) => Promise<boolean> = readRefusedRevision): boolean {
    const [refused, setRefused] = useState(false);
    useEffect(() => {
        let alive = true;
        if (!logId) { setRefused(false); return undefined; }
        void read(logId).then(r => { if (alive) setRefused(r); });
        return () => { alive = false; };
    }, [logId, read]);
    return refused;
}
