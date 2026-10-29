/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22) — the board's step list is kept whole, replaced on every
 * pull that carries a board, and REMOVED when a board comes without one (an older server), so a stale list is
 * never shown as today's. A pull without a board leaves everything as it was. Old phones never read the key.
 */
import { describe, expect, it, vi } from 'vitest';
import { reconcileAttentionBoard } from '../attentionBoardReconciler';
import { SCHEDULED_WORK_META_KEY } from '../../../../attention/scheduledWork';
import type { AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';

const fakeDb = () => {
    const meta = new Map<string, unknown>();
    const db = {
        attentionCards: { clear: vi.fn().mockResolvedValue(undefined), bulkPut: vi.fn().mockResolvedValue(undefined) },
        appMeta: {
            put: vi.fn(async (row: { key: string; value: unknown }) => { meta.set(row.key, row.value); }),
            delete: vi.fn(async (key: string) => { meta.delete(key); }),
        },
    };
    return { db: db as unknown as AgriLogDatabase, meta };
};
const pull = (attentionBoard: unknown) => ({ serverTimeUtc: '2026-10-26T04:00:00.000Z', attentionBoard }) as unknown as SyncPullResponse;
const row = { plannedActivityId: 'a', farmId: 'f1', plotId: 'p1', plotName: 'प्लॉट', cropCycleId: 'c', activityName: 'Foliar Spray', stage: 'S', plannedDate: '2026-10-25', daysLate: 1, isMissed: false };

describe('attentionBoardReconciler — the scheduled-work list', () => {
    it('stores the server\'s list with its as-of time; a broken row is dropped', async () => {
        const { db, meta } = fakeDb();
        await reconcileAttentionBoard(db, pull({ asOfUtc: '2026-10-26T03:59:00.000Z', cards: [], scheduledWork: [row, { broken: true }] }));
        expect(meta.get(SCHEDULED_WORK_META_KEY)).toEqual({ items: [row], asOfUtc: '2026-10-26T03:59:00.000Z' });
    });

    it('a board without a list (older server) removes the stored one; no board at all changes nothing', async () => {
        const { db, meta } = fakeDb();
        meta.set(SCHEDULED_WORK_META_KEY, { items: [row], asOfUtc: 'x' });
        await reconcileAttentionBoard(db, pull(null));
        expect(meta.has(SCHEDULED_WORK_META_KEY)).toBe(true);
        await reconcileAttentionBoard(db, pull({ cards: [] }));
        expect(meta.has(SCHEDULED_WORK_META_KEY)).toBe(false);
    });
});
