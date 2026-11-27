// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2. The farm's first day as the PHONE holds it: the farm
 * row the REAL pull writes (`reconcileSyncPull` → `db.farms`, the server's `createdAtUtc`), over fake-indexeddb.
 *   - each farm its own day; no row (not pulled yet) → null; a row with no date → null (never a guess);
 *   - read again after a pull (`agrisync:sync-reconciled`);
 *   - after a farm switch the last farm's day is never shown for the new one.
 */
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../infrastructure/reference/TemplateCatalog', async (importActual) => ({
    ...(await importActual<typeof import('../../../infrastructure/reference/TemplateCatalog')>()),
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));

import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { readFarmStartKey, useFarmStartKey } from '../useFarmStartKey';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ME = '11111111-1111-4111-8111-111111111111';
const at = '2026-11-27T06:00:00.000Z';

const payload = (farms: { id: string; createdAtUtc: string }[]): SyncPullResponse => ({
    serverTimeUtc: at,
    nextCursorUtc: at,
    farms: farms.map(f => ({ id: f.id, name: 'शेत', ownerUserId: ME, createdAtUtc: f.createdAtUtc, modifiedAtUtc: at })),
    plots: [], cropCycles: [],
    dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [],
    operators: [{ userId: ME, displayName: 'मी', role: 'PRIMARY_OWNER' }],
    scheduleTemplates: [], cropTypes: [], activityCategories: [], costCategories: [], referenceDataVersionHash: 'h',
} as unknown as SyncPullResponse);

beforeEach(async () => {
    await getDatabase().delete();
    await resetDatabase();
    localStorage.clear();
});

describe('the farm\'s first day, from the pulled farm row', () => {
    it('each farm its own day, in India time; a farm not pulled yet has none', async () => {
        await reconcileSyncPull(payload([{ id: A, createdAtUtc: '2026-11-20T20:00:00Z' }, { id: B, createdAtUtc: '2026-11-24T04:00:00Z' }]));
        expect(await readFarmStartKey(A)).toBe('2026-11-21');
        expect(await readFarmStartKey(B)).toBe('2026-11-24');
        expect(await readFarmStartKey('not-pulled')).toBeNull();
    });

    it('a row with no creation date (another writer\'s shape) gives no day', async () => {
        await getDatabase().farms.put({ id: A, payload: { id: A, name: 'शेत', createdAt: '2026-11-20T00:00:00Z' }, updatedAt: at } as never);
        expect(await readFarmStartKey(A)).toBeNull();
    });

    it('the hook: read for the open farm, again after a pull, and never the last farm\'s day after a switch', async () => {
        const { result, rerender } = renderHook(({ farmId }: { farmId: string | null }) => useFarmStartKey(farmId), { initialProps: { farmId: A as string | null } });
        await waitFor(() => expect(result.current).toBeNull());
        await reconcileSyncPull(payload([{ id: A, createdAtUtc: '2026-11-20T06:00:00Z' }]));
        await act(async () => { window.dispatchEvent(new CustomEvent('agrisync:sync-reconciled')); });
        await waitFor(() => expect(result.current).toBe('2026-11-20'));
        rerender({ farmId: B });
        expect(result.current).toBeNull();
        await waitFor(() => expect(result.current).toBeNull());
        rerender({ farmId: null });
        expect(result.current).toBeNull();
    });
});
