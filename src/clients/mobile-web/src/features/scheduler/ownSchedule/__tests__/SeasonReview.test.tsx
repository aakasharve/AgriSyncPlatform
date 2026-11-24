// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; SM-13; P8, P10) - the season-end review screen and its door: the design's
 * words, done-as-written pre-selected, differs with nothing pre-selected and both values, no record with two options, unanswered carried as scheduled and NAMED, one
 * `ownschedule.carry_forward` in the outbox (offline) that a second finish does not double, the answers stored: the review never pops again, and a seat with no planning
 * is never given the door. The carry rows the pull stores are shaped exactly as the server's pull sends them (`ownScheduleCarries`).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { reconcileOwnScheduleItems } from '../../../sync/pull/reconcilers/ownScheduleItemsReconciler';
import { OwnScheduleCarryForwardPayload } from '../../../../../../../../sync-contract/schemas/payloads/ownschedule_carry_forward.zod';
import type { ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { SeasonReview } from '../SeasonReview';
import { SeasonReviewEntry } from '../SeasonReviewEntry';
import { buildSeasonReview } from '../seasonReviewModel';
import { SEASON_REVIEW_WORDS } from '../seasonReviewWords';
import { ownItemIdFor } from '../ownWorkPlan';

const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const PLOT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const OLD = 'c1c1c1c1-0000-4000-8000-0000000000c1';
const NEXT = 'c2c2c2c2-0000-4000-8000-0000000000c2';

const timing = (from: number, to: number | null = null): ScheduleTaskContent['timing'] => ({
    timer: 'day', fromDay: from, toDay: to, afterTaskKey: null, usualDays: null, earliestDays: null, latestDays: null, signWords: null,
    expectedFromDay: null, expectedToDay: null, whenWords: null, repeat: 'once', repeatInterval: null, repeatEndDay: null, repeatEndSign: null,
});
const task = (key: string, name: string, t = timing(5)): ScheduleTaskContent => ({
    taskKey: key, name, kind: 'work', timing: t, basis: 'stated', stageIndex: 0, order: 0, why: null, dose: null, steps: [], products: [], reEntryHours: null,
    preHarvestDays: null, warnings: [], look: null, ask: null, sources: [], origin: null,
});

const MODEL = buildSeasonReview({
    works: [
        { taskKey: 'w-written', task: task('w-written', 'छाटणी', timing(5, 9)), state: 'active' },
        { taskKey: 'w-differs', task: task('w-differs', 'फवारणी', timing(10, 12)), state: 'active' },
        { taskKey: 'w-none', task: task('w-none', 'पाणी', timing(3)), state: 'active' },
        { taskKey: 'w-gone', task: task('w-gone', 'खुरपणी'), state: 'removed' },
    ],
    plans: [
        { id: 'p1', status: 'Done', ownItemId: ownItemIdFor(OLD, 'w-written'), linkedDailyLogIds: ['l1'], occurrence: 1 },
        { id: 'p2', status: 'Done', ownItemId: ownItemIdFor(OLD, 'w-differs'), linkedDailyLogIds: ['l2'], occurrence: 1 },
        { id: 'p3', status: 'Open', ownItemId: ownItemIdFor(OLD, 'w-gone'), linkedDailyLogIds: [], occurrence: 1 },
    ] as never,
    logDays: new Map([['l1', '2026-01-07'], ['l2', '2026-01-14']]),
    dayZero: '2026-01-01',
    cropCycleId: OLD,
});

const carries = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.OwnscheduleCarryForward);
const mount = (language: 'mr' | 'en' = 'mr') => render(
    <SeasonReview farmId={FARM} plotId={PLOT} plotName="प्लॉट १" fromCropCycleId={OLD} toCropCycleId={NEXT} model={MODEL} originNames={{ 'w-written': 'द्राक्ष: चाचणी संदर्भ', 'w-differs': null, 'w-none': null }}
        language={language} onBack={() => undefined} />,
);
const on = (key: string, c: string) => screen.getByTestId(`season-opt-${key}-${c}`).getAttribute('data-on');

afterEach(() => cleanup());
beforeEach(async () => { await resetDatabase(); await getDatabase().mutationQueue.clear(); });

describe('the screen', () => {
    it('speaks the design: origin and owner on each card, the chip, "पुढच्या वर्षी?", the three options, the closing card', () => {
        mount();
        const w = SEASON_REVIEW_WORDS.mr;
        expect(screen.getByTestId('season-origin-w-written')).toHaveTextContent('मूळ: द्राक्ष: चाचणी संदर्भ · मालक: तुम्ही');
        expect(screen.getByTestId('season-origin-w-none')).toHaveTextContent('मूळ: तुम्ही स्वतः · मालक: तुम्ही');
        expect(within(screen.getByTestId('season-q-w-written')).getByText('हंगामाच्या शेवटी')).toBeInTheDocument();
        expect(within(screen.getByTestId('season-q-w-written')).getByText('छाटणी: पुढच्या वर्षी?')).toBeInTheDocument();
        expect(screen.getByTestId('season-opt-w-written-schedule')).toHaveTextContent('शेड्यूलप्रमाणे');
        expect(screen.getByTestId('season-opt-w-written-mine')).toHaveTextContent('मी केलं तसं');
        expect(screen.getByTestId('season-opt-w-written-skip')).toHaveTextContent('नको');
        expect(screen.getByTestId('season-close')).toHaveTextContent('हेच माझं शेड्यूल');
        expect(screen.getByTestId('season-close')).toHaveTextContent('पुढच्या वर्षी यातूनच नियोजन.');
        expect(w.title).toBe('माझं शेड्यूल');
    });

    it('done as written is pre-selected; done differently has nothing pre-selected and shows both values with their sources; Devanagari digits', () => {
        mount();
        expect(on('w-written', 'schedule')).toBe('true');
        for (const c of ['schedule', 'mine', 'skip']) expect(on('w-differs', c)).toBe('false');
        const values = screen.getByTestId('season-values-w-differs');
        expect(values).toHaveTextContent('शेड्यूलमध्ये: दिवस ११ ते १३');
        expect(values).toHaveTextContent('तुमच्या नोंदीत: दिवस १४ (१४ जाने)'); // a machine date never reaches a farmer
        expect(values).not.toHaveTextContent('२०२६-०१-१४');
        expect(values).toHaveTextContent('स्रोत: तुमचं शेड्यूल');
        expect(values).toHaveTextContent('स्रोत: तुमची नोंद');
    });

    it('no record: only "शेड्यूलप्रमाणे" and "नको", and it never says "not done"', () => {
        mount();
        expect(screen.queryByTestId('season-opt-w-none-mine')).not.toBeInTheDocument();
        expect(screen.getByTestId('season-opt-w-none-schedule')).toBeInTheDocument();
        expect(screen.getByTestId('season-opt-w-none-skip')).toBeInTheDocument();
        expect(screen.getByTestId('season-norecord-w-none')).toHaveTextContent('याची नोंद नाही.');
        expect(document.body.textContent).not.toMatch(/झालं नाही|केलं नाही|not done/);
    });

    it('work only planned is listed apart and is carried only when he picks it', async () => {
        mount();
        expect(screen.getByTestId('season-planonly')).toHaveTextContent('खुरपणी');
        fireEvent.click(screen.getByTestId('season-finish'));
        await waitFor(async () => expect(await carries()).toHaveLength(1));
        expect((await carries())[0].payload).not.toHaveProperty('planOnly');
        cleanup();
        await getDatabase().mutationQueue.clear();
        mount();
        fireEvent.click(screen.getByTestId('season-planonly-w-gone'));
        fireEvent.click(screen.getByTestId('season-finish'));
        await waitFor(async () => expect(await carries()).toHaveLength(1));
        expect(((await carries())[0].payload as { planOnly: unknown }).planOnly).toEqual([{ taskKey: 'w-gone' }]);
    });

    it('English mode is English only', () => {
        mount('en');
        expect(screen.getByTestId('season-close')).toHaveTextContent('This is my schedule');
        expect(screen.getByTestId('season-opt-w-written-mine')).toHaveTextContent('As I did it');
        // The words of the screen are English only (the names of the works are the farmer's own data and stay as he wrote them).
        for (const id of ['season-opt-w-written-schedule', 'season-opt-w-differs-skip', 'season-norecord-w-none']) expect(screen.getByTestId(id).textContent).not.toMatch(/[ऀ-ॿ]/);
        expect(screen.getByTestId('season-values-w-differs').textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});

describe('finishing never refuses (P8) and is queued once (P10)', () => {
    it('with questions left unanswered the closing card NAMES them and they are carried as written: the outbox lists only the answered', async () => {
        mount();
        expect(screen.getByTestId('season-kept-note')).toHaveTextContent('उत्तर न दिलेली कामं: २');
        expect(screen.getByTestId('season-kept-note')).toHaveTextContent('फवारणी');
        expect(screen.getByTestId('season-kept-note')).toHaveTextContent('पाणी');
        expect(screen.getByTestId('season-kept-note')).toHaveTextContent('शेड्यूलप्रमाणेच पुढे घेतली जातील');
        fireEvent.click(screen.getByTestId('season-opt-w-differs-mine'));
        expect(screen.getByTestId('season-kept-note')).toHaveTextContent('उत्तर न दिलेली कामं: १');
        fireEvent.click(screen.getByTestId('season-finish'));
        await waitFor(async () => expect(await carries()).toHaveLength(1));
        const [row] = await carries();
        expect(row.status).toBe('PENDING');
        expect(OwnScheduleCarryForwardPayload.safeParse(row.payload).success).toBe(true);
        expect((row.payload as { answers: unknown }).answers).toEqual([{ taskKey: 'w-written', choice: 'schedule' }, { taskKey: 'w-differs', choice: 'mine' }]);
        expect(Object.keys(row.payload as object).sort()).toEqual(['answers', 'farmId', 'fromCropCycleId', 'plotId', 'toCropCycleId']);
        expect(screen.getByTestId('season-queued')).toHaveTextContent('ठेवलं. नेट आल्यावर पाठवलं जाईल.');
    });

    it('a second finish (or a second tap) queues nothing new: one request for the pair, replayed once', async () => {
        mount();
        fireEvent.click(screen.getByTestId('season-finish'));
        await waitFor(async () => expect(await carries()).toHaveLength(1));
        cleanup();
        mount();
        fireEvent.click(screen.getByTestId('season-finish'));
        await new Promise(r => setTimeout(r, 50));
        expect(await carries()).toHaveLength(1);
    });
});

const plot = { id: PLOT };
const putOwnWork = async (cycle: string, key: string, t: ScheduleTaskContent) => getDatabase().ownScheduleItems.put({
    id: ownItemIdFor(cycle, key), farmId: FARM, plotId: PLOT, cropCycleId: cycle, taskKey: key, revision: 1, state: 'active', task: t, contentHash: 'h', origin: null, mainVersionId: null, updatedAtUtc: '2026-01-01T00:00:00Z',
} as never);
const putCycle = async (id: string, start: string) => getDatabase().cropCycles.put({ id, farmId: FARM, plotId: plot.id, modifiedAtUtc: start, payload: { id, startDate: start } } as never);
const PLACE = { farmId: FARM, plotId: PLOT, cropCycleId: NEXT, plotName: 'प्लॉट १', cropName: 'Grapes' };

describe('the door: asked once, only to the right seat', () => {
    beforeEach(async () => {
        await getDatabase().referenceData.clear();
        await getDatabase().cropCycles.clear();
        await getDatabase().ownScheduleItems.clear();
        await putCycle(OLD, '2026-01-01');
        await putCycle(NEXT, '2027-01-01');
        await putOwnWork(OLD, 'w-written', task('w-written', 'छाटणी'));
    });

    it('a newer season with the old season\'s own works and no answers: the door asks', async () => {
        render(<SeasonReviewEntry place={PLACE} language="mr" />);
        await waitFor(() => expect(screen.getByTestId('season-entry')).toHaveAttribute('data-state', 'ask'));
        expect(screen.getByTestId('season-entry')).toHaveTextContent('हंगाम संपला');
        fireEvent.click(screen.getByTestId('season-entry-open'));
        expect(await screen.findByTestId('season-review')).toBeInTheDocument();
    });

    it('answers kept by the server (the pull\'s own key, as the server sends it) end the asking: it never pops again but stays readable', async () => {
        await reconcileOwnScheduleItems(getDatabase(), {
            ownScheduleCarries: [{
                id: 'e1e1e1e1-0000-4000-8000-0000000000e1', farmId: FARM, plotId: PLOT, fromCropCycleId: OLD, cropCycleId: NEXT, taskKey: 'w-written',
                previousItemId: ownItemIdFor(OLD, 'w-written'), newItemId: ownItemIdFor(NEXT, 'w-written'), choice: 'schedule', answered: false, recordedStoredDay: null, decidedAtUtc: '2027-01-02T00:00:00Z',
            }],
        } as never);
        render(<SeasonReviewEntry place={PLACE} language="mr" />);
        await waitFor(() => expect(screen.getByTestId('season-entry')).toHaveAttribute('data-state', 'answered'));
        expect(screen.getByTestId('season-entry')).toHaveTextContent('पुढच्या हंगामाचं शेड्यूल ठरलं आहे.');
        fireEvent.click(screen.getByTestId('season-entry-open'));
        expect(await screen.findByTestId('season-review-read')).toHaveTextContent('उत्तर न दिल्यामुळे शेड्यूलप्रमाणे घेतलं');
        expect(screen.queryByTestId('season-review')).not.toBeInTheDocument();
    });

    it('answers waiting in the outbox are kept on the phone and say so (not drawn as saved), and ask nothing again', async () => {
        const { OwnScheduleCommands } = await import('../../../../application/usecases/sync/OwnScheduleCommands');
        await OwnScheduleCommands.carryForward({ farmId: FARM, plotId: PLOT, fromCropCycleId: OLD, toCropCycleId: NEXT }, [{ taskKey: 'w-written', choice: 'schedule' }]);
        render(<SeasonReviewEntry place={PLACE} language="mr" />);
        await waitFor(() => expect(screen.getByTestId('season-entry')).toHaveAttribute('data-state', 'queued'));
        expect(screen.getByTestId('season-entry')).toHaveTextContent('फोनवर ठेवली आहेत');
        expect(screen.queryByTestId('season-entry-open')).not.toBeInTheDocument();
    });

    it('no older season with works, or the first season: nothing to ask', async () => {
        await getDatabase().ownScheduleItems.clear();
        render(<SeasonReviewEntry place={PLACE} language="mr" />);
        await new Promise(r => setTimeout(r, 80));
        expect(screen.queryByTestId('season-entry')).not.toBeInTheDocument();
    });
});
