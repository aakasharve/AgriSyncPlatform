// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S fix pass 4, R3-2) — every record this build makes outside
 * the हजेरी door carries its details document on its create, EVEN WHEN EMPTY (a per-plot part of a multi-plot voice save
 * that holds only labour; a no-work day saved without a cause). The empty document is a statement — "nothing but what
 * the create itself says" — so the server holds the record's create-time details, decides alone which money must move
 * with it, and a phone that did not make the record can move it. The हजेरी door still sends none (B002).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LogCommandServiceImpl } from '../../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../../infrastructure/storage/DexieLogsRepository';
import { enqueueLogsForSync } from '../logSyncMutationService';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import type { CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../../types';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => 'f0000000-0000-4000-8000-000000000001',
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

const FARM_ID = 'f0000000-0000-4000-8000-000000000001';
const CROP_ID = 'd0000000-0000-4000-8000-000000000001';
const PLOT = 'a0000000-0000-4000-8000-00000000000a';
const CYCLE = 'e0000000-0000-4000-8000-00000000000a';
const grapes = { id: CROP_ID, name: 'Grapes', plots: [{ id: PLOT, name: 'Plot A' }] } as unknown as CropProfile;
const owner = { activeOperatorId: 'owner' } as unknown as FarmerProfile;
const scope = { selectedPlotIds: [PLOT], selectedCropIds: [CROP_ID], mode: 'single', applyPolicy: 'SHARED' } as unknown as LogScope;

async function save(draft: Record<string, unknown>): Promise<DailyLog> {
    const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance());
    const created = await service.createFromManual({ date: '2026-10-26', ...draft } as never, scope, [grapes], owner);
    await service.confirmAndSave(created);
    return created[0];
}

const createOf = async (logId: string) => (await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray())
    .find(r => (r.payload as { dailyLogId?: string }).dailyLogId === logId)?.payload as Record<string, unknown> | undefined;

describe('R3-2 — every non-door create carries its details document, even when empty', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await Promise.all([db.mutationQueue.clear(), db.logs.clear(), db.farms.clear(), db.plots.clear(), db.cropCycles.clear()]);
        localStorage.clear();
        await db.farms.put({ id: FARM_ID, payload: { id: FARM_ID }, updatedAt: '2026-10-01T00:00:00.000Z' } as never);
        await db.plots.put({ id: PLOT, payload: { id: PLOT, farmId: FARM_ID, name: 'Plot A' }, modifiedAtUtc: '2026-10-01T00:00:00.000Z' } as never);
        await db.cropCycles.put({
            id: CYCLE, plotId: PLOT,
            payload: { id: CYCLE, plotId: PLOT, farmId: FARM_ID, cropName: 'Grapes', modifiedAtUtc: '2026-10-01T00:00:00.000Z' },
            modifiedAtUtc: '2026-10-01T00:00:00.000Z',
        } as never);
    });

    it('a record holding only labour (a per-plot part of a multi-plot voice save) sends an empty details document', async () => {
        const log = await save({ labour: [{ id: 'crew-1', type: 'HIRED', count: 5, totalCost: 1500 }] });
        await enqueueLogsForSync([log]);
        const create = await createOf(log.id);
        expect(create).toBeDefined();
        expect(create?.content).toMatchObject({ schema: 1 });
        for (const bucket of ['cropActivities', 'irrigation', 'inputs', 'observations', 'machinery', 'activityExpenses', 'plannedTasks']) {
            expect(create?.content).not.toHaveProperty(bucket); // empty: it says nothing was done beyond the create itself
        }
    });

    it('a record with nothing in it (a no-work day saved without a cause) sends an empty details document too', async () => {
        const log = await save({});
        await enqueueLogsForSync([log]);
        expect((await createOf(log.id))?.content).toMatchObject({ schema: 1 });
    });

    it('the हजेरी door still sends no details document (it holds labour only, B002)', async () => {
        const log = await save({ labour: [{ id: 'crew-2', type: 'HIRED', count: 3 }] });
        await enqueueLogsForSync([{ ...log, captureScope: 'labour' } as DailyLog]);
        expect(await createOf(log.id)).not.toHaveProperty('content');
    });
});
