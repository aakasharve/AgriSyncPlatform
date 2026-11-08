// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane L8b-1F Task 4 (R7, R8; P10, P11):
 *   - the one-time upload sends `carryOver: true` once per plot (and a choice made now does not);
 *   - ShramSafal.ScheduleNotChecked / ShramSafal.OwnScheduleNotOpenYet are PERMANENT, parked with their words, and the phone's
 *     choice stays visible (nothing dropped);
 *   - the pull's new `checkState` / `origin` are kept when sent and absent when not (an older server).
 */
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../infrastructure/reference/TemplateCatalog', async importOriginal => ({
    ...(await importOriginal<object>()),
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));
vi.mock('../../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

import { reconcileSyncPull } from '../../SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { categorizeRejection, getPermanentRejectionCodes } from '../../../../../infrastructure/sync/RejectionPolicy';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { ScheduleSubscriptionDto } from '../../../../../infrastructure/api/dtos';
import { DexieCropsRepository } from '../../../../../infrastructure/storage/DexieCropsRepository';
import { readPlotChoices } from '../../../../scheduler/schedulePage/scheduleSubscriptions';
import { saveScheduleChoice } from '../../../../scheduler/schedulePage/saveScheduleChoice';
import { uploadHeldScheduleChoices } from '../../../../scheduler/schedulePage/uploadHeldScheduleChoices';
import {
    ConflictResolutionService,
    OWN_SCHEDULE_NOT_OPEN_YET_CODE,
    SCHEDULE_NOT_CHECKED_CODE,
} from '../../../conflict/ConflictResolutionService';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, SPRAY_TEMPLATE_ID, TEMPLATE_ID, crop, plot } from '../../../../scheduler/schedulePage/__tests__/scheduleFixtures';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PLOT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CYCLE = 'cccccccc-0000-4000-8000-000000000001';
const SRV_1 = 'dddddddd-0000-4000-8000-000000000001';
const AT = '2026-11-08T06:00:00.000Z';

const body = (over: Partial<SyncPullResponse> = {}): SyncPullResponse => ({
    serverTimeUtc: AT, nextCursorUtc: AT,
    farms: [{ id: FARM, name: 'F', ownerUserId: 'u', createdAtUtc: 'x', modifiedAtUtc: 'x' }],
    plots: [{ id: PLOT, farmId: FARM, name: 'A', areaInAcres: 1, createdAtUtc: 'x', modifiedAtUtc: 'x' }],
    cropCycles: [{ id: CYCLE, farmId: FARM, plotId: PLOT, cropName: 'Grapes', stage: 'x', startDate: '2026-10-17', createdAtUtc: 'x', modifiedAtUtc: 'x' }],
    dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [],
    operators: [{ userId: 'u', displayName: 'U', role: 'PRIMARY_OWNER' }], scheduleTemplates: [], activityCategories: [], costCategories: [],
    referenceDataVersionHash: 'h', cropTypes: [{ name: 'Grapes', stages: [], defaultTemplateId: TEMPLATE_ID }], scheduleSubscriptions: [],
    ...over,
} as unknown as SyncPullResponse);

const sub = (over: Partial<ScheduleSubscriptionDto> = {}): ScheduleSubscriptionDto => ({
    id: SRV_1, farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, cropKey: 'grapes', scheduleTemplateId: SPRAY_TEMPLATE_ID,
    scheduleVersionTag: 'v', adoptedAtUtc: '2026-10-20T00:00:00Z', state: 'Active', referenceDate: null, ...over,
});

const adopts = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.AdoptSchedule);
const park = (clientRequestId: string, errorCode: string) =>
    getDatabase().mutationQueue.where('[deviceId+clientRequestId]').equals([mutationQueue.getDeviceId(), clientRequestId])
        .modify({ status: 'REJECTED_USER_REVIEW', errorCode, lastError: 'refused' });

async function seedSeason() {
    const db = getDatabase();
    await db.plots.put({ id: PLOT, farmId: FARM, payload: {}, updatedAt: AT });
    await db.cropCycles.put({ id: CYCLE, farmId: FARM, plotId: PLOT, updatedAt: AT, payload: { id: CYCLE, farmId: FARM, plotId: PLOT, cropName: 'Grapes', stage: 'x', startDate: '2026-10-17' } });
}

beforeAll(async () => {
    const actual = await vi.importActual<typeof import('../../../../../infrastructure/reference/TemplateCatalog')>('../../../../../infrastructure/reference/TemplateCatalog');
    actual.setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]);
});
beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.crops.clear(), db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.appMeta.clear(), db.plots.clear(), db.cropCycles.clear(), db.farms.clear()]);
});

describe('the one-time upload says carryOver (R7)', () => {
    const heldChoice = () => new DexieCropsRepository().save([
        crop([plot({
            id: PLOT,
            schedule: { id: `sch-${PLOT}`, plotId: PLOT, templateId: SPRAY_TEMPLATE_ID, referenceType: 'PRUNING', referenceDate: REF, stageOverrides: [], expectationOverrides: [] } as ReturnType<typeof plot>['schedule'],
        })], { id: 'crop-chosen', activeScheduleId: SPRAY_TEMPLATE_ID }),
    ]);

    it('the adopt it sends carries carryOver: true, once', async () => {
        await seedSeason();
        await heldChoice();

        expect(await uploadHeldScheduleChoices(getDatabase())).toBe('sent');
        expect(await uploadHeldScheduleChoices(getDatabase())).toBe('waiting');

        const rows = await adopts();
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toMatchObject({ plotId: PLOT, scheduleTemplateId: SPRAY_TEMPLATE_ID, carryOver: true });
    });

    it('a choice made now on the page is a NEW choice: no carryOver', async () => {
        await seedSeason();
        await saveScheduleChoice([{ plotId: PLOT, templateId: SPRAY_TEMPLATE_ID }]);

        const rows = await adopts();
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).not.toHaveProperty('carryOver');
    });
});

describe('the two new refusals (L8b-1F)', () => {
    it('are PERMANENT, parked with their words, and the phone keeps his choice visible', async () => {
        expect(categorizeRejection({ errorCode: SCHEDULE_NOT_CHECKED_CODE })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: OWN_SCHEDULE_NOT_OPEN_YET_CODE })).toBe('PERMANENT');
        expect(getPermanentRejectionCodes()).toEqual(expect.arrayContaining(['ScheduleNotChecked', 'OwnScheduleNotOpenYet']));

        for (const [code, words] of [
            [SCHEDULE_NOT_CHECKED_CODE, 'हे शेड्यूल श्रमसफलने अजून तपासलेलं नाही'],
            [OWN_SCHEDULE_NOT_OPEN_YET_CODE, 'तुमचं स्वतःचं शेड्यूल अजून सुरू झालेलं नाही'],
        ] as const) {
            await getDatabase().mutationQueue.clear();
            await getDatabase().scheduleSubscriptions.clear();
            await seedSeason();
            await saveScheduleChoice([{ plotId: PLOT, templateId: SPRAY_TEMPLATE_ID }]);
            const [request] = await adopts();
            await park(request.clientRequestId, code);

            await reconcileSyncPull(body()); // the next ordinary pull; the server holds no row for the plot

            expect((await readPlotChoices()).get(PLOT)?.templateId).toBe(SPRAY_TEMPLATE_ID); // never dropped (P10)
            expect((await ConflictResolutionService.list())[0].hint).toBe(words);
        }
    });
});

describe('the pull\'s checkState / origin (P11)', () => {
    it('are kept when the server sends them', async () => {
        await seedSeason();
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub({ checkState: 'Withdrawn', origin: 'Outside' })] }));

        const row = await getDatabase().scheduleSubscriptions.get(SRV_1);
        expect(row).toMatchObject({ state: 'Active', checkState: 'Withdrawn', origin: 'Outside' });
        expect((await readPlotChoices()).get(PLOT)).toMatchObject({ templateId: SPRAY_TEMPLATE_ID, checkState: 'Withdrawn' });
    });

    it('are simply absent from an older server\'s rows, and the row is the same otherwise', async () => {
        await seedSeason();
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub()] }));
        const without = await getDatabase().scheduleSubscriptions.get(SRV_1);

        await getDatabase().scheduleSubscriptions.clear();
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub({ checkState: 'NotChecked', origin: null })] }));
        const withFields = await getDatabase().scheduleSubscriptions.get(SRV_1);

        expect(without).not.toHaveProperty('checkState');
        expect(without).not.toHaveProperty('origin');
        const { checkState: _c, origin: _o, ...rest } = withFields!;
        expect(rest).toEqual(without);
    });

    it('an unreadable word is left out, never guessed', async () => {
        await seedSeason();
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub({ checkState: 'Mystery' as never, origin: 'Elsewhere' as never })] }));
        const row = await getDatabase().scheduleSubscriptions.get(SRV_1);
        expect(row).not.toHaveProperty('checkState');
        expect(row).not.toHaveProperty('origin');
    });
});
