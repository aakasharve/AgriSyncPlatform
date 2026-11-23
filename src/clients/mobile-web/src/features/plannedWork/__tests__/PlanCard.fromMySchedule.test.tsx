// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5) - a plan made from the farmer's own schedule says "माझ्या शेड्यूलमधून", says why it waits and the
 * day it was expected (Devanagari digits), and asks about a sign with three answers of at least 44 px; an answer is QUEUED (never moves the card itself) and the
 * card says it is kept on the phone. An ordinary plan's card is unchanged. Marathi mode shows no English word and no Latin digit in these lines.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanCard } from '../components/PlanCard';
import type { LocalPlannedWork } from '../data/plannedWorkStore';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

afterEach(cleanup);
beforeEach(async () => { await resetDatabase(); });

const ME = '22222222-2222-4222-8222-222222222222';
const ITEM = '7b000000-0000-4000-8000-0000000000aa';
const TODAY = new Date(2026, 10, 23);

const task = (over: Partial<LocalPlannedWork> = {}): LocalPlannedWork => ({
    id: '33333333-3333-4333-8333-333333333331', farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1', title: 'फुलोरा फवारणी', scope: 'Plot', plotIds: ['p1'],
    plannedDate: null, looseWhen: null, plannedTime: null, assigneeUserId: null, crewText: null, expectedHeadcount: null,
    quantityText: null, payMode: null, note: null, status: 'Open', sourceKind: null, recordedOn: '2026-11-23',
    createdByUserId: ME, modifiedAtUtc: null, source: 'server', keptOnPhone: false, pendingSteps: [], refused: false, plots: [], confirmationState: null,
    ...over,
});

const signWork = async () => {
    await getDatabase().ownScheduleItems.put({
        id: ITEM, farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1', plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1',
        cropCycleId: 'c1c1c1c1-0000-4000-8000-0000000000c1', taskKey: 'flower', state: 'active',
        task: { taskKey: 'flower', name: 'फुलोरा फवारणी', kind: 'spray', timing: { timer: 'sign', signWords: 'फुले दिसली' } },
    } as never);
};

const draw = (t: LocalPlannedWork, language = 'mr') =>
    render(<ul><PlanCard task={t} today={TODAY} me={ME} language={language} whereText="द्राक्ष १" /></ul>);

describe('a plan from my schedule (slice 5)', () => {
    it('an ordinary plan carries none of the new lines', () => {
        draw(task());
        expect(screen.queryByTestId('plan-card-schedule')).toBeNull();
    });

    it('a waiting "when seen" plan says where it came from, that it waits for the sign, and the expected day in Devanagari digits', async () => {
        await signWork();
        draw(task({ ownItemId: ITEM, scheduleTaskKey: 'flower', occurrence: 1, waiting: true, expectedFrom: '2026-11-25' }));
        expect(screen.getByTestId('plan-card-from-schedule')).toHaveTextContent('माझ्या शेड्यूलमधून');
        expect(await screen.findByTestId('plan-card-sign-question')).toHaveTextContent('फुले दिसली — दिसलं का?');
        expect(screen.getByTestId('plan-card-waiting')).toHaveTextContent('खूण दिसण्याची वाट');
        const expected = screen.getByTestId('plan-card-expected').textContent ?? '';
        expect(expected).toContain('अपेक्षित');
        expect(expected).toMatch(/२५/);
        expect(screen.getByTestId('plan-card-schedule').textContent).not.toMatch(/[A-Za-z0-9]/);
    });

    it('the three answers are 44 px targets; tapping one queues schedule.task_event and says it is kept on the phone', async () => {
        await signWork();
        draw(task({ ownItemId: ITEM, scheduleTaskKey: 'flower', occurrence: 1, waiting: true, expectedFrom: '2026-11-25' }));
        await screen.findByTestId('plan-card-sign-question');
        await waitFor(() => expect(screen.getByTestId('plan-card-sign-seen')).not.toBeDisabled());
        for (const a of ['seen', 'not_yet', 'unsure']) {
            const button = screen.getByTestId(`plan-card-sign-${a}`);
            expect(button.className).toContain('min-h-[44px]');
        }
        fireEvent.click(screen.getByTestId('plan-card-sign-seen'));
        expect(await screen.findByTestId('plan-card-sign-kept')).toHaveTextContent('उत्तर फोनवर ठेवलं');
        const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.ScheduleTaskEvent).toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toMatchObject({ taskKey: 'flower', answer: 'seen', plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1', observedOn: '2026-11-23' });
        // The card never moves itself: the date stays what the server said until the pull brings the moved plan.
        expect(screen.getByTestId('plan-card-when')).toHaveTextContent('तारीख ठरलेली नाही');
    });

    it('a follower waiting on the work before it says so; a closed plan asks nothing', () => {
        draw(task({ ownItemId: ITEM, scheduleTaskKey: 'second', occurrence: 1, waiting: true, expectedFrom: '2026-11-28' }));
        expect(screen.getByTestId('plan-card-waiting')).toHaveTextContent('आधीचं काम नोंदल्यावर तारीख ठरेल');
        cleanup();
        draw(task({ ownItemId: ITEM, scheduleTaskKey: 'flower', occurrence: 1, status: 'Done', signAnswer: 'seen' }));
        expect(screen.queryByTestId('plan-card-sign')).toBeNull();
        expect(screen.queryByTestId('plan-card-waiting')).toBeNull();
    });

    it('English mode shows English only', async () => {
        await signWork();
        draw(task({ ownItemId: ITEM, scheduleTaskKey: 'flower', occurrence: 1, waiting: true, signAnswer: 'unsure' }), 'en');
        expect(screen.getByTestId('plan-card-from-schedule')).toHaveTextContent('From my schedule');
        expect(screen.getByTestId('plan-card-sign-last')).toHaveTextContent('Last answer: Not sure');
    });
});
