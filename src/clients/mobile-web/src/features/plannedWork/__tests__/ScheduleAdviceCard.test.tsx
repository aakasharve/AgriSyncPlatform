// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ADV Task 2; D-74 note, D-87 = 1, D-83 = 1, D-24d; R12, R28; P4, P10, TAP-1)
 *
 * The plan form's card "तुमची शेड्यूल या स्टेजमध्ये ‹कामा›बद्दल काय सांगतात", through the REAL `PlanForm` over a fake-indexeddb phone database,
 * with the server's answer (`GET /shramsafal/farms/{farmId}/plots/{plotId}/schedule-advice`) put at the phone's own HTTP door:
 *   - the card appears only after the three answers (the work, ONE place, the day), asked once per pause in his typing;
 *   - each schedule's chip and items are the stage panel's own pieces (the same testids and words); "या स्टेजमध्ये N वेळा" is the server's number;
 *   - "या स्टेजमध्ये या शेड्यूलमध्ये हे काम नाही" for a schedule without that work; a work whose days are not written shows no number (P4);
 *   - "हा फक्त सल्ला आहे ..." is on the card; NOTHING from the card is ever copied into the saved task (D-24d);
 *   - no net: the last answer for that plot with its time, else "नेट आल्यावर दिसेल"; the kept answer belongs to the signed-in user only;
 *   - a bad answer, a 403, a 404 or an error draws nothing and never throws into the page; a seat that may not plan sees no card.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { CropProfile, FarmerProfile } from '../../../types';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { parseScheduleAdvice } from '../../../infrastructure/api/scheduleAdviceDtos';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { setActiveDatabaseName } from '../../../infrastructure/storage/activeDatabaseName';
import { readCachedScheduleAdvice, saveScheduleAdvice, scheduleAdviceMetaKey } from '../../../infrastructure/storage/scheduleAdviceStore';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { PlanForm, type PlanFormProps } from '../components/PlanForm';
import { ADVICE_DEBOUNCE_MS, useScheduleAdvice } from '../data/scheduleAdviceClient';
import { ScheduleAdviceView } from '../components/ScheduleAdviceCard';

vi.mock('../components/PlanMic', () => ({
    PlanMic: () => <button type="button" data-testid="plan-mic">mic</button>,
}));

const FARM = '55555555-5555-4555-8555-555555555551';
const ME = '22222222-2222-4222-8222-222222222222';
const OTHER_USER = '22222222-2222-4222-8222-222222222299';
const PLOT_GRAPE = '44444444-4444-4444-8444-444444444443';
const TODAY = new Date(2026, 10, 8);
const PATH = `/shramsafal/farms/${FARM}/plots/${PLOT_GRAPE}/schedule-advice`;
const CROPS = [{ id: 'grape', name: 'द्राक्ष', iconName: 'Grape', color: 'emerald', plots: [{ id: PLOT_GRAPE, name: 'सोनाका' }] }] as unknown as CropProfile[];
const PROFILE = { operators: [], activeOperatorId: '' } as unknown as FarmerProfile;

const S1 = 'dddddddd-0000-4000-8000-00000000000a';
const S2 = 'dddddddd-0000-4000-8000-00000000000b';
const A1 = 'a0000000-0000-4000-8000-000000000001';
const A2 = 'a0000000-0000-4000-8000-000000000002';
const checkedBy = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const sprayItem = {
    activityId: A1, part: 'spray', title: 'बुरशीनाशक फवारणी', operationKey: 'op_spray_gen', frequencyMode: 'EveryNDays', intervalDays: 5,
    days: [13, 18, 23, 28, 33, 38], timesInStage: 6, afterTitle: null,
};
const wordsOnlySpray = { ...sprayItem, activityId: A2, title: 'फवारणी (नमुना)', frequencyMode: null, intervalDays: null, days: null, timesInStage: null };
const ADVICE = {
    serverTimeUtc: '2026-11-08T06:30:00Z', needsSchedule: false, notRecognised: false, part: 'spray', operationKey: 'op_spray_gen',
    stage: { name: 'Canopy Build', startDay: 13, endDay: 40, dayToday: 20 },
    lines: [
        { subscriptionId: S1, scheduleName: 'द्राक्ष विद्यापीठ शेड्यूल', slot: 1, origin: 'Outside', check: checkedBy, items: [sprayItem], nothingInStage: false },
        { subscriptionId: S2, scheduleName: 'द्राक्ष तज्ज्ञ शेड्यूल', slot: 2, origin: 'Outside', check: checkedBy, items: [], nothingInStage: true },
    ],
};

const asResponse = (data: unknown) => ({ data, status: 200 });
const serves = (data: unknown) => vi.spyOn(agriSyncClient.http, 'get').mockResolvedValue(asResponse(data) as never);
const refuses = (status: number) => vi.spyOn(agriSyncClient.http, 'get').mockRejectedValue({ response: { status } });
const noNet = () => vi.spyOn(agriSyncClient.http, 'get').mockRejectedValue(new Error('Network Error'));

const setup = (over: Partial<PlanFormProps> = {}) => {
    const onSaved = vi.fn();
    const utils = render(
        <PlanForm farmId={FARM} userId={ME} language="mr" crops={CROPS} farmerProfile={PROFILE} mayAssign assignees={[]} today={TODAY}
            onSaved={onSaved} mayAdvise {...over} />,
    );
    return { onSaved, ...utils };
};
const chooseWork = (text = 'फवारणी') => fireEvent.change(screen.getByTestId('plan-work-input'), { target: { value: text } });
const choosePlot = () => fireEvent.click(screen.getByTestId('flow-crop-grape')); // a crop with ONE plot has it chosen as the crop is
const chooseWhen = (id = 'plan-when-tomorrow') => fireEvent.click(screen.getByTestId(id));
const chooseAll = (text = 'फवारणी') => { chooseWork(text); choosePlot(); chooseWhen(); };
const card = () => screen.findByTestId('schedule-advice-card', undefined, { timeout: 4000 });
const setOnline = (value: boolean) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });

beforeEach(async () => {
    setOnline(true);
    await resetDatabase();
    await Promise.all([getDatabase().mutationQueue.clear(), getDatabase().appMeta.clear()]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); setOnline(true); });

describe('when the card appears', () => {
    it('the card appears only after the work, one place and the day are all there, and asks once', async () => {
        const get = serves(ADVICE);
        setup();
        chooseWork();
        choosePlot();
        await new Promise(r => setTimeout(r, 800));
        expect(screen.queryByTestId('schedule-advice-card')).toBeNull();
        expect(get).not.toHaveBeenCalled(); // no day yet

        chooseWhen('plan-when-tomorrow');
        const panel = await card();
        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith(PATH, { params: { words: 'फवारणी', date: '2026-11-09' } });
        expect(within(panel).getByTestId('schedule-advice-title')).toHaveTextContent('तुमची शेड्यूल या स्टेजमध्ये फवारणीबद्दल काय सांगतात');
    });

    it('a loose "when" sends loose, not a date', async () => {
        const get = serves(ADVICE);
        setup();
        chooseWork();
        choosePlot();
        chooseWhen('plan-when-week');
        await card();
        expect(get).toHaveBeenCalledWith(PATH, { params: { words: 'फवारणी', loose: 'Week' } });
    });

    it('typing does not ask per keystroke: several edits in a burst make one request', async () => {
        const get = serves(ADVICE);
        setup();
        choosePlot();
        chooseWhen();
        for (const text of ['फ', 'फव', 'फवा', 'फवार', 'फवारणी']) chooseWork(text);
        await card();
        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith(PATH, { params: { words: 'फवारणी', date: '2026-11-09' } });
    });

    it('the whole farm (no single plot) asks nothing', async () => {
        const get = serves(ADVICE);
        setup();
        chooseWork();
        fireEvent.click(screen.getByTestId('flow-crop-whole-farm'));
        chooseWhen();
        await new Promise(r => setTimeout(r, 900));
        expect(get).not.toHaveBeenCalled();
        expect(screen.queryByTestId('schedule-advice-card')).toBeNull();
    });

    it('a seat that may not plan sees no card and sends no request', async () => {
        const get = serves(ADVICE);
        setup({ mayAdvise: false });
        chooseAll();
        await new Promise(r => setTimeout(r, 900));
        expect(get).not.toHaveBeenCalled();
        expect(screen.queryByTestId('schedule-advice-card')).toBeNull();
    });
});

describe('what the card shows', () => {
    it('each schedule has its chip and name, and each item is the stage panel\'s own piece with the server\'s number', async () => {
        serves(ADVICE);
        setup();
        chooseAll();
        const panel = await card();
        expect(within(panel).getByTestId('schedule-advice-stage')).toHaveTextContent('दिवस 13–40');
        expect(within(panel).getByTestId('schedule-advice-day')).toHaveTextContent('तुम्ही दिवस 20 वर');
        const lines = [...panel.querySelectorAll('[data-testid^="schedule-advice-line-"]')];
        expect(lines.map(l => [l.getAttribute('data-slot'), l.getAttribute('data-origin')])).toEqual([['1', 'Outside'], ['2', 'Outside']]);
        const first = within(lines[0] as HTMLElement);
        expect(first.getByTestId('stage-plan-chip')).toHaveTextContent('1');
        expect(lines[0]).toHaveTextContent('द्राक्ष विद्यापीठ शेड्यूल');
        // the panel's own item line: the same testids and the same words
        expect(first.getByTestId(`stage-plan-item-${A1}`)).toHaveTextContent('बुरशीनाशक फवारणी');
        expect(first.getByTestId(`stage-plan-repeat-${A1}`)).toHaveTextContent('दर 5 दिवसांनी');
        expect(first.getByTestId(`stage-plan-times-${A1}`)).toHaveTextContent('या स्टेजमध्ये 6 वेळा');
        fireEvent.click(first.getByTestId(`stage-plan-times-${A1}`));
        expect(first.getByTestId(`stage-plan-days-${A1}`)).toHaveTextContent('दिवस: 13, 18, 23, 28, 33, 38');
        const second = within(lines[1] as HTMLElement);
        expect(second.getByTestId('stage-plan-chip')).toHaveTextContent('2');
    });

    it('a schedule without that work says "या स्टेजमध्ये या शेड्यूलमध्ये हे काम नाही"', async () => {
        serves(ADVICE);
        setup();
        chooseAll();
        const panel = await card();
        const second = panel.querySelector(`[data-testid="schedule-advice-line-${S2}"]`) as HTMLElement;
        expect(within(second).getByTestId('schedule-advice-nothing')).toHaveTextContent('या स्टेजमध्ये या शेड्यूलमध्ये हे काम नाही');
        const first = panel.querySelector(`[data-testid="schedule-advice-line-${S1}"]`) as HTMLElement;
        expect(within(first).queryByTestId('schedule-advice-nothing')).toBeNull();
    });

    it('a work whose days the schedule does not write shows no number (P4)', async () => {
        serves({ ...ADVICE, lines: [{ ...ADVICE.lines[0], items: [wordsOnlySpray] }] });
        setup();
        chooseAll();
        const panel = await card();
        expect(within(panel).getByTestId(`stage-plan-nodays-${A2}`)).toHaveTextContent('दिवस शेड्यूलमध्ये लिहिलेले नाहीत');
        expect(within(panel).queryByTestId(`stage-plan-times-${A2}`)).toBeNull();
        expect(panel.textContent).not.toMatch(/\d+ वेळा/);
    });

    it('his own schedule has the pencil chip and no number', async () => {
        const own = { subscriptionId: S2, scheduleName: 'द्राक्ष माझं शेड्यूल', slot: 0, origin: 'Own', check: null, items: [sprayItem], nothingInStage: false };
        serves({ ...ADVICE, lines: [ADVICE.lines[0], own] });
        setup();
        chooseAll();
        const panel = await card();
        const mine = panel.querySelector(`[data-testid="schedule-advice-line-${S2}"]`) as HTMLElement;
        expect(mine.getAttribute('data-origin')).toBe('Own');
        expect(within(mine).getByTestId('stage-plan-chip').getAttribute('data-own')).toBe('yes');
        expect(mine).toHaveTextContent('स्वतःचं');
    });

    it('says "हा फक्त सल्ला आहे ..." and holds no quantity, dose or done count', async () => {
        serves(ADVICE);
        setup();
        chooseAll();
        const panel = await card();
        expect(within(panel).getByTestId('schedule-advice-footer')).toHaveTextContent('हा फक्त सल्ला आहे; तुमच्या कामात यातलं काहीही आपोआप भरलं जात नाही.');
        expect(panel.textContent).not.toMatch(/मात्रा|प्रमाण|डोस|ml|लिटर|kg|किलो|₹|झालं/);
    });

    it('words that name no work say so, with no lines (R12)', async () => {
        serves({ ...ADVICE, notRecognised: true, part: null, operationKey: null, lines: [] });
        setup();
        chooseAll('ळळळ');
        const panel = await card();
        expect(within(panel).getByTestId('schedule-advice-not-recognised')).toBeInTheDocument();
        expect(panel.querySelector('[data-testid^="schedule-advice-line-"]')).toBeNull();
    });

    it('"must choose a schedule first" and "no stage to speak of" draw nothing (the page\'s own ask stands in front)', async () => {
        const get = serves({ ...ADVICE, needsSchedule: true, stage: null, lines: [] });
        setup();
        chooseAll();
        await waitFor(() => expect(get).toHaveBeenCalled());
        await new Promise(r => setTimeout(r, 200));
        expect(screen.queryByTestId('schedule-advice-card')).toBeNull();
        cleanup();
        vi.restoreAllMocks();
        const get2 = serves({ ...ADVICE, stage: null, lines: [] });
        setup();
        chooseAll();
        await waitFor(() => expect(get2).toHaveBeenCalled());
        await new Promise(r => setTimeout(r, 200));
        expect(screen.queryByTestId('schedule-advice-card')).toBeNull();
    });

    it('English mode shows English only, Marathi mode Marathi only (the data names aside)', async () => {
        const english = {
            ...ADVICE,
            lines: [
                { ...ADVICE.lines[0], scheduleName: 'University Schedule', items: [{ ...sprayItem, title: 'Fungicide Spray' }] },
                { ...ADVICE.lines[1], scheduleName: 'Expert Schedule' },
            ],
        };
        serves(english);
        setup({ language: 'en' });
        chooseWork('Spray');
        choosePlot();
        chooseWhen();
        const panel = await card();
        expect(panel.textContent).not.toMatch(/[ऀ-ॿ]/);
        expect(within(panel).getByTestId('schedule-advice-title')).toHaveTextContent('What your schedules say about Spray in this stage');
        expect(panel).toHaveTextContent('This schedule has no such work in this stage');
        expect(panel).toHaveTextContent('6 times in this stage');
        expect(panel).toHaveTextContent('This is only advice; nothing from it is filled into your work automatically.');
        cleanup();
        vi.restoreAllMocks();
        serves(ADVICE);
        setup({ language: 'mr' });
        chooseAll();
        const marathi = await card();
        expect(marathi.textContent).not.toMatch(/[A-Za-z]/);
    });

    it('the tap target of the work\'s days is at least 44px (TAP-1)', async () => {
        serves(ADVICE);
        setup();
        chooseAll();
        const panel = await card();
        const tap = within(panel).getByTestId(`stage-plan-times-${A1}`);
        expect(Number(/min-h-\[(\d+)px\]/.exec(tap.className)?.[1] ?? 0)).toBeGreaterThanOrEqual(44);
    });
});

describe('no net, a refusal, a bad answer', () => {
    it('no net: the kept answer for that plot with its time; else "नेट आल्यावर दिसेल"', async () => {
        // an answer was kept earlier (this user, this plot)
        const kept = parseScheduleAdvice(ADVICE)!;
        await saveScheduleAdvice(FARM, PLOT_GRAPE, ME, 'फवारणी', kept);
        noNet();
        setup();
        chooseAll();
        let panel = await card();
        expect(panel.getAttribute('data-source')).toBe('cache');
        expect(within(panel).getByTestId('schedule-advice-asof')).toHaveTextContent('मिळालेली वेळ: 08-11');
        expect(within(panel).getByTestId(`stage-plan-times-${A1}`)).toHaveTextContent('या स्टेजमध्ये 6 वेळा');
        cleanup();

        await getDatabase().appMeta.clear();
        vi.restoreAllMocks();
        setOnline(false);
        const get = serves(ADVICE);
        setup();
        chooseAll();
        panel = await card();
        expect(get).not.toHaveBeenCalled(); // the device says it is offline: the server is not asked
        expect(within(panel).getByTestId('schedule-advice-offline')).toHaveTextContent('नेट आल्यावर दिसेल');
    });

    it('a kept answer written for another user is never shown', async () => {
        await saveScheduleAdvice(FARM, PLOT_GRAPE, OTHER_USER, 'फवारणी', parseScheduleAdvice(ADVICE)!);
        expect(await readCachedScheduleAdvice(FARM, PLOT_GRAPE, ME)).toBeNull();
        expect(await readCachedScheduleAdvice(FARM, PLOT_GRAPE, OTHER_USER)).not.toBeNull();
        expect(await readCachedScheduleAdvice(FARM, PLOT_GRAPE, null)).toBeNull();
        noNet();
        setup();
        chooseAll();
        const panel = await card();
        expect(within(panel).getByTestId('schedule-advice-offline')).toHaveTextContent('नेट आल्यावर दिसेल');
        expect(panel.textContent).not.toContain('बुरशीनाशक');
    });

    it('nothing is kept when no user id is known', async () => {
        await saveScheduleAdvice(FARM, PLOT_GRAPE, null, 'फवारणी', parseScheduleAdvice(ADVICE)!);
        expect(await getDatabase().appMeta.get(scheduleAdviceMetaKey(FARM, PLOT_GRAPE))).toBeUndefined();
    });

    it('a good answer is kept with the user id, the words and the server\'s time', async () => {
        serves(ADVICE);
        setup();
        chooseAll();
        await card();
        await waitFor(async () => expect(await readCachedScheduleAdvice(FARM, PLOT_GRAPE, ME)).not.toBeNull());
        const row = (await getDatabase().appMeta.get(scheduleAdviceMetaKey(FARM, PLOT_GRAPE)))!.value as { userId: string; words: string; advice: { serverTimeUtc: string } };
        expect(row.userId).toBe(ME);
        expect(row.words).toBe('फवारणी');
        expect(row.advice.serverTimeUtc).toBe('2026-11-08T06:30:00Z');
    });

    it('a 403 or a 404 draws nothing and forgets what was kept', async () => {
        for (const status of [403, 404]) {
            await saveScheduleAdvice(FARM, PLOT_GRAPE, ME, 'फवारणी', parseScheduleAdvice(ADVICE)!);
            const get = refuses(status);
            setup();
            chooseAll();
            await waitFor(() => expect(get).toHaveBeenCalled());
            await waitFor(async () => expect(await readCachedScheduleAdvice(FARM, PLOT_GRAPE, ME)).toBeNull());
            expect(screen.queryByTestId('schedule-advice-card')).toBeNull();
            cleanup();
            vi.restoreAllMocks();
        }
    });

    it('a server error draws nothing', async () => {
        const get = refuses(500);
        setup();
        chooseAll();
        await waitFor(() => expect(get).toHaveBeenCalled());
        await new Promise(r => setTimeout(r, 200));
        expect(screen.queryByTestId('schedule-advice-card')).toBeNull();
    });

    it('a bad answer draws nothing, whole-or-nothing, and never throws into the page', async () => {
        const broken = [
            { ...ADVICE, lines: 'x' },
            { ...ADVICE, lines: [{ ...ADVICE.lines[0], items: [{ ...sprayItem, timesInStage: 'six' }] }] },
            { ...ADVICE, lines: [{ ...ADVICE.lines[0], nothingInStage: 'no' }] },
            { ...ADVICE, notRecognised: undefined },
            null,
            'html',
        ];
        for (const body of broken) {
            expect(parseScheduleAdvice(body)).toBeNull();
        }
        const get = serves(broken[1]);
        setup();
        chooseAll();
        await waitFor(() => expect(get).toHaveBeenCalled());
        await new Promise(r => setTimeout(r, 200));
        expect(screen.queryByTestId('schedule-advice-card')).toBeNull();
        expect(screen.getByTestId('plan-form')).toBeInTheDocument(); // the page is alive; nothing a retry was needed for
        expect(await readCachedScheduleAdvice(FARM, PLOT_GRAPE, ME)).toBeNull();
    });

    it('re-binds when the active phone database changes: the old answer is not shown for the new person', async () => {
        serves(ADVICE);
        setup();
        chooseAll();
        await card();
        const get = vi.spyOn(agriSyncClient.http, 'get').mockImplementation(() => new Promise(() => undefined));
        act(() => setActiveDatabaseName('agrilog-someone-else'));
        await waitFor(() => expect(screen.queryByTestId('schedule-advice-card')).toBeNull());
        await waitFor(() => expect(get).toHaveBeenCalled());
        act(() => setActiveDatabaseName(''));
    });
});

describe('which answer counts (review P005)', () => {
    it('an OLDER response that finishes after a NEWER one is neither shown nor kept', async () => {
        let resolveOlder: (v: unknown) => void = () => undefined;
        let resolveNewer: (v: unknown) => void = () => undefined;
        const older = new Promise(r => { resolveOlder = r; });
        const newer = new Promise(r => { resolveNewer = r; });
        const get = vi.spyOn(agriSyncClient.http, 'get').mockReturnValueOnce(older as never).mockReturnValueOnce(newer as never);
        setup();
        choosePlot();
        chooseWhen();
        chooseWork('फवारणी');
        await waitFor(() => expect(get).toHaveBeenCalledTimes(1), { timeout: 4000 });
        chooseWork('खत'); // the question changed while the first answer is still on its way
        await waitFor(() => expect(get).toHaveBeenCalledTimes(2), { timeout: 4000 });

        const NEWER_ADVICE = {
            ...ADVICE, serverTimeUtc: '2026-11-08T07:00:00Z', part: 'nutrition',
            lines: [{ ...ADVICE.lines[0], items: [{ ...sprayItem, activityId: A2, part: 'nutrition', title: 'विद्राव्य खत' }] }],
        };
        await act(async () => { resolveNewer(asResponse(NEWER_ADVICE)); });
        const panel = await card();
        expect(panel).toHaveTextContent('विद्राव्य खत');
        await waitFor(async () => expect((await readCachedScheduleAdvice(FARM, PLOT_GRAPE, ME))?.words).toBe('खत'));

        await act(async () => { resolveOlder(asResponse(ADVICE)); }); // the OLDER one finishes last
        await new Promise(r => setTimeout(r, 250));
        expect(screen.getByTestId('schedule-advice-card')).toHaveTextContent('विद्राव्य खत');
        expect(screen.getByTestId('schedule-advice-card').textContent).not.toContain('बुरशीनाशक');
        const kept = await readCachedScheduleAdvice(FARM, PLOT_GRAPE, ME);
        expect(kept?.words).toBe('खत');
        expect(kept?.advice.serverTimeUtc).toBe('2026-11-08T07:00:00Z');
    });

    it('the pause is 600 ms: no request before it, one request after it', () => {
        expect(ADVICE_DEBOUNCE_MS).toBe(600);
        const get = serves(ADVICE);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            renderHook(() => useScheduleAdvice({ farmId: FARM, plotId: PLOT_GRAPE, userId: ME, words: 'फवारणी', plannedDate: '2026-11-09' }));
            act(() => { vi.advanceTimersByTime(599); });
            expect(get).not.toHaveBeenCalled();
            act(() => { vi.advanceTimersByTime(1); });
            expect(get).toHaveBeenCalledTimes(1);
            act(() => { vi.advanceTimersByTime(5000); });
            expect(get).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('the pure view', () => {
    it('draws nothing for "none"', () => {
        const { container } = render(<ScheduleAdviceView result={{ kind: 'none' }} language="mr" work="फवारणी" />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('nothing from the card is copied into the saved task (D-24d)', () => {
    it('the saved task holds the form\'s own words only: no title, number, schedule, stage or id from the card', async () => {
        serves(ADVICE);
        const { onSaved } = setup();
        chooseAll('फवारणी');
        const panel = await card();
        expect(panel.textContent).toContain('बुरशीनाशक फवारणी');
        fireEvent.click(screen.getByTestId('plan-assign-self'));
        await waitFor(() => expect(screen.getByTestId('plan-submit')).not.toBeDisabled());
        // the quantity and note boxes are still empty: the card put nothing in them
        expect((screen.getByTestId('plan-qty') as HTMLInputElement).value).toBe('');
        expect((screen.getByTestId('plan-note') as HTMLTextAreaElement).value).toBe('');
        expect((screen.getByTestId('plan-work-input') as HTMLInputElement).value).toBe('फवारणी');

        fireEvent.click(screen.getByTestId('plan-submit'));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        const rows = (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.PlannedworkCreate);
        expect(rows).toHaveLength(1);
        const payload = JSON.stringify(rows[0].payload);
        for (const fromTheCard of ['बुरशीनाशक', 'विद्यापीठ', 'तज्ज्ञ', 'Canopy', S1, S2, A1, 'op_spray_gen', 'EveryNDays', 'timesInStage', 'सल्ला']) {
            expect(payload, `the saved task must not hold "${fromTheCard}"`).not.toContain(fromTheCard);
        }
        const created = rows[0].payload as Record<string, unknown>;
        expect(created.title).toBe('फवारणी');
        expect(created.quantityText).toBeUndefined();
        expect(created.note).toBeUndefined();
        expect(created.plotIds).toEqual([PLOT_GRAPE]);
    });
});
