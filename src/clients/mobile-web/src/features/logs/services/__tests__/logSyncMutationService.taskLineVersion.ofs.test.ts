// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S fix 1, B005) — when a record's details cannot travel as
 * one document, its create goes out with separate task lines (`add_log_task`), and the server moves the record's
 * version on once for each line. So the version this phone expects is 1 + the number of lines, written on the phone
 * when they are queued — a move made right after saving names the server's own version and is never refused as
 * "someone changed this" when nobody did. A record whose details DO travel as one document stays at version 1.
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

async function saveAndQueue(draft: Record<string, unknown>): Promise<DailyLog> {
    const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance());
    const created = await service.createFromManual({ date: '2026-10-26', ...draft } as never, scope, [grapes], owner);
    await service.confirmAndSave(created);
    await enqueueLogsForSync(created);
    return created[0];
}

const tasksFor = async (logId: string) => (await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.AddLogTask).toArray())
    .filter(r => (r.payload as { dailyLogId?: string }).dailyLogId === logId);

describe('B005 — the version a phone expects after its create', () => {
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

    it('a create that goes out with N task lines leaves this phone expecting version 1 + N', async () => {
        // Two parts sharing one id: the document does not fit the contract, so the details go as task lines.
        const log = await saveAndQueue({ cropActivities: [{ id: 'same', title: 'खुरपणी' }, { id: 'same', title: 'फवारणी' }] });
        const lines = await tasksFor(log.id);
        expect(lines.length).toBeGreaterThan(0);
        const onPhone = (await getDatabase().logs.get(log.id))?.log as DailyLog;
        expect(onPhone.contentVersion).toBe(1 + lines.length);
    });

    it('a create whose details travel as one document expects version 1', async () => {
        const log = await saveAndQueue({ cropActivities: [{ id: 'a', title: 'खुरपणी' }] });
        expect(await tasksFor(log.id)).toHaveLength(0);
        const onPhone = (await getDatabase().logs.get(log.id))?.log as DailyLog;
        expect(onPhone.contentVersion ?? 1).toBe(1);
    });
});
