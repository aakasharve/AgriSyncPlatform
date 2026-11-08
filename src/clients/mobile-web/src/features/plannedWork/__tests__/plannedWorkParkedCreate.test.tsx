// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2 fix round 1, P003; doctrine P10, plan line 573) - a task whose CREATE the
 * server refused (its outbox row parked, `REJECTED_USER_REVIEW`) is still on the plan list as a card with its own refusal words and the
 * link to the conflict page: never done, never with a trail step, not counted as open work. It follows the outbox row: discarded
 * (`REJECTED_DROPPED`) it is gone; re-sent and accepted it is normal; another farm's never appears.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CropProfile, FarmerProfile } from '../../../types';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import { PlannedWorkCommands, type CreatePlannedWorkInput } from '../data/plannedWorkCommands';
import { getLocalPlannedWork } from '../data/plannedWorkStore';
import { isOpenTask } from '../planCardModel';
import { PlanWorkPage } from '../components/PlanWorkPage';

vi.mock('../components/PlanMic', () => ({ PlanMic: () => <button type="button" data-testid="plan-mic">mic</button> }));

const FARM = '55555555-5555-4555-8555-555555555551';
const OTHER_FARM = '55555555-5555-4555-8555-555555555552';
const OWNER = '22222222-2222-4222-8222-222222222222';
const RAJU = '11111111-1111-4111-8111-111111111111';
const T1 = '33333333-3333-4333-8333-333333333331';
const T2 = '33333333-3333-4333-8333-333333333332';
const PLOT = '44444444-4444-4444-8444-444444444441';
const CROPS = [{ id: 'cane', name: 'ऊस', iconName: 'Sugarcane', color: 'emerald', plots: [{ id: PLOT, name: 'ऊस 1' }] }] as unknown as CropProfile[];
const PROFILE = { operators: [], activeOperatorId: '' } as unknown as FarmerProfile;

const make = (over: Partial<CreatePlannedWorkInput> = {}): CreatePlannedWorkInput => ({
    plannedWorkId: T1, farmId: FARM, title: 'फवारणी', scope: 'Plot', plotIds: [PLOT], plannedDate: '2026-11-10', assigneeUserId: RAJU,
    sourceKind: 'PlanForm', recordedOn: '2026-11-08', ...over,
});
const park = async (id: string, code = 'ShramSafal.PlannedWorkAssigneeNotMember.InvalidCommand') => {
    const row = (await getDatabase().mutationQueue.toArray()).find(r => r.mutationType === SyncMutationName.PlannedworkCreate && (r.payload as { plannedWorkId: string }).plannedWorkId === id)!;
    await mutationQueue.markRejectedUserReview(row.id!, 'refused', code);
    return row.id!;
};
const serverRow = (over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id: T1, farmId: FARM, title: 'फवारणी', scope: 'Plot', plannedDate: '2026-11-10', looseWhen: null, plannedTime: null, assigneeUserId: RAJU,
    crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Assigned', source: 'Planning',
    sourceKind: 'PlanForm', recordedOn: '2026-11-08', linkedDailyLogIds: [], createdByUserId: OWNER, createdAtUtc: '2026-11-08T06:00:00.000Z',
    modifiedAtUtc: '2026-11-08T06:00:00.000Z', plots: [{ plotId: PLOT, status: 'Pending', linkedDailyLogIds: [] }], ...over,
});
const pull = (plannedWork: PlannedWorkDto[]): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', plannedWork,
} as unknown as SyncPullResponse);

beforeEach(async () => {
    await resetDatabase();
    await Promise.all([getDatabase().plannedWork.clear(), getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
});
afterEach(cleanup);

describe('the store keeps a refused create as a card', () => {
    it('shows it, marked refused, not kept on the phone, with no step waiting', async () => {
        await PlannedWorkCommands.create(make());
        expect((await getLocalPlannedWork(FARM))[0]).toMatchObject({ id: T1, refused: false, keptOnPhone: true });
        await park(T1);
        const items = await getLocalPlannedWork(FARM);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ id: T1, title: 'फवारणी', refused: true, keptOnPhone: false, pendingSteps: [], source: 'queue', plotIds: [PLOT] });
        expect(isOpenTask(items[0])).toBe(false);
    });

    it('another farm\'s refused create never appears', async () => {
        await PlannedWorkCommands.create(make({ farmId: OTHER_FARM }));
        await park(T1);
        expect(await getLocalPlannedWork(FARM)).toEqual([]);
        expect(await getLocalPlannedWork(OTHER_FARM)).toHaveLength(1);
    });

    it('discarded on the conflict page, it is gone', async () => {
        await PlannedWorkCommands.create(make());
        const id = await park(T1);
        await mutationQueue.markRejectedDropped(id);
        expect(await getLocalPlannedWork(FARM)).toEqual([]);
    });

    it('re-sent (the corrected words back to PENDING) it is a normal queued task again', async () => {
        await PlannedWorkCommands.create(make());
        await park(T1);
        await mutationQueue.replacePayload(PlannedWorkCommands.requestIdFor('create', T1), make({ assigneeUserId: undefined }));
        const items = await getLocalPlannedWork(FARM);
        expect(items[0]).toMatchObject({ id: T1, refused: false, keptOnPhone: true, pendingSteps: ['create'], assigneeUserId: null });
        expect(isOpenTask(items[0])).toBe(true);
    });

    it('if the server already has the task, the refused row adds no second card', async () => {
        await PlannedWorkCommands.create(make());
        await park(T1);
        await reconcileSyncPull(pull([serverRow()]));
        const items = await getLocalPlannedWork(FARM);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ source: 'server', refused: false });
    });

    it('a change queued over a refused create is not laid on it', async () => {
        await PlannedWorkCommands.create(make());
        await park(T1);
        await PlannedWorkCommands.edit({ plannedWorkId: T1, farmId: FARM, title: 'दुसरं', scope: 'Farm' });
        const items = await getLocalPlannedWork(FARM);
        expect(items[0]).toMatchObject({ title: 'फवारणी', refused: true });
    });
});

describe('the plan page draws it', () => {
    const page = (onOpenConflicts = vi.fn()) => (
        <PlanWorkPage farmId={FARM} userId={OWNER} language="mr" crops={CROPS} farmerProfile={PROFILE} mayPlan mayAssign={false}
            today={new Date(2026, 10, 8)} onBack={vi.fn()} onOpenConflicts={onOpenConflicts} />
    );

    it('a card with the refusal words and the link to the conflict page; never done, no trail', async () => {
        await PlannedWorkCommands.create(make());
        await park(T1);
        const onOpenConflicts = vi.fn();
        render(page(onOpenConflicts));
        const card = await screen.findByTestId(`plan-${T1}`);
        expect(within(card).getByTestId('plan-parked-words')).toHaveTextContent('ही व्यक्ती या शेतावर सध्या नाही, म्हणून तिला काम सोपवता येत नाही.');
        expect(card).toHaveAttribute('data-stage', '');
        expect(card).toHaveAttribute('data-refused', 'yes');
        expect(within(card).queryByTestId('plan-trail')).toBeNull();
        expect(within(card).queryByTestId('plan-kept')).toBeNull();
        expect(card.textContent).not.toContain('झालं');
        expect(card.textContent).not.toContain('सोपवलं');
        fireEvent.click(within(card).getByTestId('plan-parked-open'));
        expect(onOpenConflicts).toHaveBeenCalledTimes(1);
    });

    it('discarded: the card goes on the next read; re-sent: it becomes a normal card', async () => {
        await PlannedWorkCommands.create(make());
        const id = await park(T1);
        render(page());
        await screen.findByTestId(`plan-${T1}`);
        await mutationQueue.markRejectedDropped(id);
        window.dispatchEvent(new Event('agrisync:sync-reconciled'));
        await waitFor(() => expect(screen.queryByTestId(`plan-${T1}`)).toBeNull());
    });

    it('a refused create that was a reminder (nobody) also shows, not as work', async () => {
        await PlannedWorkCommands.create(make({ plannedWorkId: T2, assigneeUserId: undefined }));
        await park(T2, 'ShramSafal.PlannedWork.InvalidCommand');
        render(page());
        const card = await screen.findByTestId(`plan-${T2}`);
        expect(within(card).getByTestId('plan-parked-words')).toHaveTextContent('हा बदल पाठवता आला नाही.');
    });
});
