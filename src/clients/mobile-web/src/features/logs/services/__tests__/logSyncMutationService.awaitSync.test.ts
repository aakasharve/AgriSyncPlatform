// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (Task 3) — the voice auto-save does not wait for a sync cycle.
 *
 * `enqueueLogsForSync(logs, { awaitSync: false })` queues the logs (fast, local), STARTS the sync and returns at once,
 * with the same outcome (`queuedLogIds`, `skippedLogIds`) it would have had: the "not queued" honesty badge is decided
 * by the enqueue, which is known before any sync starts. A sync that rejects is logged and never thrown into the save.
 * Every other caller (hand-filled saves, the default) still awaits the sync, exactly as before.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ triggerNow: vi.fn(), warn: vi.fn() }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: h.triggerNow } }));
vi.mock('../../../../infrastructure/observability/Logger', () => ({ logger: { info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => 'f0000000-0000-4000-8000-000000000001',
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

import { LogCommandServiceImpl } from '../../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../../infrastructure/storage/DexieLogsRepository';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { markAutoSavedFromVoice } from '../../../../app/helpers/autoSavedVoiceLog';
import { enqueueLogsForSync } from '../logSyncMutationService';
import type { CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../../types';

const FARM_ID = 'f0000000-0000-4000-8000-000000000001';
const CROP_ID = 'd0000000-0000-4000-8000-000000000001';
const PLOT = 'a0000000-0000-4000-8000-00000000000a';
const CYCLE = 'e0000000-0000-4000-8000-00000000000a';

const grapes = { id: CROP_ID, name: 'Grapes', plots: [{ id: PLOT, name: 'Plot A' }] } as unknown as CropProfile;
const owner = { activeOperatorId: 'owner' } as unknown as FarmerProfile;
const scope = { selectedPlotIds: [PLOT], selectedCropIds: [CROP_ID], mode: 'single', applyPolicy: 'SHARED' } as unknown as LogScope;

async function seed() {
    const db = getDatabase();
    await db.farms.put({ id: FARM_ID, payload: { id: FARM_ID }, updatedAt: '2026-10-01T00:00:00.000Z' } as never);
    await db.plots.put({ id: PLOT, payload: { id: PLOT, farmId: FARM_ID, name: 'Plot A' }, modifiedAtUtc: '2026-10-01T00:00:00.000Z' } as never);
    await db.cropCycles.put({
        id: CYCLE, plotId: PLOT,
        payload: { id: CYCLE, plotId: PLOT, farmId: FARM_ID, cropName: 'Grapes', modifiedAtUtc: '2026-10-01T00:00:00.000Z' },
        modifiedAtUtc: '2026-10-01T00:00:00.000Z',
    } as never);
}

async function voiceLogs(): Promise<DailyLog[]> {
    const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance());
    const created = await service.createFromManual({ date: '2026-10-26', labour: [{ id: 'lab-1', type: 'HIRED', count: 4 }] } as never, scope, [grapes], owner);
    const logs = created.map(l => markAutoSavedFromVoice(l));
    await service.confirmAndSave(logs);
    return logs;
}

describe('enqueueLogsForSync — awaitSync', () => {
    beforeEach(async () => {
        h.triggerNow.mockReset();
        h.warn.mockClear();
        const db = getDatabase();
        await Promise.all([db.mutationQueue.clear(), db.logs.clear(), db.farms.clear(), db.plots.clear(), db.cropCycles.clear()]);
        localStorage.clear();
        await seed();
    });

    it('awaitSync:false returns at once with the enqueue outcome, while the sync has not answered', async () => {
        h.triggerNow.mockReturnValue(new Promise<void>(() => { /* never answers */ }));
        const logs = await voiceLogs();

        const outcome = await enqueueLogsForSync(logs, { awaitSync: false });

        expect(h.triggerNow).toHaveBeenCalledTimes(1);          // the sync WAS started
        expect(outcome.queuedLogIds).toEqual(logs.map(l => l.id)); // and the honest badge's source is known
        expect(outcome.skippedLogIds).toEqual([]);
        const queued = await getDatabase().mutationQueue.count();
        expect(queued).toBeGreaterThan(0);                       // queued BEFORE the sync started
    });

    it('a sync that rejects is logged, never thrown into the save', async () => {
        h.triggerNow.mockRejectedValue(new Error('network down'));
        const logs = await voiceLogs();

        await expect(enqueueLogsForSync(logs, { awaitSync: false })).resolves.toMatchObject({ queuedLogIds: logs.map(l => l.id) });
        await new Promise(r => setTimeout(r, 0));

        expect(h.warn).toHaveBeenCalledTimes(1);
        expect(String(h.warn.mock.calls[0][0])).toContain('sync');
    });

    it('a sync that throws at once is caught too', async () => {
        h.triggerNow.mockImplementation(() => { throw new Error('boom'); });
        const logs = await voiceLogs();

        await expect(enqueueLogsForSync(logs, { awaitSync: false })).resolves.toMatchObject({ queuedLogIds: logs.map(l => l.id) });
        expect(h.warn).toHaveBeenCalledTimes(1);
    });

    it('the default still awaits the sync: hand-filled saves are unchanged', async () => {
        let release!: () => void;
        h.triggerNow.mockReturnValue(new Promise<void>(r => { release = r; }));
        const logs = await voiceLogs();

        let done = false;
        const run = enqueueLogsForSync(logs).then(outcome => { done = true; return outcome; });
        await new Promise(r => setTimeout(r, 20));
        expect(done).toBe(false);          // still waiting for the sync
        release();
        await expect(run).resolves.toMatchObject({ queuedLogIds: logs.map(l => l.id) });
    });

    it('a sync that rejects still fails an awaited save as before (the default is unchanged)', async () => {
        h.triggerNow.mockRejectedValue(new Error('network down'));
        const logs = await voiceLogs();
        await expect(enqueueLogsForSync(logs)).rejects.toThrow('network down');
    });

    it('nothing queued (no resolvable target) starts no sync, either way', async () => {
        h.triggerNow.mockResolvedValue(undefined);
        await getDatabase().cropCycles.clear(); // no crop cycle: the log cannot be queued
        const logs = await voiceLogs();

        const outcome = await enqueueLogsForSync(logs, { awaitSync: false });

        expect(outcome.queuedLogIds).toEqual([]);
        expect(h.triggerNow).not.toHaveBeenCalled();
    });
});
