// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane L8b-2 fix round 1 - B001 (a refused switch gives the server's choice back), B003 + B008 (the upload runs
 * after the server's rows; a same-schedule refusal is no conflict), B004 (the purge reaches the choices), B006 (the switch names
 * its "from"), B007 (what the download wrote is not a choice), B011 (one re-pull for the new key), B014 (the current season),
 * B015 (Forbidden words only for a schedule choice).
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
import { reconcileAccessScopes } from '../accessScopeReconciler';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { categorizeRejection } from '../../../../../infrastructure/sync/RejectionPolicy';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { FarmAccessScopeDto, ScheduleSubscriptionDto } from '../../../../../infrastructure/api/dtos';
import { DexieCropsRepository } from '../../../../../infrastructure/storage/DexieCropsRepository';
import { readPlotChoices, bestActive } from '../../../../scheduler/schedulePage/scheduleSubscriptions';
import { saveScheduleChoice } from '../../../../scheduler/schedulePage/saveScheduleChoice';
import { uploadHeldScheduleChoices } from '../../../../scheduler/schedulePage/uploadHeldScheduleChoices';
import { settleScheduleSubscriptions, SCHEDULE_SUBSCRIPTIONS_MARKER_KEY } from '../../../../scheduler/schedulePage/scheduleSubscriptionsMarker';
import { LOGS_REBUILD_MARKER_KEY } from '../../logsRebuildMarker';
import { ConflictResolutionService, SCHEDULE_CHANGED_ELSEWHERE_CODE } from '../../../conflict/ConflictResolutionService';
import { SERVER_TEMPLATE, SPRAY_TEMPLATE, SPRAY_TEMPLATE_ID, TEMPLATE_ID, crop, plot } from '../../../../scheduler/schedulePage/__tests__/scheduleFixtures';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PLOT = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_PLOT = 'aaaaaaaa-0000-4000-8000-000000000002';
const CYCLE = 'cccccccc-0000-4000-8000-000000000001';
const OLD_CYCLE = 'cccccccc-0000-4000-8000-000000000009';
const SRV_1 = 'dddddddd-0000-4000-8000-000000000001';
const SRV_2 = 'dddddddd-0000-4000-8000-000000000002';
const THEIR_ID = 'dddddddd-0000-4000-8000-000000000003';
const AT = '2026-11-02T06:00:00.000Z';

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

const queueRows = async () => (await getDatabase().mutationQueue.toArray()).filter(r =>
    r.mutationType === SyncMutationName.AdoptSchedule || r.mutationType === SyncMutationName.MigrateSchedule);
const choiceOfPlot = async (plotId = PLOT) => (await readPlotChoices()).get(plotId);
const park = (clientRequestId: string, errorCode: string) =>
    getDatabase().mutationQueue.where('[deviceId+clientRequestId]').equals([mutationQueue.getDeviceId(), clientRequestId])
        .modify({ status: 'REJECTED_USER_REVIEW', errorCode, lastError: 'refused' });

async function seedSeason(plotId = PLOT, cycleId = CYCLE) {
    const db = getDatabase();
    await db.plots.put({ id: plotId, farmId: FARM, payload: {}, updatedAt: AT });
    await db.cropCycles.put({ id: cycleId, farmId: FARM, plotId, updatedAt: AT, payload: { id: cycleId, farmId: FARM, plotId, cropName: 'Grapes', stage: 'x', startDate: '2026-10-17' } });
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

describe('B001 - a refused switch gives the server\'s choice back', () => {
    it('a मुकादम without PlanWork switches -> Forbidden -> his phone shows the server\'s schedule again, with the parked words', async () => {
        await seedSeason();
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub()] })); // the server's choice: the spray schedule
        expect((await choiceOfPlot())?.templateId).toBe(SPRAY_TEMPLATE_ID);

        await saveScheduleChoice([{ plotId: PLOT, templateId: TEMPLATE_ID }]);
        expect((await choiceOfPlot())?.templateId).toBe(TEMPLATE_ID); // shown at once
        const [request] = await queueRows();
        expect(request.mutationType).toBe(SyncMutationName.MigrateSchedule);
        // the server's own row is untouched until it answers
        expect((await getDatabase().scheduleSubscriptions.get(SRV_1))?.state).toBe('Active');

        await park(request.clientRequestId, 'ShramSafal.Forbidden');
        await reconcileSyncPull(body()); // the very next ordinary pull; nothing is re-sent, no full re-pull
        expect((await choiceOfPlot())?.templateId).toBe(SPRAY_TEMPLATE_ID);
        expect((await ConflictResolutionService.list())[0].hint).toBe('मालक तुम्हाला "कामाचं नियोजन करणे" देऊ शकतात.');
    });

    it('discarding the parked switch gives the plot back to the server\'s choice at once', async () => {
        await seedSeason();
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub()] }));
        await saveScheduleChoice([{ plotId: PLOT, templateId: TEMPLATE_ID }]);
        const [request] = await queueRows();
        await park(request.clientRequestId, 'ShramSafal.Forbidden');
        await ConflictResolutionService.discard(request.clientRequestId);
        expect((await choiceOfPlot())?.templateId).toBe(SPRAY_TEMPLATE_ID);
    });
});

describe('B006 - the switch names its "from"; two offline switches are never both applied', () => {
    it('the switch carries fromSubscriptionId = the subscription this phone believed active; a refused adopt\'s pending id too', async () => {
        await seedSeason();
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub()] }));
        await saveScheduleChoice([{ plotId: PLOT, templateId: TEMPLATE_ID }]);
        const [first] = await queueRows();
        expect(first.payload).toMatchObject({ fromSubscriptionId: SRV_1 });
        // a second switch queued behind the first names the first's (pending) id
        await saveScheduleChoice([{ plotId: PLOT, templateId: SPRAY_TEMPLATE_ID }]);
        const rows = await queueRows();
        expect(rows).toHaveLength(2);
        expect(rows[1].payload).toMatchObject({ fromSubscriptionId: (first.payload as { newSubscriptionId: string }).newSubscriptionId });
    });

    it('ScheduleChangedElsewhere is permanent, parked with its words, and the server\'s choice is shown', async () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.ScheduleChangedElsewhere' })).toBe('PERMANENT');
        await seedSeason();
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub({ id: SRV_2, scheduleTemplateId: SPRAY_TEMPLATE_ID })] }));
        await saveScheduleChoice([{ plotId: PLOT, templateId: TEMPLATE_ID }]);
        const [request] = await queueRows();
        await park(request.clientRequestId, SCHEDULE_CHANGED_ELSEWHERE_CODE);
        await reconcileSyncPull(body());
        expect((await choiceOfPlot())?.templateId).toBe(SPRAY_TEMPLATE_ID);
        expect((await ConflictResolutionService.list())[0].hint).toBe('दुसऱ्या फोनवरून आधीच शेड्यूल बदललं आहे. आता सर्व फोनवर सर्व्हरचं शेड्यूल दिसेल.');
    });
});

describe('B012 - two phones, offline: BOTH end on the server choice', () => {
    it('phone B (refused) shows A schedule; phone A (accepted) shows its own, from the server row under its own id', async () => {
        await seedSeason();
        await reconcileSyncPull(body());
        // phone B: chose TEMPLATE offline; the server kept phone A choice (SPRAY) and refused this adopt.
        await saveScheduleChoice([{ plotId: PLOT, templateId: TEMPLATE_ID }]);
        const [request] = await queueRows();
        await park(request.clientRequestId, 'ShramSafal.ScheduleAlreadyAdopted');
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub({ id: THEIR_ID, scheduleTemplateId: SPRAY_TEMPLATE_ID })] }));
        const phoneB = await choiceOfPlot();
        expect([phoneB?.id, phoneB?.templateId, phoneB?.pending]).toEqual([THEIR_ID, SPRAY_TEMPLATE_ID, undefined]);

        // phone A (the one the server accepted): its own pending row is replaced by the server row under the same id.
        await getDatabase().scheduleSubscriptions.clear();
        await getDatabase().mutationQueue.clear();
        await saveScheduleChoice([{ plotId: PLOT, templateId: SPRAY_TEMPLATE_ID }]);
        const mine = (await getDatabase().scheduleSubscriptions.toArray())[0];
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub({ id: mine.id, scheduleTemplateId: SPRAY_TEMPLATE_ID })] }));
        const phoneA = await choiceOfPlot();
        expect([phoneA?.id, phoneA?.templateId, phoneA?.pending]).toEqual([mine.id, SPRAY_TEMPLATE_ID, undefined]);
        expect(phoneA?.templateId).toBe(phoneB?.templateId); // the same schedule on both
    });
});

describe('B003 + B008 - the upload follows the server\'s rows; the same schedule is no conflict', () => {
    it('a second phone of the farm upgrades: nothing is re-sent for a plot the server holds', async () => {
        await seedSeason();
        // This phone held the spray schedule from before the upgrade (the crop field)...
        await new DexieCropsRepository().save([crop([plot({ id: PLOT, schedule: { ...plot().schedule, plotId: PLOT, templateId: SPRAY_TEMPLATE_ID } })], { id: 'c1', activeScheduleId: SPRAY_TEMPLATE_ID })]);
        // ...and the first pull of the new version brings the server's row for the plot (the other phone's choice).
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub({ scheduleTemplateId: TEMPLATE_ID })] }));
        expect(await queueRows()).toHaveLength(0);
        expect((await choiceOfPlot())?.templateId).toBe(TEMPLATE_ID);
    });

    it('a ScheduleAlreadyAdopted refusal whose server schedule is the SAME as his: pending row dropped, nothing parked', async () => {
        await seedSeason();
        await reconcileSyncPull(body());
        await saveScheduleChoice([{ plotId: PLOT, templateId: SPRAY_TEMPLATE_ID }]);
        const [request] = await queueRows();
        await park(request.clientRequestId, 'ShramSafal.ScheduleAlreadyAdopted');
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub({ id: THEIR_ID, scheduleTemplateId: SPRAY_TEMPLATE_ID })] }));
        expect((await choiceOfPlot())?.id).toBe(THEIR_ID);
        expect(await ConflictResolutionService.list()).toHaveLength(0); // nothing parked for him to resolve
    });

    it('a DIFFERENT schedule is parked, with the words', async () => {
        await seedSeason();
        await reconcileSyncPull(body());
        await saveScheduleChoice([{ plotId: PLOT, templateId: TEMPLATE_ID }]);
        const [request] = await queueRows();
        await park(request.clientRequestId, 'ShramSafal.ScheduleAlreadyAdopted');
        await reconcileSyncPull(body({ scheduleSubscriptions: [sub({ id: THEIR_ID, scheduleTemplateId: SPRAY_TEMPLATE_ID })] }));
        expect((await choiceOfPlot())?.templateId).toBe(SPRAY_TEMPLATE_ID);
        expect((await ConflictResolutionService.list())[0].hint).toContain('दुसऱ्या फोनवरून वेगळं शेड्यूल निवडलं आहे');
    });
});

describe('B007 - what the download wrote is not a choice', () => {
    it('a plot whose schedule equals the id the download wrote as the crop default is not uploaded; an explicit plot choice is', async () => {
        await seedSeason();
        await seedSeason(OTHER_PLOT, 'cccccccc-0000-4000-8000-000000000002');
        const db = getDatabase();
        // The download wrote SPRAY as this crop's default (recorded); plot 1 simply follows it, plot 2 chose it for itself.
        const downloaded = crop([
            plot({ id: PLOT, schedule: { ...plot().schedule, plotId: PLOT, templateId: SPRAY_TEMPLATE_ID } }),
            plot({ id: OTHER_PLOT, name: 'B', schedule: { ...plot().schedule, plotId: OTHER_PLOT, templateId: SPRAY_TEMPLATE_ID, plotChoice: true } as never }),
        ], { id: 'c1', activeScheduleId: SPRAY_TEMPLATE_ID });
        (downloaded as unknown as Record<string, unknown>).downloadedDefaultScheduleId = SPRAY_TEMPLATE_ID;
        await new DexieCropsRepository().save([downloaded]);
        await uploadHeldScheduleChoices(db);
        expect((await queueRows()).map(r => (r.payload as { plotId: string }).plotId)).toEqual([OTHER_PLOT]);
    });
});

describe('B011 - one re-pull for the new key', () => {
    it('marker absent -> one since=0 pull is asked for; the full pull sets the marker; present -> no extra pull', async () => {
        const db = getDatabase();
        const sent = { scheduleSubscriptions: [] };
        expect(await settleScheduleSubscriptions(db, {}, false)).toBe('older-server'); // an older server never asks anything
        expect(await db.appMeta.get(LOGS_REBUILD_MARKER_KEY)).toBeUndefined();

        await db.appMeta.put({ key: LOGS_REBUILD_MARKER_KEY, value: {}, updatedAt: AT });
        expect(await settleScheduleSubscriptions(db, sent, false)).toBe('requested');
        expect(await db.appMeta.get(LOGS_REBUILD_MARKER_KEY)).toBeUndefined(); // the next pull starts from the beginning
        expect(await db.appMeta.get(SCHEDULE_SUBSCRIPTIONS_MARKER_KEY)).toBeUndefined();

        expect(await settleScheduleSubscriptions(db, sent, true)).toBe('done'); // that full pull
        expect(await db.appMeta.get(SCHEDULE_SUBSCRIPTIONS_MARKER_KEY)).toBeDefined();

        await db.appMeta.put({ key: LOGS_REBUILD_MARKER_KEY, value: {}, updatedAt: AT });
        expect(await settleScheduleSubscriptions(db, sent, false)).toBe('done');
        expect(await db.appMeta.get(LOGS_REBUILD_MARKER_KEY)).toBeDefined(); // no extra pull asked
    });
});

describe('B014 - the plot\'s current season', () => {
    it('an older season\'s Active row never wins', async () => {
        await seedSeason(PLOT, CYCLE);
        const old = { id: 'old-row', farmId: FARM, plotId: PLOT, cropCycleId: OLD_CYCLE, templateId: SPRAY_TEMPLATE_ID, referenceDate: null, state: 'Active' as const, adoptedAtUtc: '2026-12-01T00:00:00Z' };
        const current = { ...old, id: 'new-row', cropCycleId: CYCLE, templateId: TEMPLATE_ID, adoptedAtUtc: '2026-10-20T00:00:00Z' };
        expect(bestActive([old, current])?.id).toBe('old-row'); // by adoption time alone the older season would win...
        expect(bestActive([old, current], CYCLE)?.id).toBe('new-row'); // ...it must not
        const db = getDatabase();
        await db.scheduleSubscriptions.bulkPut([old, current]);
        expect((await choiceOfPlot())?.id).toBe('new-row');
    });
});

describe('B004 - the purge reaches the schedule choices', () => {
    const scope = (over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({
        farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: false, seeAttendance: true, seeTests: true, seeCompliance: true, seeFarmOverview: true, ...over,
    });
    const run = (scopes: FarmAccessScopeDto[]) => {
        const db = getDatabase();
        return db.transaction('rw', [
            db.logs, db.attachments, db.uploadQueue, db.appMeta, db.farms, db.plots, db.cropCycles, db.costEntries,
            db.financeCorrections, db.dayLedgers, db.plannedTasks, db.attentionCards, db.attendanceMarks, db.jobCards,
            db.testInstances, db.testRecommendations, db.complianceSignals, db.crops, db.farmerProfile, db.scheduleSubscriptions,
        ], () => reconcileAccessScopes(db, { accessScopes: scopes } as unknown as SyncPullResponse, { userId: 'me', pendingLogIds: new Set(), receivedAtUtc: AT }));
    };
    async function seed() {
        const db = getDatabase();
        await db.farms.put({ id: FARM, payload: { id: FARM, ownerUserId: 'someone-else' }, updatedAt: AT });
        await seedSeason(PLOT, CYCLE);
        await seedSeason(OTHER_PLOT, 'cccccccc-0000-4000-8000-000000000002');
        await db.scheduleSubscriptions.bulkPut([
            { id: 's-1', farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, templateId: TEMPLATE_ID, referenceDate: null, state: 'Active', adoptedAtUtc: AT },
            { id: 's-2', farmId: FARM, plotId: OTHER_PLOT, cropCycleId: 'cccccccc-0000-4000-8000-000000000002', templateId: TEMPLATE_ID, referenceDate: null, state: 'Active', adoptedAtUtc: AT },
        ]);
    }
    const left = async () => (await getDatabase().scheduleSubscriptions.toArray()).map(r => r.id).sort();

    it('chosen-plots narrowing: only his plots\' choices stay', async () => {
        await seed();
        await run([scope({ plotScope: 'ChosenPlots', plotIds: [PLOT] })]);
        expect(await left()).toEqual(['s-1']);
    });

    it('farm removal: the farm\'s choices go', async () => {
        await seed();
        await run([scope({ status: 'Removed', ownRecordsOnly: false })]);
        expect(await left()).toEqual([]);
    });

    it('loss of the farm overview: the choices go (the rule the server sends them under)', async () => {
        await seed();
        await run([scope({ seeFarmOverview: false, ownRecordsOnly: true })]);
        expect(await left()).toEqual([]);
    });
});

describe('B015 - Forbidden words only for a schedule choice', () => {
    const parked = (type: string, id: string) => getDatabase().mutationQueue.add({
        deviceId: mutationQueue.getDeviceId(), clientRequestId: id, clientCommandId: id, mutationType: type, payload: {},
        status: 'REJECTED_USER_REVIEW', createdAt: 'x', updatedAt: 'x', retryCount: 0, lastError: 'refused', errorCode: 'ShramSafal.Forbidden',
    });

    it('adopt and migrate say the owner can give "कामाचं नियोजन करणे"; every other mutation keeps its words as at base', async () => {
        await parked(SyncMutationName.AdoptSchedule, 'a');
        await parked(SyncMutationName.MigrateSchedule, 'b');
        await parked(SyncMutationName.CreateDailyLog, 'c');
        const hints = Object.fromEntries((await ConflictResolutionService.list()).map(v => [v.mutationType, v.hint]));
        expect(hints[SyncMutationName.AdoptSchedule]).toBe('मालक तुम्हाला "कामाचं नियोजन करणे" देऊ शकतात.');
        expect(hints[SyncMutationName.MigrateSchedule]).toBe('मालक तुम्हाला "कामाचं नियोजन करणे" देऊ शकतात.');
        // base behaviour for the others: the text 'refused' names no authority word, so no hint is invented
        expect(hints[SyncMutationName.CreateDailyLog]).toBeUndefined();
    });
});
