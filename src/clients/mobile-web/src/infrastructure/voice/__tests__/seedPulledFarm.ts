/**
 * Test helper: put a farm into Dexie the way the app really does - through the
 * sync pull's own writer (`reconcileFarmsPlotsCycles`) fed a pull response that
 * carries the server FarmDto. The stored row is `{ id, payload, updatedAt }`;
 * `ownerAccountId` lives INSIDE `payload`. Never hand-build a top-level shape.
 */
import { getDatabase } from '../../storage/DexieDatabase';
import { reconcileFarmsPlotsCycles } from '../../../features/sync/pull/reconcilers/farmsPlotsCyclesReconciler';
import type { SyncPullResponse } from '../../api/AgriSyncClient';

export async function seedPulledFarm(farmId: string, ownerAccountId: string, receivedAtUtc = '2026-10-01T00:00:00.000Z') {
    const response = {
        farms: [{ id: farmId, name: 'Test farm', ownerAccountId }],
        plots: [],
        cropCycles: [],
    } as unknown as SyncPullResponse;
    await reconcileFarmsPlotsCycles(getDatabase(), response, receivedAtUtc);
}
