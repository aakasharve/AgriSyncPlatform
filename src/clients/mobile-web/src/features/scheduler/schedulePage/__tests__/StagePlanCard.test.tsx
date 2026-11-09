// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Tasks 5 and 6; D-99 layout B, R10, R28, R34; P3, P4, P10, TAP-1)
 *
 * The stage panel "या स्टेजमध्ये शेड्यूल काय सांगतात", through the REAL SchedulerPage over a fake-indexeddb phone database, with the
 * server's answer (`GET /shramsafal/farms/{farmId}/plots/{plotId}/stage-plan`) put at the phone's own HTTP door:
 *   - layout B (D-99): the schedules outside (1, 2, 3 in order, a place the server did not name shows no number), then his own;
 *     inside each one the four parts in the app's order, and its empty parts named in ONE line;
 *   - "या स्टेजमध्ये N वेळा" is `TimesInStage` EXACTLY (never recounted from the days); a tap on it lists the days;
 *   - a work whose days the schedule does not write shows "दिवस शेड्यूलमध्ये लिहिलेले नाहीत" and NO number, and nothing to tap (P4);
 *   - "क्रम: ‹काम› झाल्यावर" from `AfterTitle` (R34); the तुलना line; NO done count, NO quantity (P3);
 *   - drawn after the "3 + 1" section and before the three buttons; no net: the last answer with its time, else "नेट आल्यावर दिसेल";
 *   - a 404, a refusal, an error or an answer that cannot be read draws NOTHING - never a fake;
 *   - Marathi mode Marathi only, English mode English only; the count is a 44px target.
 */
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const language = vi.hoisted(() => ({ current: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: language.current }) }));
vi.mock('../usePlotClips', () => ({ usePlotClips: () => new Map() }));
vi.mock('../../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../../finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 0 } }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

import SchedulerPage from '../../../../pages/SchedulerPage';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { agriSyncClient } from '../../../../infrastructure/api/AgriSyncClient';
import type { CropProfile } from '../../../../types';
import { REF, SERVER_TEMPLATE, crop, plot } from './scheduleFixtures';

const FARM = '11111111-1111-4111-8111-111111111111';
const PLOT_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const CYCLE_1 = 'cccccccc-0000-4000-8000-000000000001';
const T = { uni: '10000000-0000-4000-8000-000000000002', expert: '10000000-0000-4000-8000-000000000003', own: '10000000-0000-4000-8000-000000000005' } as const;
const S = { uni: 'dddddddd-0000-4000-8000-00000000000a', expert: 'dddddddd-0000-4000-8000-00000000000b', own: 'dddddddd-0000-4000-8000-00000000000d' } as const;
const PATH = `/shramsafal/farms/${FARM}/plots/${PLOT_1}/stage-plan`;

const checkedBy = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ ...SERVER_TEMPLATE, id, name, versionHash: 'h', ...extra });
const TEMPLATES = [
    row(T.uni, 'द्राक्ष विद्यापीठ शेड्यूल', { ownerType: 'INSTITUTION', check: checkedBy, hasStoredDays: true }),
    row(T.expert, 'द्राक्ष तज्ज्ञ शेड्यूल', { ownerType: 'EXPERT', check: checkedBy, hasStoredDays: true }),
    row(T.own, 'द्राक्ष माझं शेड्यूल', { ownerType: 'USER', check: null }),
];

const item = (over: Record<string, unknown>) => ({ activityId: 'a0000000-0000-4000-8000-000000000001', part: 'work', title: 'काम', operationKey: null, frequencyMode: null, intervalDays: null, days: null, timesInStage: null, afterTitle: null, ...over });
const water = item({ activityId: 'a0000000-0000-4000-8000-000000000001', part: 'irrigation', title: 'ठिबक सिंचन', frequencyMode: 'EveryNDays', intervalDays: 3, days: [0, 3, 6, 9, 12], timesInStage: 5 });
const spray = item({ activityId: 'a0000000-0000-4000-8000-000000000002', part: 'spray', title: 'बुरशीनाशक फवारणी', frequencyMode: 'OneTime', days: [8], timesInStage: 1, afterTitle: 'ठिबक सिंचन' });
const weeding = item({ activityId: 'a0000000-0000-4000-8000-000000000003', part: 'work', title: 'खुरपणी', frequencyMode: 'PerWeek', intervalDays: 1, days: [0, 7, 14], timesInStage: 3 });
const feed = item({ activityId: 'a0000000-0000-4000-8000-000000000004', part: 'nutrition', title: 'विद्राव्य खत', frequencyMode: 'EveryNDays', intervalDays: 2, days: null, timesInStage: null });
const schedule = (over: Record<string, unknown>) => ({ subscriptionId: S.uni, templateId: T.uni, name: 'द्राक्ष विद्यापीठ शेड्यूल', slot: 1, origin: 'Outside', isMain: true, check: checkedBy, items: [], ...over });
const PLAN = {
    serverTimeUtc: '2026-10-26T06:30:00Z', plotId: PLOT_1, needsSchedule: false,
    stage: { name: 'Post Pruning', startDay: 0, endDay: 14, dayToday: 9 },
    schedules: [
        schedule({ items: [water, spray, weeding] }),
        schedule({ subscriptionId: S.expert, templateId: T.expert, name: 'द्राक्ष तज्ज्ञ शेड्यूल', slot: 2, isMain: false, items: [feed] }),
        schedule({ subscriptionId: S.own, templateId: T.own, name: 'द्राक्ष माझं शेड्यूल', slot: 0, origin: 'Own', isMain: false, check: null, items: [] }),
    ],
};

const asResponse = (data: unknown) => ({ data, status: 200 });
const serves = (data: unknown) => vi.spyOn(agriSyncClient.http, 'get').mockResolvedValue(asResponse(data) as never);
const refuses = (status: number) => vi.spyOn(agriSyncClient.http, 'get').mockRejectedValue({ response: { status } });
const noNet = () => vi.spyOn(agriSyncClient.http, 'get').mockRejectedValue(new Error('Network Error'));

async function seedFollowing() {
    const db = getDatabase();
    await db.plots.put({ id: PLOT_1, farmId: FARM, payload: { id: PLOT_1, farmId: FARM, name: 'A' }, updatedAt: '2026-10-01T00:00:00Z' });
    await db.cropCycles.put({ id: CYCLE_1, farmId: FARM, plotId: PLOT_1, updatedAt: '2026-10-01T00:00:00Z', payload: { id: CYCLE_1, farmId: FARM, plotId: PLOT_1, cropName: 'Grapes', stage: 'x', startDate: REF } });
    await db.scheduleSubscriptions.bulkPut([
        { id: S.uni, farmId: FARM, plotId: PLOT_1, cropCycleId: CYCLE_1, templateId: T.uni, referenceDate: REF, state: 'Active', adoptedAtUtc: '2026-10-17T00:00:00Z', origin: 'Outside', checkState: 'Checked', slot: 1, isMain: true },
    ]);
}
const oneCrop = (): CropProfile[] => [crop([plot({ id: PLOT_1, name: 'A', schedule: { ...plot().schedule, id: 'sch-1', plotId: PLOT_1, templateId: T.uni } })], { activeScheduleId: T.uni })];
function mount() {
    const Harness = () => {
        const [crops, setCrops] = useState(oneCrop());
        return <SchedulerPage crops={crops} logs={[]} tasks={[]} onUpdateCrops={setCrops} onBack={() => undefined} onCloseDay={() => undefined} />;
    };
    render(<Harness />);
}
const card = () => screen.findByTestId('stage-plan-card');
const minHeight = (el: HTMLElement): number => Number(/min-h-\[(\d+)px\]/.exec(el.className)?.[1] ?? 0);

beforeAll(() => setScheduleTemplatesFromReferenceData(TEMPLATES));
beforeEach(async () => {
    language.current = 'mr';
    setScheduleTemplatesFromReferenceData(TEMPLATES);
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear()]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('layout B (D-99)', () => {
    it('Schedules_in_slot_order_with_his_own_last, each with its parts in the app\'s order and its empty parts in one line', async () => {
        await seedFollowing();
        const get = serves(PLAN);
        mount();
        const panel = await card();
        expect(get).toHaveBeenCalledWith(PATH); // the stage-plan door, for this plot (the server answers for today)
        expect(within(panel).getByTestId('stage-plan-title')).toHaveTextContent('या स्टेजमध्ये शेड्यूल काय सांगतात');
        expect(within(panel).getByTestId('stage-plan-stage')).toHaveTextContent('छाटणीनंतर');
        expect(within(panel).getByTestId('stage-plan-stage')).toHaveTextContent('दिवस 0–14');
        expect(within(panel).getByTestId('stage-plan-day')).toHaveTextContent('तुम्ही दिवस 9 वर');
        const order = [...panel.querySelectorAll('[data-testid^="stage-plan-schedule-"]')].map(e => [e.getAttribute('data-slot'), e.getAttribute('data-origin')]);
        expect(order).toEqual([['1', 'Outside'], ['2', 'Outside'], ['0', 'Own']]);
        // parts in the app's order inside schedule 1: सिंचन, फवारणी, कामे (खत is empty and named in one line)
        const first = within(panel).getByTestId(`stage-plan-schedule-${S.uni}`);
        const parts = [...first.querySelectorAll('[data-testid^="stage-plan-part-"]')].map(e => e.getAttribute('data-part'));
        expect(parts).toEqual(['irrigation', 'spray', 'work']);
        expect(within(first).getByTestId('stage-plan-empty-parts')).toHaveTextContent('या स्टेजमध्ये यात नाही: खत');
        // his own, empty: all four parts in one line
        const own = within(panel).getByTestId(`stage-plan-schedule-${S.own}`);
        expect(within(own).getByTestId('stage-plan-empty-parts')).toHaveTextContent('या स्टेजमध्ये यात नाही: सिंचन, खत, फवारणी, कामे');
        // the chips: a number in the schedule's colour for the outside ones, a pencil for his own; "मुख्य" on the one the server named
        expect(within(first).getByTestId('stage-plan-chip')).toHaveTextContent('1');
        expect(within(panel).getByTestId(`stage-plan-schedule-${S.expert}`).querySelector('[data-testid="stage-plan-chip"]')).toHaveTextContent('2');
        expect(own.querySelector('[data-testid="stage-plan-chip"]')).toHaveAttribute('data-own', 'yes');
        expect(within(first).getByTestId('stage-plan-main')).toHaveTextContent('मुख्य');
        expect(own.querySelector('[data-testid="stage-plan-main"]')).toBeNull();
    });

    it('A_place_the_server_did_not_name_shows_no_number (never the own place, never a made-up one)', async () => {
        await seedFollowing();
        serves({ ...PLAN, schedules: [schedule({ slot: null, items: [water] })] });
        mount();
        const panel = await card();
        expect(within(panel).getByTestId('stage-plan-chip').textContent).toBe('');
        expect(within(panel).getByTestId('stage-plan-chip')).toHaveAttribute('data-slot', '');
    });

    it('Drawn_after_the_3_plus_1_section_and_before_the_three_buttons', async () => {
        await seedFollowing();
        serves(PLAN);
        mount();
        const panel = await card();
        const section = screen.getByTestId('three-plus-one');
        const tabs = screen.getByTestId('sched-tabs');
        expect(section.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(panel.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('the numbers (P3, P4)', () => {
    it('Times_are_TimesInStage_exactly: never recounted from the days', async () => {
        await seedFollowing();
        serves({ ...PLAN, schedules: [schedule({ items: [{ ...water, days: [0, 3, 6, 9, 12], timesInStage: 7 }] })] });
        mount();
        const panel = await card();
        expect(within(panel).getByTestId(`stage-plan-times-${water.activityId}`)).toHaveTextContent('या स्टेजमध्ये 7 वेळा');
    });

    it('A_tap_on_the_count_lists_its_days: closed at first, a second tap closes it', async () => {
        await seedFollowing();
        serves(PLAN);
        mount();
        const panel = await card();
        expect(within(panel).queryByTestId(`stage-plan-days-${water.activityId}`)).toBeNull();
        const times = within(panel).getByTestId(`stage-plan-times-${water.activityId}`);
        expect(times).toHaveTextContent('या स्टेजमध्ये 5 वेळा');
        fireEvent.click(times);
        expect(within(panel).getByTestId(`stage-plan-days-${water.activityId}`)).toHaveTextContent('दिवस: 0, 3, 6, 9, 12');
        fireEvent.click(times);
        expect(within(panel).queryByTestId(`stage-plan-days-${water.activityId}`)).toBeNull();
    });

    it('Null_days_draw_no_number_and_say_so: the words, no count, nothing to tap, no days', async () => {
        await seedFollowing();
        serves(PLAN);
        mount();
        const panel = await card();
        const line = within(panel).getByTestId(`stage-plan-item-${feed.activityId}`);
        expect(within(line).getByTestId(`stage-plan-nodays-${feed.activityId}`)).toHaveTextContent('दिवस शेड्यूलमध्ये लिहिलेले नाहीत');
        expect(line.textContent).not.toMatch(/वेळा/);
        expect(line.textContent).not.toMatch(/\d{2,}|\b[1-9]\b.*वेळा/);
        expect(within(line).queryByTestId(`stage-plan-times-${feed.activityId}`)).toBeNull();
        expect(within(line).queryByTestId(`stage-plan-days-${feed.activityId}`)).toBeNull();
        expect(line.querySelector('button')).toBeNull();
    });

    it('The_repeat_and_the_order: "दर 3 दिवसांनी", "एकदाच", "आठवड्यातून 1 वेळा" and "क्रम: ‹काम› झाल्यावर" only where the schedule stores an order (R34)', async () => {
        await seedFollowing();
        serves(PLAN);
        mount();
        const panel = await card();
        expect(within(panel).getByTestId(`stage-plan-item-${water.activityId}`)).toHaveTextContent('दर 3 दिवसांनी');
        expect(within(panel).getByTestId(`stage-plan-item-${spray.activityId}`)).toHaveTextContent('एकदाच');
        expect(within(panel).getByTestId(`stage-plan-item-${weeding.activityId}`)).toHaveTextContent('आठवड्यातून 1 वेळा');
        expect(within(panel).getByTestId(`stage-plan-after-${spray.activityId}`)).toHaveTextContent('क्रम: ठिबक सिंचन झाल्यावर');
        expect(within(panel).queryByTestId(`stage-plan-after-${water.activityId}`)).toBeNull();
    });

    it('No_done_count_no_quantity_and_the_Compare_line: the card counts what the schedule asks, never what was done', async () => {
        await seedFollowing();
        serves(PLAN);
        mount();
        const panel = await card();
        expect(panel.querySelector('[data-status]')).toBeNull();
        expect(panel.querySelector('[data-testid*="done"], [data-testid*="missed"]')).toBeNull();
        const footer = within(panel).getByTestId('stage-plan-footer');
        expect(footer).toHaveTextContent('प्रत्येक आकडा शेड्यूलमध्ये लिहिलेल्या दिवसांवरून मोजला आहे. यातलं किती झालं, ते तुलना मध्ये दिसतं.');
        const outside = (panel.textContent ?? '').replace(footer.textContent ?? '', '');
        expect(outside).not.toMatch(/झालं|राहिलं|अपेक्षित/);
        expect(outside).not.toMatch(/लिटर|किलो|ml|kg|₹/);
    });

    it('A_plot_with_nothing_followed: the server counts nothing and the card says so', async () => {
        await seedFollowing();
        serves({ ...PLAN, needsSchedule: true, schedules: [] });
        mount();
        const panel = await card();
        expect(within(panel).getByTestId('stage-plan-none')).toHaveTextContent('तुम्ही अजून कोणतंही शेड्यूल पाळत नाही.');
    });
});

describe('no net, refusals and bad answers (P10)', () => {
    it('No_net_and_nothing_kept: "नेट आल्यावर दिसेल" and nothing else', async () => {
        await seedFollowing();
        noNet();
        mount();
        const panel = await card();
        expect(within(panel).getByTestId('stage-plan-offline')).toHaveTextContent('नेट आल्यावर दिसेल');
        expect(panel.querySelector('[data-testid^="stage-plan-schedule-"]')).toBeNull();
    });

    it('No_net_with_a_kept_answer: the last answer, with the time it was received', async () => {
        await seedFollowing();
        const online = serves(PLAN);
        mount();
        await card();
        await waitFor(async () => expect(await getDatabase().appMeta.get(`shramsafal_stage_plan_v1:${PLOT_1}`)).toBeDefined());
        cleanup();
        online.mockRejectedValue(new Error('Network Error'));
        mount();
        const panel = await card();
        expect(within(panel).getByTestId(`stage-plan-times-${water.activityId}`)).toHaveTextContent('या स्टेजमध्ये 5 वेळा');
        expect(within(panel).getByTestId('stage-plan-asof')).toHaveTextContent('मिळालेली वेळ:');
        expect(within(panel).queryByTestId('stage-plan-offline')).toBeNull();
    });

    it('A_404_draws_nothing_and_forgets_what_was_kept (never reveal, never a fake)', async () => {
        await seedFollowing();
        const online = serves(PLAN);
        mount();
        await card();
        await waitFor(async () => expect(await getDatabase().appMeta.get(`shramsafal_stage_plan_v1:${PLOT_1}`)).toBeDefined());
        cleanup();
        online.mockRejectedValue({ response: { status: 404 } });
        mount();
        await screen.findByTestId('sched-header');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
        expect(screen.queryByTestId('stage-plan-card')).toBeNull();
        await waitFor(async () => expect(await getDatabase().appMeta.get(`shramsafal_stage_plan_v1:${PLOT_1}`)).toBeUndefined());
    });

    it('A_refusal_or_an_error_draws_nothing: 403, 500', async () => {
        await seedFollowing();
        for (const status of [403, 500]) {
            refuses(status);
            mount();
            await screen.findByTestId('sched-header');
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
            expect(screen.queryByTestId('stage-plan-card')).toBeNull();
            cleanup();
            vi.restoreAllMocks();
        }
    });

    it('An_answer_that_cannot_be_read_draws_nothing: never half a panel', async () => {
        await seedFollowing();
        serves({ ...PLAN, schedules: [schedule({ items: [{ ...water, days: 'every third day' }] })] });
        mount();
        await screen.findByTestId('sched-header');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
        expect(screen.queryByTestId('stage-plan-card')).toBeNull();
    });

    it('A_plot_the_phone_does_not_know_a_farm_for_is_not_asked: no request', async () => {
        const get = serves(PLAN);
        await getDatabase().scheduleSubscriptions.clear();
        mount(); // no plot row in the phone's store: no farm to ask under
        await screen.findByTestId('sched-header');
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
        expect(get).not.toHaveBeenCalled();
        expect(screen.queryByTestId('stage-plan-card')).toBeNull();
    });
});

describe('words and targets', () => {
    it('Marathi_mode_no_Latin_letter: every word on the card is Marathi', async () => {
        await seedFollowing();
        serves(PLAN);
        mount();
        const panel = await card();
        expect(panel.textContent ?? '').not.toMatch(/[A-Za-z]/);
        expect(panel.textContent ?? '').not.toMatch(/\p{Extended_Pictographic}/u);
        expect(panel.textContent ?? '').not.toMatch(/\bAI\b/);
    });

    it('English_mode_English_only: the card in English', async () => {
        language.current = 'en';
        await seedFollowing();
        let n = 0;
        const english = (title: string, part: string, extra: Record<string, unknown> = {}) => item({ activityId: `a0000000-0000-4000-8000-00000000010${n++}`, title, part, ...extra });
        serves({
            ...PLAN,
            stage: { name: 'Post Pruning', startDay: 0, endDay: 14, dayToday: 9 },
            schedules: [schedule({ name: 'University Schedule', items: [
                english('Drip irrigation', 'irrigation', { frequencyMode: 'EveryNDays', intervalDays: 3, days: [0, 3], timesInStage: 2 }),
                english('Fungicide spray', 'spray', { frequencyMode: 'OneTime', days: [8], timesInStage: 1, afterTitle: 'Drip irrigation' }),
                english('Feed', 'nutrition', { days: null, timesInStage: null }),
            ] })],
        });
        mount();
        const panel = await card();
        expect(within(panel).getByTestId('stage-plan-title')).toHaveTextContent('What the schedules say for this stage');
        expect(within(panel).getByTestId('stage-plan-day')).toHaveTextContent('You are on day 9');
        expect(within(panel).getByTestId('stage-plan-times-a0000000-0000-4000-8000-000000000100')).toHaveTextContent('2 times in this stage');
        expect(panel.textContent).toContain('Every 3 days');
        expect(panel.textContent).toContain('Order: after Drip irrigation');
        expect(panel.textContent).toContain('The schedule does not write the days');
        expect(within(panel).getByTestId('stage-plan-empty-parts')).toHaveTextContent('Nothing in this stage for: Work');
        expect(within(panel).getByTestId('stage-plan-footer')).toHaveTextContent('How much was done shows in Compare.');
        expect(panel.textContent ?? '').not.toMatch(/[ऀ-ॿ]/);
    });

    it('The_count_is_a_44px_target', async () => {
        await seedFollowing();
        serves(PLAN);
        mount();
        const panel = await card();
        expect(minHeight(within(panel).getByTestId(`stage-plan-times-${water.activityId}`))).toBeGreaterThanOrEqual(44);
    });
});
