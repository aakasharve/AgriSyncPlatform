// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2 Task 5; P10, P11) - the schedule choices this phone ALREADY
 * HOLDS go up once. Only a schedule somebody chose ('adopted' / 'plot'), never the crop-type default ('default'); once -
 * the `appMeta` mark is written only after the server has answered; a refusal keeps the phone's choice visible and parked.
 */
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { DexieCropsRepository } from '../../../../infrastructure/storage/DexieCropsRepository';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { HELD_CHOICES_REQUESTS_KEY, HELD_CHOICES_UPLOADED_KEY, uploadHeldScheduleChoices } from '../uploadHeldScheduleChoices';
import { readPlotChoices } from '../scheduleSubscriptions';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, SPRAY_TEMPLATE_ID, TEMPLATE_ID, crop, plot } from './scheduleFixtures';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

const FARM = '11111111-1111-4111-8111-111111111111';
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const cycleOf = (plotId: string) => plotId.replace('aaaaaaaa', 'cccccccc');

const sched = (plotId: string, templateId: string, referenceDate = REF) =>
    ({ id: `sch-${plotId}`, plotId, templateId, referenceType: 'PRUNING', referenceDate, stageOverrides: [], expectationOverrides: [] }) as ReturnType<typeof plot>['schedule'];

async function seed(withSeasons = true) {
    const db = getDatabase();
    await new DexieCropsRepository().save([
        // A crop whose farmer chose the spray schedule in the library: both its plots follow it; plot 1 also moved its day 0.
        crop([plot({ id: P1, schedule: sched(P1, SPRAY_TEMPLATE_ID, '2026-10-19') }), plot({ id: P2, schedule: sched(P2, SPRAY_TEMPLATE_ID) })],
            { id: 'crop-chosen', activeScheduleId: SPRAY_TEMPLATE_ID }),
        // A crop that only follows the library's default schedule: nobody chose it.
        // (B007) the id the download recorded as this crop's default.
        { ...crop([plot({ id: P3, schedule: sched(P3, TEMPLATE_ID) })], { id: 'crop-default', activeScheduleId: TEMPLATE_ID }), downloadedDefaultScheduleId: TEMPLATE_ID } as ReturnType<typeof crop>,
    ]);
    if (!withSeasons) return;
    for (const plotId of [P1, P2, P3]) {
        await db.plots.put({ id: plotId, farmId: FARM, payload: {}, updatedAt: 'x' });
        await db.cropCycles.put({ id: cycleOf(plotId), farmId: FARM, plotId, updatedAt: 'x', payload: { id: cycleOf(plotId), farmId: FARM, plotId, cropName: 'Grapes', stage: 'x', startDate: REF } });
    }
}

const uploads = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.AdoptSchedule);

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));
beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.crops.clear(), db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.appMeta.clear(), db.plots.clear(), db.cropCycles.clear()]);
});

describe('Task 5 - one-time upload of the choices this phone holds', () => {
    it('sends one adopt per plot that follows a CHOSEN schedule; a plot on the default sends nothing', async () => {
        await seed();
        expect(await uploadHeldScheduleChoices(getDatabase())).toBe('sent');

        const rows = await uploads();
        expect(rows.map(r => (r.payload as { plotId: string }).plotId).sort()).toEqual([P1, P2]);
        const one = rows.find(r => (r.payload as { plotId: string }).plotId === P1)!.payload as Record<string, unknown>;
        expect(one).toMatchObject({ farmId: FARM, cropCycleId: cycleOf(P1), scheduleTemplateId: SPRAY_TEMPLATE_ID, referenceDate: '2026-10-19' });
        const two = rows.find(r => (r.payload as { plotId: string }).plotId === P2)!.payload as Record<string, unknown>;
        expect(two).not.toHaveProperty('referenceDate'); // its day 0 is simply the season's start
        // The default plot is not a choice, and is not in the queue or in the store.
        expect((await getDatabase().scheduleSubscriptions.toArray()).map(r => r.plotId).sort()).toEqual([P1, P2]);
    });

    it('run twice -> one mutation per plot; the mark is written only AFTER the server has answered', async () => {
        await seed();
        const db = getDatabase();
        expect(await uploadHeldScheduleChoices(db)).toBe('sent');
        expect(await uploadHeldScheduleChoices(db)).toBe('waiting'); // asked again: nothing new, nothing marked
        expect(await uploads()).toHaveLength(2);
        expect(await db.appMeta.get(HELD_CHOICES_UPLOADED_KEY)).toBeUndefined();

        // The server answers both (accepted).
        await db.mutationQueue.where('mutationType').equals(SyncMutationName.AdoptSchedule).modify({ status: 'APPLIED' });
        expect(await uploadHeldScheduleChoices(db)).toBe('done');
        expect(await db.appMeta.get(HELD_CHOICES_UPLOADED_KEY)).toBeDefined();
        expect(await db.appMeta.get(HELD_CHOICES_REQUESTS_KEY)).toBeUndefined();
        expect(await uploadHeldScheduleChoices(db)).toBe('done');
        expect(await uploads()).toHaveLength(2); // never a third
    });

    it('a refusal keeps the phone\'s choice visible and parked (the mark is written: the server HAS answered)', async () => {
        await seed();
        const db = getDatabase();
        await uploadHeldScheduleChoices(db);
        await db.mutationQueue.where('mutationType').equals(SyncMutationName.AdoptSchedule)
            .modify({ status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.Forbidden', lastError: 'refused' });

        expect(await uploadHeldScheduleChoices(db)).toBe('done');
        const choices = await readPlotChoices();
        expect([...choices.keys()].sort()).toEqual([P1, P2]); // still his, still shown
        expect(choices.get(P1)).toMatchObject({ templateId: SPRAY_TEMPLATE_ID, pending: true });
        expect((await uploads()).every(r => r.status === 'REJECTED_USER_REVIEW')).toBe(true); // parked, not dropped
    });

    it('a plot that already has a choice row (the server\'s, or his own) is not sent again', async () => {
        await seed();
        await getDatabase().scheduleSubscriptions.put({
            id: 'srv-1', farmId: FARM, plotId: P1, cropCycleId: cycleOf(P1), templateId: SPRAY_TEMPLATE_ID, referenceDate: null, state: 'Active', adoptedAtUtc: '2026-10-20T00:00:00Z',
        });
        await uploadHeldScheduleChoices(getDatabase());
        expect((await uploads()).map(r => (r.payload as { plotId: string }).plotId)).toEqual([P2]);
    });

    it('nothing held -> nothing sent, and it is marked (a phone with no choice asks no more)', async () => {
        await new DexieCropsRepository().save([{ ...crop([plot({ id: P3, schedule: sched(P3, TEMPLATE_ID) })], { id: 'crop-default', activeScheduleId: TEMPLATE_ID }), downloadedDefaultScheduleId: TEMPLATE_ID } as ReturnType<typeof crop>]);
        expect(await uploadHeldScheduleChoices(getDatabase())).toBe('nothing-to-send');
        expect(await getDatabase().appMeta.get(HELD_CHOICES_UPLOADED_KEY)).toBeDefined();
        expect(await uploads()).toHaveLength(0);
    });

    it('a plot with no crop season on the server cannot be sent: nothing queued, the choice stays on this phone', async () => {
        await seed(false);
        expect(await uploadHeldScheduleChoices(getDatabase())).toBe('nothing-to-send');
        expect(await uploads()).toHaveLength(0);
        expect([...(await readPlotChoices()).keys()].sort()).toEqual([P1, P2]); // kept (pending), shown as his
    });
});
