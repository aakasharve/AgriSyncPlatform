/**
 * spec: pre-launch-repair L2a (D-19 "honest upload states"; P10) — whether a money entry is on this phone,
 * on the server, or needs the farmer, PER ENTRY, by the same three-claim rule the header chip uses
 * (`deriveSyncHonestyState`: weakest claim wins, `ON_SERVER` only on positive evidence) and from evidence the
 * app already keeps. Nothing new is queued or stored:
 *   - the entry's own row in the sync queue (`add_cost_entry`) — acknowledged only when `APPLIED`;
 *   - the server's own copy, once a pull brings it back (`db.costEntries`) — also acknowledgement;
 *   - neither = it reached no queue (e.g. no farm known): a वही entry is on this phone only, never "on the
 *     server"; a bill's key makes no claim at all (see `claimOf`).
 * The bill photo's own upload state (`db.attachments`) is read in the same pass, for the खरेदी list.
 */
import { useEffect, useState } from 'react';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import type { MutationQueueStatus } from '../../infrastructure/storage/DexieDatabase.types';
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';
import {
    deriveSyncHonestyState, EMPTY_SYNC_EVIDENCE, SYNC_HONESTY_OPEN_STATUSES,
    type SyncHonestyClaim, type SyncQueueRowSnapshot,
} from '../sync/status/syncHonestyState';

interface Keyed { id?: string; description?: string }

export interface MoneyQueueRow extends Keyed { status: MutationQueueStatus; retryCount: number }

export interface MoneyEvidence {
    /** Every `add_cost_entry` row this phone queued (`id` = the entry's id, `description` = its source key). */
    rows: readonly MoneyQueueRow[];
    /** The server's own copies, as the last pull brought them. */
    server: readonly Keyed[];
    /** Upload state per photo id (`pending` / `uploading` / `uploaded` / `failed` …). */
    photos: ReadonlyMap<string, string>;
}

/**
 * `neverQueued` — what a key with no queue row and no server copy means:
 *   - `'on-phone'` (वही): the entry itself is in this phone's money cache, so it IS on the phone;
 *   - `'unknown'` (खरेदी): the key is computed from the bill, and a legacy bill can compute one that never
 *     existed (lines all ₹0, total > 0 → `<bill>:total`, never queued). Such a key is evidence of nothing:
 *     it cannot make the bill "पाठवणे बाकी" (money that will never be sent) nor let it be "on the server".
 *     Only the queue's own rows can say a bill's money is on this phone (L2a review m6).
 */
function claimOf(
    evidence: MoneyEvidence, keys: readonly string[], keyOf: (k: Keyed) => string | undefined,
    neverQueued: 'on-phone' | 'unknown',
): SyncHonestyClaim {
    if (keys.length === 0) return null;
    const open: SyncQueueRowSnapshot[] = [];
    let acknowledgedCount = 0;
    let neverQueuedCount = 0;
    for (const key of keys) {
        const rows = evidence.rows.filter(r => keyOf(r) === key);
        const onServer = evidence.server.some(s => keyOf(s) === key);
        for (const row of rows) {
            if (SYNC_HONESTY_OPEN_STATUSES.includes(row.status)) open.push(row);
            else if (row.status === 'APPLIED') acknowledgedCount += 1;
        }
        if (onServer) acknowledgedCount += 1;
        if (rows.length === 0 && !onServer) neverQueuedCount += 1;
    }
    const unqueueableCount = neverQueued === 'on-phone' ? neverQueuedCount : 0;
    const claim = deriveSyncHonestyState({ ...EMPTY_SYNC_EVIDENCE, rows: open, acknowledgedCount, unqueueableCount });
    return claim === 'ON_SERVER' && neverQueuedCount > 0 ? null : claim;
}

/** One money entry (वही), by its id. */
export const entryClaim = (evidence: MoneyEvidence, costEntryId: string): SyncHonestyClaim =>
    claimOf(evidence, [costEntryId], k => k.id, 'on-phone');

/** A bill's money entries (खरेदी), by their source keys (`billMoneyLines(...).sourceId`). */
export const billClaim = (evidence: MoneyEvidence, sourceIds: readonly string[]): SyncHonestyClaim =>
    claimOf(evidence, sourceIds, k => k.description, 'unknown');

export async function readMoneyEvidence(): Promise<MoneyEvidence> {
    const db = getDatabase();
    const [queueRows, serverRows, attachments] = await Promise.all([
        db.mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray(),
        db.costEntries.toArray(),
        db.attachments.toArray(),
    ]);
    return {
        rows: queueRows.map(row => {
            const payload = (row.payload ?? {}) as { costEntryId?: string; description?: string };
            return { id: payload.costEntryId, description: payload.description, status: row.status, retryCount: row.retryCount };
        }),
        server: serverRows.map(row => ({ id: row.id, description: (row.payload as { description?: string } | undefined)?.description })),
        photos: new Map(attachments.map(a => [a.id, a.status])),
    };
}

/**
 * The evidence, re-read every 3 s (the sync status's own rhythm) and whenever the money cache changes.
 * `null` until read — and stays `null` if it cannot be read: no evidence, no claim.
 */
export function useMoneyEvidence(): MoneyEvidence | null {
    const [evidence, setEvidence] = useState<MoneyEvidence | null>(null);
    useEffect(() => {
        let alive = true;
        const read = () => {
            readMoneyEvidence().then(e => { if (alive) setEvidence(e); }).catch(() => { /* no evidence → no claim */ });
        };
        read();
        const timer = setInterval(read, 3000);
        window.addEventListener('agrisync:finance-cache-updated', read);
        return () => {
            alive = false;
            clearInterval(timer);
            window.removeEventListener('agrisync:finance-cache-updated', read);
        };
    }, []);
    return evidence;
}
