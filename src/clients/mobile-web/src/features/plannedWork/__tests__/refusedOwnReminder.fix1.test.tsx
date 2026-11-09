// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 fix round 1, review L002; doctrine P10) - "a refused upload stays visible with its
 * words". A WORKER (who cannot plan) whose own reminder the server refused (the one-time upload's create, or his typed "आठवण जोडा") used to see it
 * nowhere: करायची कामे and लक्ष द्या leave a refused create out (it is not work), and the plan page showed a non-planner only work handed to him.
 *
 * ONE rule: the plan page, and only the plan page, also shows a non-planner his OWN refused creates, drawn by the existing plan card with its
 * refusal words and the link to the conflict page. Through the router's own plan-route renderer, over the real store and the real parked-step read.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AppRouterContext } from '../../../core/navigation/routeContext';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { PlannedWorkCommands } from '../data/plannedWorkCommands';
import { getLocalPlannedWork, type LocalPlannedWork } from '../data/plannedWorkStore';
import { plannedWorkAsTasks } from '../data/plannedWorkAsTasks';

const h = vi.hoisted(() => ({ override: null as null | unknown[] }));

vi.mock('../components/PlanMic', () => ({ PlanMic: () => null }));
vi.mock('../data/plannedWorkAssignees', () => ({ loadAssignees: async () => ({ assignees: [], source: 'server', receivedAtUtc: 'x' }) }));
// The real read, except where a case hands in rows no queue can make (a refused row that is another person's).
vi.mock('../data/usePlannedWork', async importOriginal => {
    const real = await importOriginal<typeof import('../data/usePlannedWork')>();
    return {
        ...real,
        usePlannedWork: (farmId: string | null | undefined) => {
            const state = real.usePlannedWork(farmId);
            return h.override ? { ...state, items: h.override as LocalPlannedWork[], loaded: true } : state;
        },
    };
});

import { renderPlanWorkRoute } from '../../../core/navigation/simpleRoutes';

const FARM = '55555555-5555-4555-8555-555555555551';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MINE = '33333333-3333-4333-8333-333333333331';
const THEIRS = '33333333-3333-4333-8333-333333333332';
const WORDS = 'ShramSafal.PlannedWorkInvalid.InvalidCommand';

const ctx = (over: Record<string, unknown> = {}) => ({
    currentRoute: 'plan-work', activeFarmId: FARM, meUserId: ME, crops: [], farmerProfile: { operators: [], activeOperatorId: '' },
    mayOpenPlanner: false, mayAssignWork: false, isPrimaryOwner: false, goBackOr: vi.fn(), setCurrentRoute: vi.fn(), setCompletingTask: vi.fn(), completingTask: null,
    ...over,
}) as unknown as AppRouterContext;

const ownRefusedReminder = async (id = MINE) => {
    await PlannedWorkCommands.create({ plannedWorkId: id, farmId: FARM, title: 'ठिबकची नळी तपासायची', scope: 'Farm', plotIds: [], sourceKind: 'Typed' });
    const row = (await getDatabase().mutationQueue.toArray()).find(r => r.mutationType === SyncMutationName.PlannedworkCreate && (r.payload as { plannedWorkId: string }).plannedWorkId === id)!;
    await mutationQueue.markRejectedUserReview(row.id!, 'refused', WORDS);
};

const draw = async (c: AppRouterContext) => {
    await act(async () => { render(<>{renderPlanWorkRoute(c)}</>); });
    await act(async () => { window.dispatchEvent(new Event('agrisync:planned-work-changed')); });
};

beforeEach(async () => {
    h.override = null;
    await resetDatabase();
    await Promise.all([getDatabase().plannedWork.clear(), getDatabase().mutationQueue.clear()]);
});
afterEach(cleanup);

describe('L002 - a worker\'s own refused reminder is visible on the plan page with its words', () => {
    it('a worker (cannot plan) sees the card, its refusal words and the conflict link', async () => {
        await ownRefusedReminder();
        const setCurrentRoute = vi.fn();

        await draw(ctx({ setCurrentRoute }));

        const card = await screen.findByTestId(`plan-${MINE}`);
        expect(card).toHaveAttribute('data-refused', 'yes');
        expect(within(card).getByTestId('plan-parked-words')).not.toBeEmptyDOMElement();
        await act(async () => { fireEvent.click(within(card).getByTestId('plan-parked-open')); });
        expect(setCurrentRoute).toHaveBeenCalledWith('offline-conflicts');
    });

    it('it is still not work: not on करायची कामे or लक्ष द्या (the one list leaves a refused create out)', async () => {
        await ownRefusedReminder();
        expect(plannedWorkAsTasks(await getLocalPlannedWork(FARM), ME)).toEqual([]);
    });

    it('a refused row that is ANOTHER person\'s is not shown to a worker', async () => {
        h.override = [{
            id: THEIRS, farmId: FARM, title: 'दुसऱ्याचं', scope: 'Farm', plotIds: [], plannedDate: null, looseWhen: null, plannedTime: null, assigneeUserId: null, crewText: null,
            expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', sourceKind: 'Typed', recordedOn: '2026-11-08', createdByUserId: OTHER,
            modifiedAtUtc: null, source: 'queue', keptOnPhone: false, pendingSteps: [], refused: true, plots: [], confirmationState: null,
        }];
        await draw(ctx());
        await waitFor(() => expect(screen.getByTestId('plan-work')).toBeInTheDocument());
        expect(screen.queryByTestId(`plan-${THEIRS}`)).toBeNull();
    });

    it('a worker still does not see other reminders or work that is not his (nothing else widens)', async () => {
        h.override = [{
            id: THEIRS, farmId: FARM, title: 'दुसऱ्याचं', scope: 'Farm', plotIds: [], plannedDate: null, looseWhen: null, plannedTime: null, assigneeUserId: null, crewText: null,
            expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', sourceKind: 'Typed', recordedOn: '2026-11-08', createdByUserId: ME,
            modifiedAtUtc: null, source: 'server', keptOnPhone: false, pendingSteps: [], refused: false, plots: [], confirmationState: null,
        }];
        await draw(ctx());
        await waitFor(() => expect(screen.getByTestId('plan-work')).toBeInTheDocument());
        expect(screen.queryByTestId(`plan-${THEIRS}`)).toBeNull(); // his own NON-refused reminder stays off a non-planner's plan page, as before
    });

    it('the planner case is unchanged: he sees the refused card too', async () => {
        await ownRefusedReminder();
        await draw(ctx({ mayOpenPlanner: true, mayAssignWork: true, isPrimaryOwner: true }));
        expect(await screen.findByTestId(`plan-${MINE}`)).toHaveAttribute('data-refused', 'yes');
    });
});
