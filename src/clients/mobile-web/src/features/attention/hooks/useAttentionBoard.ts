import { useState, useEffect, useCallback } from 'react';
import { getDatabase, AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';

/**
 * The sync scope whose cursor proves this device has ever completed a pull.
 * Hardcoded here exactly as `SyncStatusService.readSyncEvidence` and
 * `useSyncQueueStatus` already hardcode it — `MutationQueue`'s `SYNC_SCOPE`
 * is module-private, and importing the queue would drag the whole sync
 * transport into a hook that only needs to read one row.
 */
const SYNC_SCOPE = 'shramsafal';

interface UseAttentionBoardResult {
    cards: AttentionCardCacheRecord[];
    asOf: string | null;
    isLoading: boolean;
    /**
     * TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — true
     * when this device has NEVER completed a sync pull, so `db.attentionCards`
     * has never been written and its emptiness is evidence of nothing.
     *
     * WHY THE CURSOR AND NOT THE CARD COUNT. `db.attentionCards` is written by
     * exactly one thing — `reconcileAttentionBoard`, inside a successful pull
     * (`SyncPullReconciler.ts`). `db.syncCursors.lastSyncAt` is written by
     * `MutationQueue.setCursor()` at the end of that same pull. No cursor
     * therefore means no pull has ever landed, which means the board was never
     * populated: UNKNOWN, not "nothing to worry about". A cursor plus zero
     * cards is a REAL answer and the screen's all-clear is true — this stays
     * `false` there, which is what keeps the fix from swapping one falsehood
     * for its opposite.
     *
     * Also true when the Dexie read itself throws: same conclusion, arrived at
     * a different way — we could not find out.
     */
    loadFailed: boolean;
    refresh: () => void;
}

export function useAttentionBoard(): UseAttentionBoardResult {
    const [cards, setCards] = useState<AttentionCardCacheRecord[]>([]);
    const [asOf, setAsOf] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const db = getDatabase();
            const all = await db.attentionCards.orderBy('rank').toArray();
            const cursor = await db.syncCursors.get(SYNC_SCOPE);
            setLoadFailed(!cursor?.lastSyncAt);
            setCards(all);
            const latest = all.reduce<string | null>((max, c) => {
                if (!max) return c.computedAtUtc;
                return c.computedAtUtc > max ? c.computedAtUtc : max;
            }, null);
            setAsOf(latest);
        } catch {
            // The store we ask the question of is unreadable, so we have no
            // answer to give. Previously this threw out of the hook with no
            // catch at all; either way the screen must not fall through to an
            // all-clear.
            setLoadFailed(true);
            setCards([]);
            setAsOf(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    /**
     * The retry the banner offers. Re-reading Dexie on its own could only ever
     * reach the same conclusion — the table is empty because nothing has ever
     * filled it — so the retry goes to where the failure actually was and asks
     * for a sync first. This is Task 6e's rule (`useLabourState.refresh`
     * re-asking `/me`) applied to the one table only a pull can populate:
     * a button that cannot do what it offers is a fresh falsehood in place of
     * the one just removed.
     *
     * A failing sync is not handled here — it leaves the cursor unwritten, so
     * the re-read below simply finds `loadFailed` still true and the banner
     * stays up, which is the honest outcome.
     */
    const refresh = useCallback(() => {
        void (async () => {
            try {
                await backgroundSyncWorker.triggerNow();
            } catch {
                // Swallowed deliberately: the re-read below is what decides
                // what the farmer is told, and it reads the cursor, not this.
            }
            await load();
        })();
    }, [load]);

    return { cards, asOf, isLoading, loadFailed, refresh };
}
