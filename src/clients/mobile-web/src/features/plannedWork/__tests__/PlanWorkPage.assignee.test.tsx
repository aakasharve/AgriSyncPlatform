// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2 Task 4; founder D-24c, D-26, D-79, P5, P10) - the plan page and the
 * assignee's view, over the real task store and outbox (fake-indexeddb): opening the list sends ONE `seen`; "ठीक आहे, करतो" sends ONE
 * `accept`; offline both queue and say "फोनवर ठेवलं"; a parked accept shows its words and the conflict link and never shows as accepted;
 * "काम झालं" is drawn on his accepted work since lane L8c-3 (its flow is tested in taskDone.router.test.tsx); a seat that is not a planner
 * has no form; another farm's work never appears.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CropProfile, FarmerProfile } from '../../../types';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import { PlannedWorkCommands } from '../data/plannedWorkCommands';
import { PlanWorkPage, type PlanWorkPageProps } from '../components/PlanWorkPage';

vi.mock('../components/PlanMic', () => ({ PlanMic: () => <button type="button" data-testid="plan-mic">mic</button> }));

const FARM = '55555555-5555-4555-8555-555555555551';
const OTHER_FARM = '55555555-5555-4555-8555-555555555552';
const OWNER = '22222222-2222-4222-8222-222222222222';
const RAJU = '11111111-1111-4111-8111-111111111111';
const SHANKAR = '11111111-1111-4111-8111-111111111112';
const T1 = '33333333-3333-4333-8333-333333333331';
const T2 = '33333333-3333-4333-8333-333333333332';
const T3 = '33333333-3333-4333-8333-333333333333';
const PLOT = '44444444-4444-4444-8444-444444444441';
const TODAY = new Date(2026, 10, 8);

const CROPS = [{ id: 'cane', name: 'ऊस', iconName: 'Sugarcane', color: 'emerald', plots: [{ id: PLOT, name: 'ऊस 1' }] }] as unknown as CropProfile[];
const PROFILE = { operators: [], activeOperatorId: '' } as unknown as FarmerProfile;

const task = (over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id: T1, farmId: FARM, title: 'फवारणी', scope: 'Plot', plannedDate: '2026-11-10', looseWhen: null, plannedTime: null,
    assigneeUserId: RAJU, crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null,
    status: 'Assigned', source: 'Planning', sourceKind: 'PlanForm', recordedOn: '2026-11-08', linkedDailyLogIds: [],
    createdByUserId: OWNER, createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z',
    plots: [{ plotId: PLOT, status: 'Pending', linkedDailyLogIds: [] }],
    ...over,
});

const pull = (plannedWork: PlannedWorkDto[]): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', plannedWork,
} as unknown as SyncPullResponse);

const page = (over: Partial<PlanWorkPageProps> = {}) => (
    <PlanWorkPage farmId={FARM} userId={RAJU} language="mr" crops={CROPS} farmerProfile={PROFILE} mayPlan={false} mayAssign={false}
        today={TODAY} onBack={vi.fn()} onOpenConflicts={vi.fn()} {...over} />
);

const queued = async (type: string) => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === type);
const setOnline = (online: boolean) => Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });

beforeEach(async () => {
    await resetDatabase();
    await Promise.all([getDatabase().plannedWork.clear(), getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
    setOnline(true);
});
afterEach(() => { cleanup(); setOnline(true); });

describe('opening his list sends "पाहिलं" once', () => {
    it('one `seen` for the task handed to him; opening again (a new mount) is still one', async () => {
        await reconcileSyncPull(pull([task()]));
        const first = render(page());
        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkSeen)).toHaveLength(1));
        expect((await queued(SyncMutationName.PlannedworkSeen))[0].clientRequestId).toBe(`${SyncMutationName.PlannedworkSeen}:${T1}`);
        expect((await queued(SyncMutationName.PlannedworkSeen))[0].payload).toEqual({ plannedWorkId: T1, farmId: FARM });
        // the card moves on the phone at once, saying it is waiting
        await waitFor(() => expect(screen.getByTestId(`plan-${T1}`)).toHaveAttribute('data-stage', '1'));
        expect(within(screen.getByTestId(`plan-${T1}`)).getByTestId('plan-kept')).toHaveTextContent('फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल');
        first.unmount();
        render(page());
        await screen.findByTestId(`plan-${T1}`);
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });
        expect(await queued(SyncMutationName.PlannedworkSeen)).toHaveLength(1);
    });

    it('a reminder, a task already seen, a task for someone else, and another farm\'s task send nothing', async () => {
        await reconcileSyncPull(pull([
            task({ id: T1, assigneeUserId: null, status: 'Open' }),
            task({ id: T2, status: 'Seen' }),
            task({ id: T3, assigneeUserId: SHANKAR }),
            task({ id: '33333333-3333-4333-8333-333333333334', farmId: OTHER_FARM }),
        ]));
        render(page());
        await screen.findByTestId(`plan-${T2}`);
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });
        expect(await queued(SyncMutationName.PlannedworkSeen)).toHaveLength(0);
        // the mukadam's task is not Raju's list; the other farm's is nowhere
        expect(screen.queryByTestId(`plan-${T3}`)).toBeNull();
        expect(screen.queryByTestId('plan-33333333-3333-4333-8333-333333333334')).toBeNull();
        expect(screen.queryByTestId(`plan-${T1}`)).toBeNull();
    });
});

describe('"ठीक आहे, करतो" sends accept once', () => {
    it('one `accept`; the card says it is kept on the phone and the trail reaches स्वीकारलं; the button goes', async () => {
        await reconcileSyncPull(pull([task({ status: 'Seen' })]));
        render(page());
        const button = await screen.findByTestId(`plan-accept-${T1}`);
        expect(button).toHaveTextContent('ठीक आहे, करतो');
        await act(async () => { fireEvent.click(button); fireEvent.click(button); });
        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkAccept)).toHaveLength(1));
        expect((await queued(SyncMutationName.PlannedworkAccept))[0].clientRequestId).toBe(`${SyncMutationName.PlannedworkAccept}:${T1}`);
        await waitFor(() => expect(screen.getByTestId(`plan-${T1}`)).toHaveAttribute('data-stage', '2'));
        expect(screen.queryByTestId(`plan-accept-${T1}`)).toBeNull();
        expect(screen.getByTestId('plan-kept')).toHaveTextContent('फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल');
    });

    it('offline, both steps queue and both say "फोनवर ठेवलं"', async () => {
        setOnline(false);
        await reconcileSyncPull(pull([task()]));
        render(page());
        await waitFor(() => expect(screen.getByTestId(`plan-${T1}`)).toHaveAttribute('data-stage', '1'));
        await act(async () => { fireEvent.click(await screen.findByTestId(`plan-accept-${T1}`)); });
        await waitFor(() => expect(screen.getByTestId(`plan-${T1}`)).toHaveAttribute('data-stage', '2'));
        expect((await getDatabase().mutationQueue.toArray()).map(r => r.mutationType).sort()).toEqual([SyncMutationName.PlannedworkAccept, SyncMutationName.PlannedworkSeen]);
        expect(screen.getByTestId('plan-kept')).toHaveTextContent('फोनवर ठेवलं');
    });

    it('a parked accept shows its own words and the conflict link, never shows as accepted, and has no button to press again', async () => {
        await reconcileSyncPull(pull([task({ status: 'Seen' })]));
        await PlannedWorkCommands.accept(T1, FARM);
        const row = (await queued(SyncMutationName.PlannedworkAccept))[0];
        await mutationQueue.markRejectedUserReview(row.id!, 'refused', 'ShramSafal.PlannedWorkState.InvalidCommand');
        const onOpenConflicts = vi.fn();
        render(page({ onOpenConflicts }));
        const card = await screen.findByTestId(`plan-${T1}`);
        expect(within(card).getByTestId('plan-parked-words')).toHaveTextContent('हे काम आधी बदललं गेलं, म्हणून हा बदल लागू झाला नाही.');
        expect(card).toHaveAttribute('data-stage', '1');
        expect(within(card).getByTestId('plan-trail-2')).toHaveAttribute('data-on', 'no');
        expect(within(card).queryByTestId('plan-kept')).toBeNull();
        expect(screen.queryByTestId(`plan-accept-${T1}`)).toBeNull();
        fireEvent.click(within(card).getByTestId('plan-parked-open'));
        expect(onOpenConflicts).toHaveBeenCalledTimes(1);
    });
});

describe('what the assignee view does not draw', () => {
    it('no form, no mic, no money or हजेरी (and, since lane L8c-3, "काम झालं" on his accepted work); the title is "तुमच्यावर सोपवलेली कामे"', async () => {
        await reconcileSyncPull(pull([task({ status: 'Accepted', crewText: 'रोकडेची टीम', expectedHeadcount: 10, payMode: 'Contract' })]));
        render(page());
        await screen.findByTestId(`plan-${T1}`);
        expect(screen.getByTestId('plan-title')).toHaveTextContent('तुमच्यावर सोपवलेली कामे');
        expect(screen.queryByTestId('plan-form')).toBeNull();
        expect(screen.queryByTestId('plan-mic')).toBeNull();
        const text = screen.getByTestId('plan-work').textContent ?? '';
        expect(screen.getByTestId(`plan-done-${T1}`)).toHaveTextContent('काम झालं');
        expect(text).not.toMatch(/हजेरी|₹/);
        expect(screen.getByTestId('plan-card-crew')).toHaveTextContent('रोकडेची टीम · १० जण');
    });

    it('an empty list says so in the preview\'s words', async () => {
        render(page());
        await waitFor(() => expect(screen.getByTestId('plan-empty')).toHaveTextContent('तुमच्यावर अजून कोणतंही काम सोपवलेलं नाही'));
    });
});

describe('the planner\'s page', () => {
    it('has the form first and lists everything he may see, the tasks of this farm only; the work for him gets the button', async () => {
        await reconcileSyncPull(pull([
            task({ id: T1, assigneeUserId: SHANKAR, createdByUserId: RAJU }),
            task({ id: T2, assigneeUserId: null, status: 'Open', plannedDate: null, looseWhen: 'Week' }),
            task({ id: T3, assigneeUserId: RAJU, createdByUserId: SHANKAR, status: 'Seen' }),
            task({ id: '33333333-3333-4333-8333-333333333334', farmId: OTHER_FARM }),
        ]));
        render(page({ mayPlan: true, mayAssign: true, loadAssigneeList: async () => ({ assignees: [{ userId: SHANKAR, displayName: 'शंकर', role: 'Mukadam', plotScope: 'AllPlots', plotIds: [] }], source: 'server', receivedAtUtc: 'x' }) }));
        await screen.findByTestId(`plan-${T1}`);
        expect(screen.getByTestId('plan-title')).toHaveTextContent('कामाचे नियोजन');
        expect(screen.getByTestId('plan-form')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem').filter(li => li.getAttribute('data-testid')?.startsWith('plan-3'))).toHaveLength(3);
        expect(screen.getByTestId(`plan-${T1}`)).toHaveTextContent('शंकर · मुकादम');
        expect(screen.getByTestId(`plan-${T2}`)).toHaveAttribute('data-tone', 'amber');
        expect(screen.getByTestId(`plan-accept-${T3}`)).toBeInTheDocument();
        expect(screen.queryByTestId(`plan-accept-${T1}`)).toBeNull();
        // the assignee list reached the form (a seat with AssignWork)
        await waitFor(() => expect(screen.getByTestId(`plan-assign-${SHANKAR}`)).toBeInTheDocument());
    });

    it('a planner without AssignWork (PlanWork only) gets the form with "स्वतः" and "फक्त आठवण" only, and the assignee list is not even asked', async () => {
        const loadAssigneeList = vi.fn();
        render(page({ mayPlan: true, mayAssign: false, loadAssigneeList }));
        await screen.findByTestId('plan-form');
        expect(loadAssigneeList).not.toHaveBeenCalled();
        const chips = screen.getByTestId('plan-assignees');
        expect(Array.from(chips.querySelectorAll('button')).map(b => b.textContent)).toEqual(['स्वतः', 'फक्त आठवण (कोणालाही नाही)']);
    });
});
