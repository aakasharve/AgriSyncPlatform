// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the wire half of the voice auto-save.
 *
 * `create_daily_log` carries `autoSavedFromVoice: true` ONLY for a log the voice auto-save wrote (the server then
 * keeps it unconfirmed until his own "पक्कं आहे"). Every other save sends no such key at all — exactly the payload
 * older servers and older phones already know (P11). Checked against the CANONICAL zod schema, over the real
 * factory, real Dexie and the real queue.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LogCommandServiceImpl } from '../../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../../infrastructure/storage/DexieLogsRepository';
import { enqueueLogsForSync } from '../logSyncMutationService';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { markAutoSavedFromVoice } from '../../../../app/helpers/autoSavedVoiceLog';
import { LogVerificationStatus, type CropProfile, type DailyLog, type FarmerProfile, type LogScope } from '../../../../types';

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

async function writeAndQueue(mark: (l: DailyLog) => DailyLog) {
    const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance());
    const created = await service.createFromManual({ date: '2026-10-26', labour: [{ id: 'lab-1', type: 'HIRED', count: 4 }] } as never, scope, [grapes], owner);
    const logs = created.map(mark);
    await service.confirmAndSave(logs);
    await enqueueLogsForSync(logs);
    const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray();
    return { logs, payloads: rows.map(r => r.payload as Record<string, unknown>) };
}

describe('create_daily_log — autoSavedFromVoice on the wire', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await Promise.all([db.mutationQueue.clear(), db.logs.clear(), db.farms.clear(), db.plots.clear(), db.cropCycles.clear()]);
        localStorage.clear();
        await seed();
    });

    it('a voice auto-saved log sends autoSavedFromVoice: true, and the canonical schema accepts it', async () => {
        const { logs, payloads } = await writeAndQueue(markAutoSavedFromVoice);
        expect(payloads).toHaveLength(1);
        expect(payloads[0].autoSavedFromVoice).toBe(true);
        expect(payloads[0].dailyLogId).toBe(logs[0].id);
        expect(validatePayload(SyncMutationName.CreateDailyLog, payloads[0])).toEqual({ ok: true });
        // And the copy written to the phone starts unconfirmed: only his "पक्कं आहे" may confirm it.
        expect(logs[0].verification?.status).toBe(LogVerificationStatus.DRAFT);
    });

    it('L6b: what he TYPED to Sathi rides the SAME unconfirmed create — the typed mark stays on the phone', async () => {
        const { logs, payloads } = await writeAndQueue(l => markAutoSavedFromVoice(l, { typed: true }));
        expect(payloads).toHaveLength(1);
        expect(payloads[0].autoSavedFromVoice).toBe(true); // the server keeps it Draft: no self-attestation, even the owner's
        // Additive nothing: no new key, no recording named (old servers and every installed phone read it as today).
        expect(Object.keys(payloads[0])).not.toContain('typedEntry');
        expect(Object.keys(payloads[0])).not.toContain('voiceClipId');
        expect(validatePayload(SyncMutationName.CreateDailyLog, payloads[0])).toEqual({ ok: true });
        expect(logs[0].typedEntry).toBe(true);
        expect(logs[0].verification?.status).toBe(LogVerificationStatus.DRAFT);
    });

    it('any other save sends NO such key (the payload older servers already accept)', async () => {
        const { payloads } = await writeAndQueue(l => l);
        expect(payloads).toHaveLength(1);
        expect(Object.prototype.hasOwnProperty.call(payloads[0], 'autoSavedFromVoice')).toBe(false);
        expect(validatePayload(SyncMutationName.CreateDailyLog, payloads[0])).toEqual({ ok: true });
    });
});
