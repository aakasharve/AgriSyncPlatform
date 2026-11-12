// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 3; D-83 = 1, P9, P10) - OFFLINE-FIRST writes. Create, clone and edit go through the
 * existing sync outbox as the contract's mutations (schedule.create / .clone / .edit), with client-minted ids and a clientCommandId, like every other
 * mutation - no REST from the maker. Each payload is checked against the contract's own Zod schema BEFORE it is queued (the queue does it), so a
 * payload the server would refuse by shape never leaves the phone. The phone decides nothing the server decides: it sends, the server answers.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../infrastructure/storage/AuthTokenStore', async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAuthSession: () => ({ userId: '0a0a0a0a-0000-4000-8000-00000000000a' }),
}));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { OwnScheduleChangeBlocked, saveOwnSchedule } from '../ownScheduleCommands';
import type { OwnStage, OwnWork } from '../ownScheduleModel';
import { FARM, OWNER, id } from './ownFixtures';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stages: OwnStage[] = [{ name: 'फुलोरा ते फळधारणा', startDay: 31, endDay: 60 }];
const work = (over: Partial<OwnWork> = {}): OwnWork => ({ name: 'ठिबक सिंचन', part: 'irrigation', startDay: 31, endDay: 60, mode: 'every_n_days', intervalDays: 5, ...over });

const rows = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

beforeEach(async () => {
    await resetDatabase();
    await getDatabase().mutationQueue.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('a blank start: schedule.create, then ONE schedule.edit that writes the stages and works whole', () => {
    it('Blank_start_queues_create_then_edit_in_that_order_with_minted_ids_and_command_ids', async () => {
        const result = await saveOwnSchedule({ mode: 'blank', farmId: FARM, cropKey: 'grape', name: 'माझं द्राक्ष शेड्यूल', madeFor: {}, stages, works: [work()] });
        const q = await rows();
        expect(q.map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleCreate, SyncMutationName.ScheduleEdit]);
        const [create, edit] = q.map(r => r.payload as Record<string, unknown>);
        expect(create).toEqual({ scheduleTemplateId: result.scheduleTemplateId, farmId: FARM, cropKey: 'grape', name: 'माझं द्राक्ष शेड्यूल' });
        expect(result.scheduleTemplateId).toMatch(GUID);
        expect(edit.scheduleTemplateId).toBe(result.scheduleTemplateId); // the version it changes is the one just created
        expect(edit.newScheduleTemplateId).toMatch(GUID);
        expect(edit.newScheduleTemplateId).not.toBe(result.scheduleTemplateId);
        expect(edit.farmId).toBe(FARM);
        expect(edit.actorUserId).toBe(OWNER); // kept on the contract for phones that send it; the server reads the authenticated person
        expect(edit.stages).toEqual([{ name: 'फुलोरा ते फळधारणा', startDay: 31, endDay: 60 }]);
        expect(edit.activities).toEqual([{ name: 'ठिबक सिंचन', part: 'irrigation', startDay: 31, endDay: 60, frequencyMode: 'every_n_days', intervalDays: 5 }]);
        for (const r of q) {
            expect(r.clientCommandId).toBe(r.clientRequestId);
            expect(r.status).toBe('PENDING');
        }
        expect(q[0].clientRequestId).toBe(`schedule.create:${result.scheduleTemplateId}`);
        expect(q[1].clientRequestId).toBe(`schedule.edit:${edit.newScheduleTemplateId}`);
        expect(result.queued).toBe(2);
    });

    it('Made_for_tags_travel_on_create_AND_on_the_edit_that_writes_the_version_whole (absent = none, no null keys)', async () => {
        await saveOwnSchedule({ mode: 'blank', farmId: FARM, cropKey: 'grape', name: 'अ', madeFor: { variety: 'Thompson Seedless', soilType: 'black' }, stages, works: [work()] });
        const [create, edit] = (await rows()).map(r => r.payload as Record<string, unknown>);
        expect(create).toMatchObject({ variety: 'Thompson Seedless', soilType: 'black' });
        expect(edit).toMatchObject({ variety: 'Thompson Seedless', soilType: 'black' });
        for (const p of [create, edit]) {
            expect(Object.keys(p)).not.toContain('region');
            expect(Object.keys(p)).not.toContain('climate');
            expect(Object.values(p)).not.toContain(null);
            expect(Object.values(p)).not.toContain(undefined);
        }
    });

    it('A_blank_start_with_no_stage_yet_queues_only_the_create (the empty schedule: "आधी कामं जोडा")', async () => {
        const result = await saveOwnSchedule({ mode: 'blank', farmId: FARM, cropKey: 'grape', name: 'अ', madeFor: {}, stages: [], works: [] });
        expect((await rows()).map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleCreate]);
        expect(result.queued).toBe(1);
    });

    it('Stages_without_works_write_a_stages_only_version_(no_activities_key)', async () => {
        await saveOwnSchedule({ mode: 'blank', farmId: FARM, cropKey: 'grape', name: 'अ', madeFor: {}, stages, works: [] });
        const edit = (await rows())[1].payload as Record<string, unknown>;
        expect(edit.stages).toHaveLength(1);
        expect(Object.keys(edit)).not.toContain('activities');
    });

    it('A_one_time_work_sends_a_repeat_of_1_and_a_good_operation_key_travels_a_bad_one_does_not', async () => {
        await saveOwnSchedule({
            mode: 'blank', farmId: FARM, cropKey: 'grape', name: 'अ', madeFor: {}, stages,
            works: [work({ name: 'घड विरळणी', part: 'work', startDay: 38, endDay: 38, mode: 'one_time', intervalDays: 99, operationKey: 'op_thinning' }), work({ name: 'दुसरं', operationKey: 'Bad Key' })],
        });
        const edit = (await rows())[1].payload as { activities: Array<Record<string, unknown>> };
        expect(edit.activities[0]).toEqual({ name: 'घड विरळणी', part: 'work', operationKey: 'op_thinning', startDay: 38, endDay: 38, frequencyMode: 'one_time', intervalDays: 1 });
        expect(Object.keys(edit.activities[1])).not.toContain('operationKey');
    });

    it('A_payload_the_contract_would_refuse_is_never_queued: nothing is written and the caller is told', async () => {
        await expect(saveOwnSchedule({ mode: 'blank', farmId: 'not-a-guid', cropKey: 'grape', name: 'अ', madeFor: {}, stages, works: [work()] })).rejects.toThrow();
        expect(await rows()).toEqual([]);
        await expect(saveOwnSchedule({ mode: 'blank', farmId: FARM, cropKey: 'grape', name: 'अ', madeFor: { soilType: 'mud' }, stages: [], works: [] })).rejects.toThrow();
        expect(await rows()).toEqual([]);
    });
});

describe('start from a checked schedule: schedule.clone INTO the farm\'s own, then a schedule.edit only when something was changed', () => {
    const SOURCE = id(900);
    it('Copy_unchanged_queues_only_the_clone_with_intoFarmOwn_and_Team_scope', async () => {
        const result = await saveOwnSchedule({ mode: 'checked', sourceScheduleTemplateId: SOURCE, farmId: FARM, name: null, madeFor: {}, stages, works: [work()], changed: false });
        const q = await rows();
        expect(q.map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleClone]);
        expect(q[0].payload).toEqual({
            sourceScheduleTemplateId: SOURCE, newScheduleTemplateId: result.scheduleTemplateId, actorUserId: OWNER,
            clientCommandId: `schedule.clone:${result.scheduleTemplateId}`, newScope: 'Team', farmId: FARM, intoFarmOwn: true,
        });
        expect(result.queued).toBe(1);
    });

    it('Copy_with_a_new_name_tags_or_changes_adds_one_edit_of_the_copy', async () => {
        const result = await saveOwnSchedule({ mode: 'checked', sourceScheduleTemplateId: SOURCE, farmId: FARM, name: 'माझं', madeFor: { region: 'mh_nashik' }, stages, works: [work()], changed: true });
        const q = await rows();
        expect(q.map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleClone, SyncMutationName.ScheduleEdit]);
        const edit = q[1].payload as Record<string, unknown>;
        expect(edit.scheduleTemplateId).toBe(result.scheduleTemplateId);
        expect(edit).toMatchObject({ newName: 'माझं', region: 'mh_nashik', farmId: FARM });
        expect(edit.stages).toBeTruthy();
    });
});

describe('a later change: ONE schedule.edit that writes the next version whole (never in place)', () => {
    it('Edit_names_the_version_it_changes_and_mints_the_next_versions_id', async () => {
        const result = await saveOwnSchedule({ mode: 'edit', scheduleTemplateId: id(7), farmId: FARM, name: 'नवं नाव', madeFor: { climate: 'dry' }, stages, works: [work()] });
        const q = await rows();
        expect(q.map(r => r.mutationType)).toEqual([SyncMutationName.ScheduleEdit]);
        const edit = q[0].payload as Record<string, unknown>;
        expect(edit).toMatchObject({ scheduleTemplateId: id(7), newScheduleTemplateId: result.scheduleTemplateId, newName: 'नवं नाव', climate: 'dry', farmId: FARM });
        expect(q[0].clientRequestId).toBe(`schedule.edit:${result.scheduleTemplateId}`);
    });

    const again = (source = id(7), extra: { knownVersionIds?: string[] } = {}) =>
        saveOwnSchedule({ mode: 'edit', scheduleTemplateId: source, farmId: FARM, name: null, madeFor: {}, stages, works: [work()], ...extra });

    it('A_second_change_made_before_the_first_has_synced_is_REFUSED_and_writes_nothing (P001: never two children of one version)', async () => {
        await again();
        await expect(again()).rejects.toBeInstanceOf(OwnScheduleChangeBlocked);
        expect(await rows()).toHaveLength(1);
    });

    it('A_save_that_is_stuck_(FAILED_at_the_cap, or held) still blocks: it is still his unsynced change', async () => {
        await again();
        const [first] = await rows();
        await getDatabase().mutationQueue.update(first.id as number, { status: 'FAILED', retryCount: 5 });
        await expect(again()).rejects.toBeInstanceOf(OwnScheduleChangeBlocked);
        await getDatabase().mutationQueue.update(first.id as number, { status: 'FAILED', retryCount: 0, errorCode: 'entitlement.subscriptionexpired' });
        await expect(again()).rejects.toBeInstanceOf(OwnScheduleChangeBlocked);
        expect(await rows()).toHaveLength(1);
    });

    it('A_change_the_server_REFUSED_(parked) does_not_block: he may change it again from the same version', async () => {
        await again();
        const [first] = await rows();
        await getDatabase().mutationQueue.update(first.id as number, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.ScheduleMadeFor' });
        await again();
        expect(await rows()).toHaveLength(2);
    });

    it('A_change_the_server_ACCEPTED_but_whose_new_version_has_not_been_pulled_yet_still_blocks_when_the_caller_names_the_versions_it_holds', async () => {
        const first = await again();
        const [row] = await rows();
        await getDatabase().mutationQueue.update(row.id as number, { status: 'APPLIED' });
        // the pulled rows hold the version it changed (id(7)) but not yet the one it made
        await expect(again(id(7), { knownVersionIds: [id(7)] })).rejects.toBeInstanceOf(OwnScheduleChangeBlocked);
        // once the pull carries the new version, the next change is written on THAT one and is free
        await again(first.scheduleTemplateId, { knownVersionIds: [id(7), first.scheduleTemplateId] });
        expect(await rows()).toHaveLength(2);
    });

    it('Changes_of_different_schedules_do_not_block_each_other', async () => {
        await again(id(7));
        await again(id(8));
        expect(await rows()).toHaveLength(2);
    });
});
