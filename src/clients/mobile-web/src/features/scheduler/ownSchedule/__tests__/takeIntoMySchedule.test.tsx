// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9, "One take with origin kept"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 2 and its
 * guardrail; SM-10; P10) - "माझ्या वेळापत्रकात घ्या": one tap queues exactly ONE `schedule.take_task` with the contract's keys only and NO plan; the same work in two
 * schedules is one answer; a work with several doses asks which one; take, plan, who is three taps and the plan waits behind the take offline; a take the server
 * refused says why; a past day offers none; Marathi only in Marathi mode and English only in English mode.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { categorizeRejection } from '../../../../infrastructure/sync/RejectionPolicy';
import { ScheduleTakeTaskPayload } from '../../../../../../../../sync-contract/schemas/payloads/schedule_take_task.zod';
import type { ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { OwnScheduleCommands } from '../../../../application/usecases/sync/OwnScheduleCommands';
import { TakeIntoMyScheduleButton } from '../TakeIntoMyScheduleButton';
import type { OwnWorkPlanning } from '../OwnWorkList';
import { ownItemIdFor } from '../ownWorkPlan';
import { doseChoicesOf, needsDosePick, offersTake, takeStateOf } from '../takeIntoMySchedule';
import { TAKE_WORDS, takeRefusalWords } from '../takeWords';

const PLACE = {
    farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1',
    plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1',
    cropCycleId: 'c1c1c1c1-0000-4000-8000-0000000000c1',
};
const ME = 'b0b0b0b0-0000-4000-8000-0000000000b1';
const SOURCE_A = 'd0d0d0d0-0000-4000-8000-0000000000a1';
const SOURCE_B = 'd0d0d0d0-0000-4000-8000-0000000000b2';
const OWNER_ONLY: OwnWorkPlanning = { mayAssign: false, assignees: [], myUserId: ME };

const timing = (): ScheduleTaskContent['timing'] => ({
    timer: 'day', fromDay: 10, toDay: null, afterTaskKey: null, usualDays: null, earliestDays: null, latestDays: null, signWords: null,
    expectedFromDay: null, expectedToDay: null, whenWords: null, repeat: 'once', repeatInterval: null, repeatEndDay: null, repeatEndSign: null,
});
const task = (key: string, name: string, patch: Partial<ScheduleTaskContent> = {}): ScheduleTaskContent => ({
    taskKey: key, name, kind: 'work', timing: timing(), basis: 'stated', stageIndex: 0, order: 0, why: null, dose: null, steps: [], products: [], reEntryHours: null,
    preHarvestDays: null, warnings: [], look: null, ask: null, sources: [], origin: null, ...patch,
});
const PRUNE = task('t-prune', 'फळछाटणी');
const SPRAY = task('t-spray', 'फवारणी', {
    kind: 'spray', dose: 'दोन ग्रॅम', products: [{ name: 'अ', doseAsWritten: 'दोन ग्रॅम', unit: null, perWhat: null, water: null }, { name: 'ब', doseAsWritten: 'तीन ग्रॅम', unit: null, perWhat: null, water: null }],
});

const takes = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.ScheduleTakeTask);
const plans = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.OwnscheduleItemPlan);
const mount = (t: ScheduleTaskContent, props: Partial<React.ComponentProps<typeof TakeIntoMyScheduleButton>> = {}) =>
    render(<TakeIntoMyScheduleButton place={PLACE} sourceVersionId={SOURCE_A} task={t} language="mr" planning={OWNER_ONLY} {...props} />);

afterEach(() => cleanup());
beforeEach(async () => { await resetDatabase(); await getDatabase().mutationQueue.clear(); await getDatabase().ownScheduleItems.clear(); });

describe('the pure rules', () => {
    it('several doses that differ ask which one; one dose or none asks nothing', () => {
        expect(doseChoicesOf(SPRAY)).toEqual(['दोन ग्रॅम', 'तीन ग्रॅम']);
        expect(needsDosePick(SPRAY)).toBe(true);
        expect(needsDosePick(PRUNE)).toBe(false);
        expect(needsDosePick(task('x', 'एक', { dose: 'एक ग्रॅम', products: [{ name: 'अ', doseAsWritten: 'एक ग्रॅम', unit: null, perWhat: null, water: null }] }))).toBe(false);
    });

    it('every card from today onward offers it; a past day does not; an unknown day is never hidden by a guess', () => {
        expect(offersTake(10, 10)).toBe(true);
        expect(offersTake(11, 10)).toBe(true);
        expect(offersTake(9, 10)).toBe(false);
        expect(offersTake(null, 10)).toBe(true);
        expect(offersTake(9, undefined)).toBe(true);
    });

    it('taken = the server\'s work or a take waiting; a parked take is a refusal, never "taken"', () => {
        const row = (status: string, key = 't-prune') => ({ status, payload: { cropCycleId: PLACE.cropCycleId, taskKey: key } });
        expect(takeStateOf(true, [], PLACE.cropCycleId, 't-prune')).toEqual({ kind: 'taken' });
        expect(takeStateOf(false, [row('PENDING')], PLACE.cropCycleId, 't-prune')).toEqual({ kind: 'queued' });
        expect(takeStateOf(false, [row('PENDING', 'other')], PLACE.cropCycleId, 't-prune')).toEqual({ kind: 'none' });
        expect(takeStateOf(false, [{ ...row('REJECTED_USER_REVIEW'), errorCode: 'ShramSafal.OwnScheduleInvalid', lastError: 'TakeSourceWithdrawn' }], PLACE.cropCycleId, 't-prune'))
            .toEqual({ kind: 'refused', code: 'ShramSafal.OwnScheduleInvalid', message: 'TakeSourceWithdrawn' });
    });
});

describe('the take command', () => {
    it('queues exactly the contract keys, no plan, and the contract accepts it', async () => {
        await OwnScheduleCommands.take(PLACE, { sourceVersionId: SOURCE_A, taskKey: 't-prune' });
        const [row] = await takes();
        expect(row.status).toBe('PENDING');
        expect(Object.keys(row.payload as object).sort()).toEqual(['cropCycleId', 'farmId', 'plotId', 'sourceVersionId', 'taskKey']);
        expect(ScheduleTakeTaskPayload.safeParse(row.payload).success).toBe(true);
        expect(await plans()).toHaveLength(0);

        await OwnScheduleCommands.take(PLACE, { sourceVersionId: SOURCE_A, taskKey: 't-spray', dose: 'तीन ग्रॅम' });
        expect(((await takes())[1].payload as Record<string, unknown>).dose).toBe('तीन ग्रॅम');
    });

    it('a payload the contract would refuse never leaves the phone', async () => {
        await expect(OwnScheduleCommands.take(PLACE, { sourceVersionId: 'not-a-guid', taskKey: 't-prune' })).rejects.toThrow(/Payload validation failed/);
        expect(await takes()).toHaveLength(0);
    });

    it('the switched-off refusal and an invalid take are permanent: parked with words, never retried to the cap', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.ScheduleMechanismOff' })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: 'ShramSafal.OwnScheduleInvalid' })).toBe('PERMANENT');
    });
});

describe('the button', () => {
    it('one tap queues ONE take and NO plan; it then says "in my schedule, sent when the internet is back"', async () => {
        mount(PRUNE);
        fireEvent.click(await screen.findByTestId('take-btn-t-prune'));
        await waitFor(async () => expect(await takes()).toHaveLength(1));
        expect(await plans()).toHaveLength(0);
        expect(await screen.findByTestId('take-in-t-prune')).toHaveTextContent(TAKE_WORDS.mr.queued);
        expect(screen.queryByTestId('take-btn-t-prune')).toBeNull();
        expect(await takes()).toHaveLength(1);
    });

    it('take, plan, who is three taps; the plan waits in the outbox behind the take', async () => {
        mount(PRUNE);
        fireEvent.click(await screen.findByTestId('take-btn-t-prune'));
        fireEvent.click(await screen.findByTestId('take-plan-t-prune'));
        fireEvent.click(screen.getByTestId('plan-assign-self'));
        await waitFor(async () => expect(await plans()).toHaveLength(1));
        const all = (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)).map(r => r.mutationType);
        expect(all).toEqual([SyncMutationName.ScheduleTakeTask, SyncMutationName.OwnscheduleItemPlan]);
        expect((await plans())[0].payload).toMatchObject({ taskKey: 't-prune', assigneeUserId: ME, cropCycleId: PLACE.cropCycleId });
    });

    it('who is a real who: a seat that may assign is offered the people of the farm, and the plan carries the one picked', async () => {
        const WORKER = 'b0b0b0b0-0000-4000-8000-0000000000b2';
        mount(PRUNE, { planning: { mayAssign: true, assignees: [{ userId: WORKER, displayName: 'राजू', role: 'Worker' } as never], myUserId: ME } });
        fireEvent.click(await screen.findByTestId('take-btn-t-prune'));
        fireEvent.click(await screen.findByTestId('take-plan-t-prune'));
        fireEvent.click(screen.getByTestId(`plan-assign-${WORKER}`));
        await waitFor(async () => expect(await plans()).toHaveLength(1));
        expect((await plans())[0].payload).toMatchObject({ taskKey: 't-prune', assigneeUserId: WORKER });
    });

    it('the same work in two schedules is ONE answer: after a take, the other card of the same work says it is in my schedule', async () => {
        render(<><TakeIntoMyScheduleButton place={PLACE} sourceVersionId={SOURCE_A} task={PRUNE} language="mr" /><TakeIntoMyScheduleButton place={PLACE} sourceVersionId={SOURCE_B} task={PRUNE} language="mr" /></>);
        const buttons = await screen.findAllByTestId('take-btn-t-prune');
        expect(buttons).toHaveLength(2);
        fireEvent.click(buttons[0]);
        await waitFor(() => expect(screen.getAllByTestId('take-in-t-prune')).toHaveLength(2));
        expect(await takes()).toHaveLength(1);
    });

    it('a work with several doses asks which one first, and queues the one picked', async () => {
        mount(SPRAY);
        fireEvent.click(await screen.findByTestId('take-btn-t-spray'));
        expect(await takes()).toHaveLength(0);
        expect(screen.getByTestId('take-dose-t-spray')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('take-dose-t-spray-1'));
        await waitFor(async () => expect(await takes()).toHaveLength(1));
        expect((await takes())[0].payload).toMatchObject({ taskKey: 't-spray', dose: 'तीन ग्रॅम' });
    });

    it('a work the server already holds reads as taken (even after a reload) and can be taken back out', async () => {
        await getDatabase().ownScheduleItems.put({
            id: ownItemIdFor(PLACE.cropCycleId, 't-prune'), farmId: PLACE.farmId, plotId: PLACE.plotId, cropCycleId: PLACE.cropCycleId, taskKey: 't-prune', revision: 1,
            state: 'active', task: PRUNE, contentHash: 'a'.repeat(64), origin: `take:${SOURCE_A.replace(/-/g, '')}`, mainVersionId: null, updatedAtUtc: '2026-11-24T06:00:00Z',
        } as never);
        mount(PRUNE);
        expect(await screen.findByTestId('take-in-t-prune')).toHaveTextContent(TAKE_WORDS.mr.taken);
        fireEvent.click(screen.getByTestId('take-back-t-prune'));
        await waitFor(async () => expect((await getDatabase().mutationQueue.toArray()).some(r => r.mutationType === SyncMutationName.OwnscheduleItemRemove)).toBe(true));
        // a removal waiting reads as not taken until the server answers
        expect(await screen.findByTestId('take-btn-t-prune')).toBeInTheDocument();
    });

    it('a past day offers no take; a seat that may not take sees none', async () => {
        const { unmount } = mount(PRUNE, { dayStored: 3, todayStored: 10 });
        await waitFor(() => expect(screen.queryByTestId('take-t-prune')).toBeNull());
        unmount();
        mount(PRUNE, { mayTake: false });
        await waitFor(() => expect(screen.queryByTestId('take-t-prune')).toBeNull());
    });

    it('a parked take says why in plain Marathi and never reads as taken', async () => {
        await getDatabase().mutationQueue.add({
            deviceId: 'd', clientRequestId: 'take:1', clientCommandId: 'take:1', mutationType: SyncMutationName.ScheduleTakeTask,
            payload: { farmId: PLACE.farmId, plotId: PLACE.plotId, cropCycleId: PLACE.cropCycleId, sourceVersionId: SOURCE_A, taskKey: 't-prune' },
            status: 'REJECTED_USER_REVIEW', createdAt: '2026-11-24T06:00:00Z', updatedAt: '2026-11-24T06:00:00Z', retryCount: 1,
            errorCode: 'ShramSafal.OwnScheduleInvalid', lastError: 'TakeSourceWithdrawn: gone',
        } as never);
        mount(PRUNE, { onOpenConflicts: () => undefined });
        expect(await screen.findByTestId('take-refused-t-prune')).toHaveTextContent(TAKE_WORDS.mr.refusedSource);
        expect(screen.queryByTestId('take-in-t-prune')).toBeNull();
    });

    it('a take from an unchecked reference says so in plain words', () => {
        expect(takeRefusalWords(TAKE_WORDS.mr, 'ShramSafal.OwnScheduleInvalid', 'TakeSourceNotChecked: gone')).toBe(TAKE_WORDS.mr.refusedNotChecked);
        expect(takeRefusalWords(TAKE_WORDS.en, 'ShramSafal.OwnScheduleInvalid', 'TakeSourceNotChecked: gone')).toBe(TAKE_WORDS.en.refusedNotChecked);
    });

    it('Marathi mode is Marathi only and English mode English only; no emoji, no AI wording', () => {
        for (const [lang, words] of Object.entries(TAKE_WORDS)) {
            for (const [key, value] of Object.entries(words)) {
                expect(value, `${lang}.${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
                expect(value, `${lang}.${key}`).not.toMatch(/\bAI\b/);
                if (lang === 'mr') expect(value, `mr.${key}`).not.toMatch(/[A-Za-z0-9]/);
                if (lang === 'en') expect(value, `en.${key}`).not.toMatch(/[ऀ-ॿ]/);
            }
        }
    });
});
