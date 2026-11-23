// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6, "the plan door"; approved spec: saving never plans, "plan" then who is the SECOND act; SM-10;
 * P10) - "नियोजन करा" on a work of "माझं शेड्यूल": exactly one `ownschedule.item.plan` with the contract's keys only, a second tap queues nothing new, the plan
 * shows at once in नियोजन as kept on the phone, a plain Marathi refusal when the switch is off, Marathi only with no Latin letters or digits.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { OwnScheduleItemPlanPayload } from '../../../../../../../../sync-contract/schemas/payloads/ownschedule_item_plan.zod';
import type { ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { getLocalPlannedWork } from '../../../plannedWork/data/plannedWorkStore';
import { schedulePlanId } from '../../../../application/usecases/sync/ScheduleFeedCommands';
import { OwnWorkList, type OwnWorkPlanning } from '../OwnWorkList';
import { ownItemIdFor, planOwnWork } from '../ownWorkPlan';
import { OWN_WORK_PLAN_WORDS } from '../ownWorkPlanWords';
import type { OwnWorkPlace } from '../ownWorkPlace';

const PLACE: OwnWorkPlace = {
    farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1',
    plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1',
    cropCycleId: 'c1c1c1c1-0000-4000-8000-0000000000c1',
    plotName: 'मळा',
    cropName: 'Grapes',
};
const ME = 'b0b0b0b0-0000-4000-8000-0000000000b1';
const MUKADAM = 'b0b0b0b0-0000-4000-8000-0000000000b2';
const OWNER_ONLY: OwnWorkPlanning = { mayAssign: false, assignees: [], myUserId: ME };

const timing = (patch: Partial<ScheduleTaskContent['timing']> = {}): ScheduleTaskContent['timing'] => ({
    timer: 'day', fromDay: 10, toDay: null, afterTaskKey: null, usualDays: null, earliestDays: null, latestDays: null, signWords: null,
    expectedFromDay: null, expectedToDay: null, whenWords: null, repeat: 'once', repeatInterval: null, repeatEndDay: null, repeatEndSign: null, ...patch,
});
const TIE: ScheduleTaskContent = {
    taskKey: 'tie', name: 'वेली बांधणी', kind: 'work', timing: timing(), basis: 'experience', stageIndex: 1, order: 0, why: null, dose: null, steps: [],
    products: [], reEntryHours: null, preHarvestDays: null, warnings: [], look: null, ask: null, sources: [], origin: null,
};

async function seedServerWork(t: ScheduleTaskContent) {
    await getDatabase().ownScheduleItems.put({
        id: ownItemIdFor(PLACE.cropCycleId, t.taskKey), farmId: PLACE.farmId, plotId: PLACE.plotId, cropCycleId: PLACE.cropCycleId, taskKey: t.taskKey,
        revision: 1, state: 'active', task: t, contentHash: 'a'.repeat(64), origin: null, mainVersionId: null, updatedAtUtc: '2026-11-23T06:00:00Z',
    } as never);
}
const plans = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.OwnscheduleItemPlan);
const list = (planning: OwnWorkPlanning = OWNER_ONLY) =>
    render(<OwnWorkList place={PLACE} language="mr" onAdd={() => undefined} onEdit={() => undefined} onOpenConflicts={() => undefined} planning={planning} />);

afterEach(() => cleanup());
beforeEach(async () => { await resetDatabase(); await getDatabase().mutationQueue.clear(); });

describe('the plan door on माझं शेड्यूल (slice 6)', () => {
    it('ownItemIdFor is the server id of the work (UUIDv5 of the crop season and the key)', () => {
        // OwnScheduleItem.IdFor(c1c1c1c1-0000-4000-8000-0000000000c1, "tie") on the server
        expect(ownItemIdFor(PLACE.cropCycleId.toUpperCase(), 'tie')).toBe(ownItemIdFor(PLACE.cropCycleId, 'tie'));
        expect(ownItemIdFor(PLACE.cropCycleId, 'tie')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('saving a work queues no plan: "plan" then who is the second act and queues exactly one ownschedule.item.plan with the contract keys only', async () => {
        await seedServerWork(TIE);
        list();
        await screen.findByTestId('own-list-row-tie');
        expect(await plans()).toHaveLength(0);

        fireEvent.click(screen.getByTestId('own-list-plan-tie'));
        expect(screen.getByTestId('own-list-plan-who-tie')).toBeInTheDocument();
        expect(screen.queryByTestId(`plan-assign-${MUKADAM}`)).toBeNull();
        fireEvent.click(screen.getByTestId('plan-assign-self'));

        await waitFor(async () => expect(await plans()).toHaveLength(1));
        const row = (await plans())[0];
        const payload = row.payload as Record<string, unknown>;
        expect(OwnScheduleItemPlanPayload.safeParse(payload).success).toBe(true);
        expect(Object.keys(payload).sort()).toEqual(['assigneeUserId', 'cropCycleId', 'farmId', 'plannedWorkId', 'plotId', 'taskKey']);
        expect(payload).toMatchObject({
            plannedWorkId: schedulePlanId(ownItemIdFor(PLACE.cropCycleId, 'tie'), 1), farmId: PLACE.farmId, plotId: PLACE.plotId,
            cropCycleId: PLACE.cropCycleId, taskKey: 'tie', assigneeUserId: ME,
        });
    });

    it('a second tap queues nothing new: the work says it is planned instead of a second plan button', async () => {
        await seedServerWork(TIE);
        list();
        fireEvent.click(await screen.findByTestId('own-list-plan-tie'));
        fireEvent.click(screen.getByTestId('plan-assign-none'));
        expect(await screen.findByTestId('own-list-planned-tie')).toHaveTextContent(OWN_WORK_PLAN_WORDS.mr.plannedKept);
        expect(screen.queryByTestId('own-list-plan-tie')).toBeNull();

        // Even the door called again for the same occurrence (two taps that raced) is the same one request.
        await planOwnWork(PLACE, 'tie', 1, null);
        expect(await plans()).toHaveLength(1);
        expect(((await plans())[0].payload as Record<string, unknown>).assigneeUserId).toBeUndefined();
    });

    it('the plan shows at once in नियोजन as kept on the phone, with the work\'s own name, linked to the work', async () => {
        await seedServerWork(TIE);
        await planOwnWork(PLACE, 'tie', 1, ME);
        const items = await getLocalPlannedWork(PLACE.farmId);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            title: 'वेली बांधणी', source: 'queue', keptOnPhone: true, refused: false, plotIds: [PLACE.plotId], scheduleTaskKey: 'tie',
            ownItemId: ownItemIdFor(PLACE.cropCycleId, 'tie'), assigneeUserId: ME,
        });
    });

    it('a person is offered only to a seat that may hand work over (SM-10), and choosing him queues his id', async () => {
        await seedServerWork(TIE);
        list({ mayAssign: true, assignees: [{ userId: MUKADAM, displayName: 'राजू', role: 'Mukadam' } as never], myUserId: ME });
        fireEvent.click(await screen.findByTestId('own-list-plan-tie'));
        fireEvent.click(screen.getByTestId(`plan-assign-${MUKADAM}`));
        await waitFor(async () => expect(await plans()).toHaveLength(1));
        expect(((await plans())[0].payload as Record<string, unknown>).assigneeUserId).toBe(MUKADAM);
    });

    it('a refusal when the switch is off parks visibly with plain Marathi words', async () => {
        await seedServerWork(TIE);
        await planOwnWork(PLACE, 'tie', 1, null);
        const row = (await plans())[0];
        await getDatabase().mutationQueue.update(row.id!, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.ScheduleMechanismOff' } as never);
        list();
        expect(await screen.findByTestId('own-list-plan-refused-tie')).toHaveTextContent(OWN_WORK_PLAN_WORDS.mr.refusedOff);
        expect(screen.queryByTestId('own-list-plan-tie')).toBeNull();
        const items = await getLocalPlannedWork(PLACE.farmId);
        expect(items[0]).toMatchObject({ refused: true, keptOnPhone: false, refusedCode: 'ShramSafal.ScheduleMechanismOff' });
    });

    it('noEnglishOrLatinDigits: the door, its who question, every state and every refusal read in Marathi only', async () => {
        await seedServerWork(TIE);
        const latin = /[A-Za-z0-9]/;
        for (const [k, v] of Object.entries(OWN_WORK_PLAN_WORDS.mr)) expect(v, k).not.toMatch(latin);
        const view = list();
        fireEvent.click(await screen.findByTestId('own-list-plan-tie'));
        expect(view.container.textContent ?? '').not.toMatch(latin);
        fireEvent.click(screen.getByTestId('plan-assign-self'));
        await screen.findByTestId('own-list-planned-tie');
        expect(view.container.textContent ?? '').not.toMatch(latin);
    });
});
