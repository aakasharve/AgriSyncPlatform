// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P2) - the pull's `farmSetup` key, through the real `reconcileSyncPull` over a
 * fake-indexeddb phone database, and the pull's query. The phone ASKS with `farmSetup=1` beside `scheduleFormat`. The key is FULL on every pull: each
 * listed farm replaces its rows whole; a farm the pull does not list keeps its rows. An ABSENT key (an old server) leaves every store as it was - the
 * old-phone safety rule. An unreadable entry or row is skipped, and nothing here ever throws into the pull.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../infrastructure/reference/TemplateCatalog', async importOriginal => ({
    ...(await importOriginal<object>()),
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));
vi.mock('../../../../../infrastructure/storage/AuthTokenStore', async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAuthSession: () => ({ userId: '0a0a0a0a-0000-4000-8000-00000000000a' }),
}));

import { reconcileSyncPull } from '../../SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../../../infrastructure/storage/DexieFarmSetupRepository';
import { pullSyncChanges } from '../../../../../infrastructure/api/resources/SyncResource';
import type { HttpTransport } from '../../../../../infrastructure/api/transport';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import { FARM_A, FARM_B, SOURCE_A, emptyFarmDto, fullFarmDto } from '../../../../../infrastructure/storage/__tests__/farmSetupFixtures';

const pull = (extra: Record<string, unknown> = {}): SyncPullResponse => ({
    serverTimeUtc: '2026-11-27T06:00:00.000Z', nextCursorUtc: '2026-11-27T06:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', ...extra,
} as unknown as SyncPullResponse);

const farmB = () => ({ ...fullFarmDto(), farmId: FARM_B, waterSources: [], machines: [], plotWater: [] });
const repo = () => new DexieFarmSetupRepository(getDatabase());
const counts = async () => {
    const db = getDatabase();
    return [await db.farmWaterSources.count(), await db.farmMachines.count(), await db.farmPowerTimes.count(), await db.plotWater.count()];
};

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear(), db.appMeta.clear()]);
});

describe('the pull asks for the farm setup', () => {
    it('sends farmSetup=1 beside scheduleFormat on every pull', async () => {
        const get = vi.fn().mockResolvedValue({ data: {} });
        const t = { http: { get } } as unknown as HttpTransport;
        await pullSyncChanges(t, '2026-11-01T06:00:00.123Z', []);
        expect(get).toHaveBeenLastCalledWith('/sync/pull', { params: { since: '2026-11-01T06:00:00Z', farms: '', scheduleFormat: 2, farmSetup: 1, seenBy: 1 } });
        await pullSyncChanges(t);
        expect(get).toHaveBeenLastCalledWith('/sync/pull', { params: { scheduleFormat: 2, farmSetup: 1, seenBy: 1 } });
    });
});

describe('farmSetup on the pull (P2)', () => {
    it('an absent key leaves the stores as they are', async () => {
        await reconcileSyncPull(pull({ farmSetup: [fullFarmDto(), farmB()] }));
        const before = await counts();
        expect(before).toEqual([1, 1, 2, 1]);
        // an old server: no key at all; and a JSON null is no answer either
        await reconcileSyncPull(pull());
        await reconcileSyncPull(pull({ farmSetup: null }));
        expect(await counts()).toEqual(before);
        expect((await repo().read(FARM_A))!.waterSources.map(s => s.id)).toEqual([SOURCE_A]);
    });

    it('a listed farm is replaced whole; a farm the pull does not list keeps its rows', async () => {
        await reconcileSyncPull(pull({ farmSetup: [fullFarmDto(), farmB()] }));
        await reconcileSyncPull(pull({ farmSetup: [emptyFarmDto(FARM_A)] }));
        const a = await repo().read(FARM_A);
        expect(a).toMatchObject({ waterSources: [], machines: [], plotWater: [], powerTimes: null });
        expect((await repo().read(FARM_B))!.powerTimes?.revision).toBe(1);
    });

    it('an unreadable entry is skipped and the readable ones still land; nothing throws into the pull', async () => {
        await expect(reconcileSyncPull(pull({ farmSetup: [{ farmId: 'nope' }, 7, fullFarmDto()] }))).resolves.toBeUndefined();
        expect((await repo().read(FARM_A))!.waterSources).toHaveLength(1);
        await expect(reconcileSyncPull(pull({ farmSetup: 'not a list' }))).resolves.toBeUndefined();
        expect((await repo().read(FARM_A))!.waterSources).toHaveLength(1);
    });

    it('an empty list is an answer about no farm: nothing is removed', async () => {
        await reconcileSyncPull(pull({ farmSetup: [fullFarmDto()] }));
        await reconcileSyncPull(pull({ farmSetup: [] }));
        expect(await counts()).toEqual([1, 1, 1, 1]);
    });

    it('a farm the server says he no longer reads (a paused seat: farmSetup []) leaves the phone with its setup', async () => {
        await reconcileSyncPull(pull({ farmSetup: [fullFarmDto(), farmB()] }));
        const paused = { farmId: FARM_B, status: 'Paused', ownRecordsOnly: false, seeMoney: false, seeWages: false, seeAttendance: false, seeTests: false, seeCompliance: false, seeFarmOverview: false };
        const active = { farmId: FARM_A, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true, seeCompliance: true, seeFarmOverview: true };
        await reconcileSyncPull(pull({ farmSetup: [fullFarmDto()], accessScopes: [active, paused] }));
        expect(await repo().read(FARM_B)).toBeNull();
        expect((await repo().read(FARM_A))!.waterSources).toHaveLength(1);
    });
});
