// @vitest-environment jsdom
/**
 * spec: pre-launch-repair L2b (L2a review leftover; D-19 "never first-farm fallback") — a sale slip is read
 * under the farm of the harvest's own plot, else the farm the app is working on if this phone holds it; never
 * the FIRST farm of the last download. Real SyncContext over fake-indexeddb; the network client is stubbed.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const extractPatti = vi.fn();
vi.mock('../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { extractPatti: (...a: unknown[]) => extractPatti(...a) } }));
vi.mock('../../infrastructure/ai/IdempotencyKeyFactory', () => ({
    IdempotencyKeyFactory: { hashBlob: async () => 'hash', buildOperationKey: async () => ({ idempotencyKey: 'key' }) },
}));

import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { SessionStore } from '../../infrastructure/storage/SessionStore';
import { processPattiImage } from '../pattiImageService';

const FARM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FARM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLOT_B = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-29T00:00:00Z';

beforeEach(async () => {
    const db = getDatabase();
    await Promise.all([db.appMeta.clear(), db.plots.clear(), db.farms.clear()]);
    SessionStore.clearCurrentFarmId();
    extractPatti.mockResolvedValue({ grandTotal: 100 });
    // The last download lists farm A FIRST — the farm the old code always used.
    await db.appMeta.put({ key: 'shramsafal_last_pull_payload', value: { farms: [{ id: FARM_A }, { id: FARM_B }], plots: [{ id: PLOT_B, farmId: FARM_B }] } } as never);
    await db.farms.bulkPut([{ id: FARM_A, payload: {}, updatedAt: NOW }, { id: FARM_B, payload: {}, updatedAt: NOW }] as never);
});
afterEach(() => { vi.clearAllMocks(); SessionStore.clearCurrentFarmId(); });

describe('the farm a sale slip is read under', () => {
    it('the harvest plot\'s own farm — not the first farm of the last download', async () => {
        await processPattiImage('aGVsbG8=', 'image/png', 'Grapes', PLOT_B);
        expect(extractPatti).toHaveBeenCalledWith(expect.anything(), 'image/png', 'Grapes', FARM_B, 'key');
    });

    it('no plot: the farm the app is working on, when this phone holds it', async () => {
        SessionStore.setCurrentFarmId(FARM_B);
        await processPattiImage('aGVsbG8=', 'image/png', 'Grapes');
        expect(extractPatti).toHaveBeenCalledWith(expect.anything(), 'image/png', 'Grapes', FARM_B, 'key');
    });

    it('no farm known: not read at all — never a guessed farm', async () => {
        const result = await processPattiImage('aGVsbG8=', 'image/png', 'Grapes');
        expect(extractPatti).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false });
    });
});
