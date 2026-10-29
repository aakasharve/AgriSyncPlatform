/**
 * spec: pre-launch-repair L2a (R-3, D-19; review M2) — the bill's reading is asked for, and kept, under the
 * farm the CALLER passes. It used to look up the FIRST farm of the last download, so a farmer with two farms
 * had his bill read under the wrong one. Here the last download lists FARM_FIRST first and the caller passes
 * FARM_CHOSEN: every request — online, its fallback, and the offline queue — must carry FARM_CHOSEN.
 * Only the network client and the key hasher are stubbed; the farm parameter is the real one.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createReceiptSession = vi.fn();
const extractReceipt = vi.fn();
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: {
        createReceiptSession: (...a: unknown[]) => createReceiptSession(...a),
        extractReceipt: (...a: unknown[]) => extractReceipt(...a),
    },
}));
const buildOperationKey = vi.fn(async (_p: { farmId: string }) => ({ idempotencyKey: 'key-1' }));
vi.mock('../../../../infrastructure/ai/IdempotencyKeyFactory', () => ({
    IdempotencyKeyFactory: {
        hashBlob: async () => 'hash-1',
        buildOperationKey: (p: { farmId: string }) => buildOperationKey(p),
    },
}));

import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { extractReceiptData, extractReceiptWithSession } from '../receiptExtractionClient';

const FARM_FIRST = '11111111-1111-1111-1111-111111111111';
const FARM_CHOSEN = '22222222-2222-2222-2222-222222222222';
const PHOTO = 'data:image/png;base64,eA==';

let online = true;
beforeEach(async () => {
    online = true;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
    const db = getDatabase();
    await db.pendingAiJobs.clear();
    // The old lookup's answer: the first farm of the last download.
    await db.appMeta.put({ key: 'shramsafal_last_pull_payload', value: { farms: [{ id: FARM_FIRST }, { id: FARM_CHOSEN }] }, updatedAt: '2026-10-29T00:00:00.000Z' });
});
afterEach(() => { vi.clearAllMocks(); });

describe('extractReceiptWithSession — the farm is the caller\'s, never a looked-up first farm', () => {
    it('online: the session request (and its fallback) carry the passed farm', async () => {
        createReceiptSession.mockRejectedValue(new Error('session api down'));
        extractReceipt.mockResolvedValue({ vendorName: 'कृषी सेवा केंद्र', grandTotal: 600, lineItems: [] });

        const result = await extractReceiptWithSession(PHOTO, FARM_CHOSEN, () => undefined);

        expect(createReceiptSession).toHaveBeenCalledWith(FARM_CHOSEN, expect.any(Blob), 'image/png', 'key-1');
        expect(extractReceipt).toHaveBeenCalledWith(expect.any(Blob), 'image/png', FARM_CHOSEN, 'key-1');
        expect(buildOperationKey.mock.calls.map(([p]) => p.farmId)).toEqual([FARM_CHOSEN, FARM_CHOSEN]);
        expect(JSON.stringify([createReceiptSession.mock.calls, extractReceipt.mock.calls])).not.toContain(FARM_FIRST);
        expect(result.grandTotal).toBe(600);
    });

    it('offline: the queued reading job is kept under the passed farm', async () => {
        online = false;
        const result = await extractReceiptWithSession(PHOTO, FARM_CHOSEN, () => undefined);

        expect(result.queued).toBe(true);
        expect(createReceiptSession).not.toHaveBeenCalled();
        const jobs = await getDatabase().pendingAiJobs.toArray();
        expect(jobs).toHaveLength(1);
        expect((jobs[0].context as { farmId: string }).farmId).toBe(FARM_CHOSEN);
    });

    it('no farm passed: nothing is asked of the server and nothing is queued — no first farm filled in', async () => {
        const result = await extractReceiptWithSession(PHOTO, '', () => undefined);

        expect(result.success).toBe(false);
        expect(createReceiptSession).not.toHaveBeenCalled();
        expect(extractReceipt).not.toHaveBeenCalled();
        expect(await getDatabase().pendingAiJobs.count()).toBe(0);
    });
});

describe('extractReceiptData — the legacy reader uses the passed farm too', () => {
    it('online: the request carries the passed farm', async () => {
        extractReceipt.mockResolvedValue({ grandTotal: 120, lineItems: [] });
        await extractReceiptData(PHOTO, FARM_CHOSEN);
        expect(extractReceipt).toHaveBeenCalledWith(expect.any(Blob), 'image/png', FARM_CHOSEN, 'key-1');
    });
});
