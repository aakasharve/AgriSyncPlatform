// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Tasks 2, 3, 4; open point 9 (a)(d); D-76, D-83 = 1, D-91 = 1, P4, P5, P10)
 *
 * The REAL SchedulerPage over a real (fake-indexeddb) phone database, the real pull key, the real adopt path:
 *   - after the trial, on a plot the server says NeedsSchedule, the page opens with "आधी शेड्यूल निवडा" in front, offering the CHECKED
 *     schedule of the crop (the Institution one first) - or the sample, marked, on a crop with no checked one - and "स्वतःचं शेड्यूल
 *     बनवा" disabled with "नियोजनात बनवता येईल" (the maker is SCH-OWN);
 *   - the choice goes through the existing adopt (`adopt_schedule`, this plot only), never a new write, and the ask is gone at once;
 *   - nothing asks where the server says nothing (an older server), where the plot is in its trial, follows a schedule, or has
 *     nothing it could follow - and then the page says the honest line instead (no default from an unchecked row);
 *   - Marathi mode shows Marathi only, English mode English only; every target is at least 44px.
 */
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
import { writePlanningStates } from '../../../../infrastructure/storage/planningStateStore';
import type { PlotPlanningStateDto } from '../../../../infrastructure/api/planningStateDtos';
import type { ScheduleSubscriptionRow } from '../../../../infrastructure/storage/scheduleSubscriptionRow';
import type { CropProfile } from '../../../../types';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { REF, SERVER_TEMPLATE, crop, plot } from './scheduleFixtures';

const FARM = '11111111-1111-4111-8111-111111111111';
const PLOT_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLOT_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const CYCLE_1 = 'cccccccc-0000-4000-8000-000000000001';
const CYCLE_2 = 'cccccccc-0000-4000-8000-000000000002';
const T = {
    sample: '10000000-0000-4000-8000-000000000001',
    university: '10000000-0000-4000-8000-000000000002',
    expert: '10000000-0000-4000-8000-000000000003',
    team: '10000000-0000-4000-8000-000000000006',
} as const;

const checkedBy = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ ...SERVER_TEMPLATE, id, name, versionHash: 'h', ...extra });
// Marathi names, so a "Marathi mode shows no Latin letter" scan reads the app's words, not a schedule's data.
const UNIVERSITY = row(T.university, 'द्राक्ष विद्यापीठ शेड्यूल', { ownerType: 'INSTITUTION', sourceLabel: 'कृषी विद्यापीठ', check: checkedBy, hasStoredDays: true });
const EXPERT = row(T.expert, 'द्राक्ष तज्ज्ञ शेड्यूल', { ownerType: 'EXPERT', sourceLabel: 'तज्ज्ञ', check: checkedBy, hasStoredDays: true });
const SAMPLE = row(T.sample, 'द्राक्ष नमुना शेड्यूल', { check: null, ownerType: null });
const TEAM = row(T.team, 'द्राक्ष आमचं शेड्यूल', { scope: 'Team', ownerType: 'USER', check: null, hasStoredDays: true });
const CATALOGS = { checked: [SAMPLE, EXPERT, UNIVERSITY], sampleOnly: [SAMPLE], nothing: [TEAM] };

const stateOf = (plotId: string, over: Partial<PlotPlanningStateDto> = {}): PlotPlanningStateDto => ({
    plotId, cropCycleId: plotId === PLOT_1 ? CYCLE_1 : CYCLE_2, inTrial: false, followsAllowed: false, canFollowSomething: true, trialStage: null, needsSchedule: true, ...over,
});
const saveStates = (...states: PlotPlanningStateDto[]) => writePlanningStates(getDatabase(), states, '2026-10-26T06:00:00.000Z');

async function seed(rows: ScheduleSubscriptionRow[] = []) {
    const db = getDatabase();
    for (const [plotId, cycleId] of [[PLOT_1, CYCLE_1], [PLOT_2, CYCLE_2]] as const) {
        await db.plots.put({ id: plotId, farmId: FARM, payload: { id: plotId, farmId: FARM, name: plotId }, updatedAt: '2026-10-01T00:00:00Z' });
        await db.cropCycles.put({ id: cycleId, farmId: FARM, plotId, updatedAt: '2026-10-01T00:00:00Z', payload: { id: cycleId, farmId: FARM, plotId, cropName: 'Grapes', stage: 'x', startDate: REF } });
    }
    if (rows.length > 0) await db.scheduleSubscriptions.bulkPut(rows);
}

// The plots' stored schedule is only the app's stand-in and the crop adopted nothing: every reader falls to the crop's default.
const standIn = { ...plot().schedule, templateId: 'tpl_fallback_grape' };
const twoPlots = (): CropProfile[] => [crop([
    plot({ id: PLOT_1, name: 'A', schedule: { ...standIn, id: 'sch-1', plotId: PLOT_1 } }),
    plot({ id: PLOT_2, name: 'B', schedule: { ...standIn, id: 'sch-2', plotId: PLOT_2 } }),
], { activeScheduleId: null })];

function mount(initial: CropProfile[] = twoPlots()) {
    const Harness = () => {
        const [crops, setCrops] = useState(initial);
        return <SchedulerPage crops={crops} logs={[]} tasks={[]} onUpdateCrops={setCrops} onBack={() => undefined} onCloseDay={() => undefined} />;
    };
    render(<Harness />);
}

const queuedOf = async (type: string) => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === type).map(r => r.payload as Record<string, unknown>);
const minHeight = (el: HTMLElement): number => {
    const m = /min-h-\[(\d+)px\]/.exec(el.className);
    return m ? Number(m[1]) : 0;
};

beforeAll(() => setScheduleTemplatesFromReferenceData(CATALOGS.checked));
beforeEach(async () => {
    language.current = 'mr';
    setScheduleTemplatesFromReferenceData(CATALOGS.checked);
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear()]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the ask on the शेड्यूल page (D-83 = 1)', () => {
    it('Ask_shows_after_the_trial: "आधी शेड्यूल निवडा" in front, the checked Institution schedule offered, his own place disabled with its words', async () => {
        await seed();
        await saveStates(stateOf(PLOT_1));
        mount();
        const ask = await screen.findByTestId('schedule-ask');
        expect(ask).toHaveAttribute('data-where', 'page');
        expect(ask).toHaveAttribute('data-kind', 'checked');
        expect(screen.getByTestId('schedule-ask-title')).toHaveTextContent('आधी शेड्यूल निवडा');
        expect(screen.getByTestId('schedule-ask-why')).toHaveTextContent('हा प्लॉट अजून कोणतंही शेड्यूल पाळत नाही. आधी एक निवडा.');
        const choose = screen.getByTestId('schedule-ask-choose');
        expect(choose).toHaveTextContent('श्रमसफलचं तपासलेलं शेड्यूल');
        expect(choose).toHaveTextContent('द्राक्ष विद्यापीठ शेड्यूल'); // the Institution one, though the expert one is listed first
        const own = screen.getByTestId('schedule-ask-own');
        expect(own).toBeDisabled();
        expect(own).toHaveTextContent('स्वतःचं शेड्यूल बनवा');
        expect(own).toHaveTextContent('नियोजनात बनवता येईल');
        // in front of the page: it comes before the schedule's own header, and it replaces the "nobody chose" note
        expect(ask.compareDocumentPosition(screen.getByTestId('sched-header')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByTestId('default-schedule-note')).toBeNull();
    });

    it('Choice_goes_through_the_adopt_path: one adopt for THIS plot, the ask is gone at once, the other plot is not touched', async () => {
        await seed();
        await saveStates(stateOf(PLOT_1), stateOf(PLOT_2));
        mount();
        await screen.findByTestId('schedule-ask');
        await act(async () => { fireEvent.click(screen.getByTestId('schedule-ask-choose')); });
        await waitFor(() => expect(screen.queryByTestId('schedule-ask')).toBeNull());
        const adopts = await queuedOf(SyncMutationName.AdoptSchedule);
        expect(adopts).toHaveLength(1);
        expect(adopts[0]).toMatchObject({ plotId: PLOT_1, scheduleTemplateId: T.university });
        expect(await queuedOf(SyncMutationName.MigrateSchedule)).toHaveLength(0);
        // plot B still needs a schedule: its own ask, when he looks at it
        fireEvent.click(screen.getByText('B'));
        expect(await screen.findByTestId('schedule-ask')).toBeInTheDocument();
    });

    it('Sample_only_crop: the sample is offered and marked as a sample, never as checked (D-91 = 1)', async () => {
        setScheduleTemplatesFromReferenceData(CATALOGS.sampleOnly);
        await seed();
        await saveStates(stateOf(PLOT_1));
        mount();
        const ask = await screen.findByTestId('schedule-ask');
        expect(ask).toHaveAttribute('data-kind', 'sample');
        const choose = screen.getByTestId('schedule-ask-choose');
        expect(choose).toHaveTextContent('नमुना शेड्यूल — अजून तपासलेलं नाही');
        expect(choose.textContent).not.toContain('श्रमसफलचं तपासलेलं शेड्यूल');
    });

    it('Nothing_asks_where_the_server_says_nothing: no key (an older server), not needing, in the trial, already following', async () => {
        await seed();
        // 1. no planning state at all
        mount();
        await screen.findByTestId('sched-header');
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
        cleanup();
        // 2. the server says NeedsSchedule false (after the trial but nothing to choose from, or following)
        await saveStates(stateOf(PLOT_1, { needsSchedule: false, canFollowSomething: false }));
        mount();
        await screen.findByTestId('sched-header');
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
        cleanup();
        // 3. in the trial: no compulsion
        await saveStates(stateOf(PLOT_1, { inTrial: true, needsSchedule: false }));
        mount();
        await screen.findByTestId('sched-header');
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
        cleanup();
        // 4. the state is stale for a plot this phone already holds a choice for
        await saveStates(stateOf(PLOT_1));
        await seed([{ id: 'dddddddd-0000-4000-8000-00000000000a', farmId: FARM, plotId: PLOT_1, cropCycleId: CYCLE_1, templateId: T.expert, referenceDate: null, state: 'Active', adoptedAtUtc: '2026-10-20T00:00:00Z', origin: 'Outside', checkState: 'Checked', slot: 1 }]);
        mount();
        await screen.findByTestId('sched-header');
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
    });

    it('A_plot_in_another_season_is_not_asked: the state names a season this phone does not show', async () => {
        await seed();
        await saveStates(stateOf(PLOT_1, { cropCycleId: 'cccccccc-0000-4000-8000-0000000000ff' }));
        mount();
        await screen.findByTestId('sched-header');
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
    });
});

describe('nothing to follow: the honest line, no default, no ask (P4)', () => {
    it('Nothing_followable: the page says there is no checked schedule for the crop; no ask, no invented stages', async () => {
        setScheduleTemplatesFromReferenceData(CATALOGS.nothing);
        await seed();
        await saveStates(stateOf(PLOT_1, { needsSchedule: false, canFollowSomething: false }));
        mount();
        const card = await screen.findByTestId('sched-no-schedule');
        expect(card).toHaveTextContent('या पिकासाठी अजून शेड्यूल नाही'); // the card's existing title stays
        expect(screen.getByTestId('sched-no-followable')).toHaveTextContent('या पिकासाठी अजून श्रमसफलने तपासलेलं शेड्यूल नाही');
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
        expect(screen.queryByTestId('sched-tabs')).toBeNull();
    });

    it('English_twin: the same line in English, English only', async () => {
        language.current = 'en';
        setScheduleTemplatesFromReferenceData(CATALOGS.nothing);
        await seed();
        mount();
        expect(await screen.findByTestId('sched-no-followable')).toHaveTextContent('No ShramSafal-checked schedule for this crop yet');
    });

    it('The_default_is_marked_when_it_is_a_sample: a plot that chose nothing on a crop with only the sample sees the sample, said to be one', async () => {
        setScheduleTemplatesFromReferenceData(CATALOGS.sampleOnly);
        await seed();
        mount();
        await screen.findByTestId('sched-header');
        expect(screen.getByTestId('default-schedule-note')).toBeInTheDocument();
        expect(screen.getByTestId('default-schedule-sample')).toHaveTextContent('हे नमुना शेड्यूल आहे — श्रमसफलने अजून तपासलेलं नाही');
        expect(screen.getByTestId('sched-name')).toHaveTextContent('द्राक्ष नमुना शेड्यूल');
    });

    it('The_default_is_the_checked_one_not_the_first_in_the_catalog: sample listed first, the Institution schedule is what the page shows', async () => {
        await seed();
        mount();
        await screen.findByTestId('sched-header');
        expect(screen.getByTestId('sched-name')).toHaveTextContent('द्राक्ष विद्यापीठ शेड्यूल');
        expect(screen.queryByTestId('default-schedule-sample')).toBeNull();
    });
});

describe('words and targets', () => {
    it('Marathi_mode_no_Latin_letter: every word of the ask is Marathi', async () => {
        await seed();
        await saveStates(stateOf(PLOT_1));
        mount();
        const ask = await screen.findByTestId('schedule-ask');
        expect(ask.textContent ?? '').not.toMatch(/[A-Za-z]/);
        expect(ask.textContent ?? '').not.toMatch(/\p{Extended_Pictographic}/u);
        expect(ask.textContent ?? '').not.toMatch(/\bAI\b/);
    });

    it('English_mode_English_only: the ask in English, no Devanagari letter', async () => {
        language.current = 'en';
        await seed();
        await saveStates(stateOf(PLOT_1));
        mount();
        const ask = await screen.findByTestId('schedule-ask');
        expect(screen.getByTestId('schedule-ask-title')).toHaveTextContent('Choose a schedule first');
        expect(screen.getByTestId('schedule-ask-choose')).toHaveTextContent("ShramSafal's checked schedule");
        expect(screen.getByTestId('schedule-ask-own')).toHaveTextContent('Make your own schedule');
        expect(screen.getByTestId('schedule-ask-own')).toHaveTextContent('Can be made in planning');
        // the schedule's own NAME is data (written in Marathi in this fixture); every word the app added is English
        const words = (ask.textContent ?? '').replace('द्राक्ष विद्यापीठ शेड्यूल', '');
        expect(words).not.toMatch(/[ऀ-ॿ]/);
    });

    it('Targets_are_at_least_44px: the choose button and the (disabled) own button', async () => {
        await seed();
        await saveStates(stateOf(PLOT_1));
        mount();
        await screen.findByTestId('schedule-ask');
        expect(minHeight(screen.getByTestId('schedule-ask-choose'))).toBeGreaterThanOrEqual(44);
        expect(minHeight(screen.getByTestId('schedule-ask-own'))).toBeGreaterThanOrEqual(44);
    });
});
