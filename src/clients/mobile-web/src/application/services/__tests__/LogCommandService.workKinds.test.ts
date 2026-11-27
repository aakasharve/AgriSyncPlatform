/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S4.2; CTO ruling Q3 A) - a recording that holds a kind of work this
 * person may not record. The REAL `LogCommandServiceImpl.confirmAndSave` over a real Dexie (fake-indexeddb) and the real sync queue: the closed
 * kinds are taken out before the write and the enqueue, so the phone's copy is exactly what the server receives; his words stay; the record says
 * which kinds were not saved; and a recording of ONLY closed kinds writes nothing at all, with words he can read.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { ACCESS_SCOPES_META_KEY } from '../../../infrastructure/storage/accessScopeStore';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { LogCommandServiceImpl } from '../LogCommandService';
import { enqueueLogsForSync } from '../../../features/logs/services/logSyncMutationService';
import { WorkKindsClosedError, kindsNotSavedOf } from '../../../features/workKinds/closedKinds';
import type { LogsRepository } from '../../ports';
import type { DailyLog } from '../../../types';

const FARM_ID = '44444444-4444-4444-8444-444444444444';

vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: { getCurrentFarmId: () => FARM_ID, setCurrentFarmId: vi.fn(), clearCurrentFarmId: vi.fn() },
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

const batchSave = vi.fn(async () => undefined);
const repo = { batchSave } as unknown as LogsRepository;

const SAID = 'दोन तास पाणी दिलं आणि खुरपणी केली';
const log = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: '55555555-5555-4555-8555-555555555551',
    date: '2026-11-27',
    context: { selection: [{ cropId: 'FARM_GLOBAL', cropName: 'Farm-wide', selectedPlotIds: [], selectedPlotNames: [] }] },
    dayOutcome: 'WORK_RECORDED',
    fullTranscript: SAID,
    cropActivities: [{ id: 'crop-1', title: 'खुरपणी', sourceText: 'खुरपणी केली' }],
    irrigation: [{ id: 'irr-1', durationHours: 2, sourceText: 'दोन तास पाणी दिलं' }],
    labour: [],
    inputs: [],
    machinery: [],
    meta: { createdAtISO: '2026-11-27T05:00:00.000Z' },
    ...over,
}) as unknown as DailyLog;

const limitTo = async (kinds: string[] | undefined) => {
    await getDatabase().appMeta.put({
        key: ACCESS_SCOPES_META_KEY,
        value: { receivedAtUtc: 'x', scopes: [{ farmId: FARM_ID, ownRecordsOnly: false, seeMoney: false, seeWages: false, seeAttendance: false, seeTests: false, seeCompliance: false, seeFarmOverview: false, ...(kinds && { workKinds: kinds }) }] },
        updatedAt: 'x',
    });
};

beforeEach(async () => {
    await Promise.all([getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
    await getDatabase().farms.put({ id: FARM_ID, payload: { id: FARM_ID }, updatedAt: '2026-11-27T00:00:00.000Z' });
    vi.clearAllMocks();
});

describe('PERM S4.2 - a closed kind is taken out in the save path', () => {
    it('a recording with crop work by a seat limited to water saves the water only, keeps his words, and says so', async () => {
        await limitTo(['irrigation']);
        const logs = [log()];
        await new LogCommandServiceImpl(repo).confirmAndSave(logs);

        const written = (batchSave.mock.calls[0] as unknown as [DailyLog[]])[0];
        expect(written).toHaveLength(1);
        expect(written[0].cropActivities).toEqual([]);
        expect(written[0].irrigation).toEqual([expect.objectContaining({ id: 'irr-1' })]);
        expect(written[0].fullTranscript).toBe(SAID);
        expect(kindsNotSavedOf(written)).toEqual(['cropActivities']);

        // The phone's copy IS what the server receives: no crop work on the wire, his words still there.
        await enqueueLogsForSync(logs, { triggerSync: false });
        const creates = (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.CreateDailyLog);
        expect(creates).toHaveLength(1);
        const content = (creates[0].payload as { content?: Record<string, unknown> }).content ?? {};
        expect(content.cropActivities).toBeUndefined();
        expect(content.irrigation).toEqual([expect.objectContaining({ id: 'irr-1' })]);
        expect(content.fullTranscript).toBe(SAID);
    });

    it('a recording with only forbidden kinds saves no empty record and keeps the clip (nothing written, words to read)', async () => {
        await limitTo(['irrigation']);
        const logs = [log({ irrigation: [] } as Partial<DailyLog>)];
        const saving = new LogCommandServiceImpl(repo).confirmAndSave(logs);
        await expect(saving).rejects.toBeInstanceOf(WorkKindsClosedError);
        const error = (await saving.catch((e: unknown) => e)) as WorkKindsClosedError;
        expect(error.kinds).toEqual(['cropActivities']);
        expect(error.messageIn('mr')).toBe('पीक काम नोंदवण्याची परवानगी नाही — मालकाला सांगा. जे बोललात ते फोनमध्ये ठेवलं आहे — काही हरवत नाही.');
        expect(error.messageIn('en')).toBe('You may not record Crop work — tell the owner. What you said is kept on this phone — nothing is lost.');
        expect(batchSave).not.toHaveBeenCalled();
        // the record he spoke is untouched (the review screen still shows it whole)
        expect(logs[0].cropActivities).toHaveLength(1);
    });

    it('a seat with no limit, and a phone that does not know the limit, save every kind exactly as before', async () => {
        await limitTo(undefined);
        await new LogCommandServiceImpl(repo).confirmAndSave([log()]);
        let written = (batchSave.mock.calls[0] as unknown as [DailyLog[]])[0];
        expect(written[0].cropActivities).toHaveLength(1);
        expect(kindsNotSavedOf(written)).toEqual([]);
        await getDatabase().appMeta.clear();
        await new LogCommandServiceImpl(repo).confirmAndSave([log({ id: '55555555-5555-4555-8555-555555555552' } as Partial<DailyLog>)]);
        written = (batchSave.mock.calls[1] as unknown as [DailyLog[]])[0];
        expect(written[0].cropActivities).toHaveLength(1);
    });

    it('observations and reminders are always saved, and keep a record that holds a closed kind alive', async () => {
        await limitTo(['irrigation']);
        const logs = [log({ irrigation: [], observations: [{ id: 'o1', textRaw: 'पानं पिवळी', sourceText: 'पानं पिवळी' }] } as unknown as Partial<DailyLog>)];
        await new LogCommandServiceImpl(repo).confirmAndSave(logs);
        const written = (batchSave.mock.calls[0] as unknown as [DailyLog[]])[0];
        expect(written[0].observations).toHaveLength(1);
        expect(written[0].cropActivities).toEqual([]);
        expect(kindsNotSavedOf(written)).toEqual(['cropActivities']);
    });
});
