// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 3; open point 9 (b); D-83 = 1, D-30, P5, P10)
 *
 * The REAL planning page (`PlanWorkPage` with its real `PlanForm`) over a fake-indexeddb phone database and the real pull key:
 *   - the ask "आधी शेड्यूल निवडा" stands in front of the new-planning FORM only, and only for a CHOSEN plot whose state says
 *     NeedsSchedule; a place not yet chosen, the whole farm, a plot the server says nothing about, or one that needs nothing is
 *     never asked about;
 *   - while it stands, the form cannot be saved (the ask says so: it is the "ask first" of D-83); choosing the checked schedule goes
 *     through the existing adopt path, this plot only, and the form is free again at once;
 *   - the list of work already handed out is never asked about (D-83: records and handed-out work always work);
 *   - English mode shows English only.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CropProfile, FarmerProfile } from '../../../types';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { setScheduleTemplatesFromReferenceData } from '../../../infrastructure/reference/TemplateCatalog';
import { writePlanningStates } from '../../../infrastructure/storage/planningStateStore';
import type { PlotPlanningStateDto } from '../../../infrastructure/api/planningStateDtos';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { SERVER_TEMPLATE } from '../../scheduler/schedulePage/__tests__/scheduleFixtures';
import { PlanWorkPage } from '../components/PlanWorkPage';

vi.mock('../components/PlanMic', () => ({ PlanMic: () => <button type="button" data-testid="plan-mic">mic</button> }));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

const FARM = '55555555-5555-4555-8555-555555555551';
const ME = '22222222-2222-4222-8222-222222222222';
const TODAY = new Date(2026, 10, 9);
const GRAPE_PLOT = '44444444-4444-4444-8444-444444444443';
const CANE_PLOTS = ['44444444-4444-4444-8444-444444444441', '44444444-4444-4444-8444-444444444442'];
const CYCLE = 'cccccccc-0000-4000-8000-000000000003';
const T_UNIVERSITY = '10000000-0000-4000-8000-000000000002';

const checkedBy = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const UNIVERSITY = { ...SERVER_TEMPLATE, id: T_UNIVERSITY, name: 'द्राक्ष विद्यापीठ शेड्यूल', cropType: 'Grapes', versionHash: 'h', ownerType: 'INSTITUTION', check: checkedBy, hasStoredDays: true };

const crop = (id: string, name: string, iconName: string, plots: Array<[string, string]>) =>
    ({ id, name, iconName, color: 'emerald', plots: plots.map(([pid, pname]) => ({ id: pid, name: pname })) }) as unknown as CropProfile;
const CROPS = [crop('cane', 'ऊस', 'Sugarcane', [[CANE_PLOTS[0], 'ऊस 1'], [CANE_PLOTS[1], 'ऊस 2']]), crop('grape', 'द्राक्ष', 'Grape', [[GRAPE_PLOT, 'सोनाका']])];
const PROFILE = { operators: [], activeOperatorId: '' } as unknown as FarmerProfile;

const state = (plotId: string, over: Partial<PlotPlanningStateDto> = {}): PlotPlanningStateDto => ({
    plotId, cropCycleId: null, inTrial: false, followsAllowed: false, canFollowSomething: true, trialStage: null, needsSchedule: true, ...over,
});
const saveStates = (...states: PlotPlanningStateDto[]) => writePlanningStates(getDatabase(), states, '2026-11-09T06:00:00.000Z');

const setup = (language: 'mr' | 'en' = 'mr') => render(
    <PlanWorkPage farmId={FARM} userId={ME} language={language} crops={CROPS} farmerProfile={PROFILE} mayPlan mayAssign={false}
        onBack={() => undefined} onOpenConflicts={() => undefined} today={TODAY} />,
);
const fillAllButThePlace = () => {
    fireEvent.change(screen.getByTestId('plan-work-input'), { target: { value: 'छाटणी' } });
    fireEvent.click(screen.getByTestId('plan-when-today'));
    fireEvent.click(screen.getByTestId('plan-assign-self'));
};
/** Lets the live reads (planning state, choices) come back, so a "nothing is asked" check is not true only because nothing was read yet. */
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
const chooseGrape = () => { fireEvent.click(screen.getByTestId('flow-crop-grape')); };
const queued = async (type: string) => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === type).map(r => r.payload as Record<string, unknown>);

beforeEach(async () => {
    setScheduleTemplatesFromReferenceData([UNIVERSITY]);
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.appMeta.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.plannedWork.clear()]);
    await db.plots.put({ id: GRAPE_PLOT, farmId: FARM, payload: { id: GRAPE_PLOT, farmId: FARM, name: 'सोनाका' }, updatedAt: '2026-10-01T00:00:00Z' });
    await db.cropCycles.put({ id: CYCLE, farmId: FARM, plotId: GRAPE_PLOT, updatedAt: '2026-10-01T00:00:00Z', payload: { id: CYCLE, farmId: FARM, plotId: GRAPE_PLOT, cropName: 'Grapes', stage: 'x', startDate: '2026-10-17' } });
});
afterEach(cleanup);

describe('the ask in front of the new-planning form (open point 9 (b))', () => {
    it('Ask_stands_in_front_of_the_form_for_a_chosen_plot_that_needs_a_schedule', async () => {
        await saveStates(state(GRAPE_PLOT));
        setup();
        // no place chosen yet: nothing is asked, the form is the form
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
        chooseGrape();
        const ask = await screen.findByTestId('schedule-ask');
        expect(ask).toHaveAttribute('data-where', 'planning');
        expect(screen.getByTestId('schedule-ask-title')).toHaveTextContent('आधी शेड्यूल निवडा');
        expect(screen.getByTestId('schedule-ask-why')).toHaveTextContent('नवीन काम ठरवण्याआधी या प्लॉटसाठी शेड्यूल निवडा.');
        expect(screen.getByTestId('schedule-ask-plot')).toHaveTextContent('द्राक्ष · सोनाका');
        expect(screen.getByTestId('schedule-ask-choose')).toHaveTextContent('द्राक्ष विद्यापीठ शेड्यूल');
        expect(screen.getByTestId('schedule-ask-own')).toBeDisabled();
        expect(screen.getByTestId('schedule-ask-own')).toHaveTextContent('नियोजनात बनवता येईल');
        // in front of the form, not inside it and not after it
        expect(ask.compareDocumentPosition(screen.getByTestId('plan-form')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('While_it_stands_the_form_cannot_be_saved; choosing opens it: one adopt for this plot only, then the work saves', async () => {
        await saveStates(state(GRAPE_PLOT));
        setup();
        fillAllButThePlace();
        chooseGrape();
        await screen.findByTestId('schedule-ask');
        expect(screen.getByTestId('plan-submit')).toBeDisabled(); // everything else is filled
        await act(async () => { fireEvent.click(screen.getByTestId('schedule-ask-choose')); });
        await waitFor(() => expect(screen.queryByTestId('schedule-ask')).toBeNull());
        const adopts = await queued(SyncMutationName.AdoptSchedule);
        expect(adopts).toHaveLength(1);
        expect(adopts[0]).toMatchObject({ plotId: GRAPE_PLOT, scheduleTemplateId: T_UNIVERSITY });
        await waitFor(() => expect(screen.getByTestId('plan-submit')).toBeEnabled());
        await act(async () => { fireEvent.click(screen.getByTestId('plan-submit')); });
        await waitFor(async () => expect(await queued(SyncMutationName.PlannedworkCreate)).toHaveLength(1));
    });

    it('Other_choices_ask_nothing: the whole farm, a plot the server says nothing about, a plot that needs nothing, a plot in its trial', async () => {
        await saveStates(state(GRAPE_PLOT, { needsSchedule: false, followsAllowed: true }), state(CANE_PLOTS[0]));
        setup();
        // the whole farm: never asked (farm-wide work is never asked)
        fireEvent.click(screen.getByTestId('flow-crop-whole-farm'));
        await settle();
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
        cleanup();
        // the grape plot needs nothing
        setup();
        chooseGrape();
        await settle();
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
        cleanup();
        // a plot in its trial, and a plot the server lists nothing for
        await saveStates(state(GRAPE_PLOT, { inTrial: true, needsSchedule: false }));
        setup();
        chooseGrape();
        await settle();
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
        cleanup();
        await getDatabase().appMeta.clear(); // an older server: no key at all
        setup();
        chooseGrape();
        await settle();
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
        fillAllButThePlace();
        expect(screen.getByTestId('plan-submit')).toBeEnabled();
    });

    it('A_plot_with_no_schedule_to_offer_is_not_asked: the server says needs, the crop has nothing the phone could offer', async () => {
        setScheduleTemplatesFromReferenceData([]);
        await saveStates(state(GRAPE_PLOT));
        setup();
        fillAllButThePlace();
        chooseGrape();
        await settle();
        await waitFor(() => expect(screen.getByTestId('plan-submit')).toBeEnabled());
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
    });

    it('The_list_of_handed_out_work_is_never_asked: with a plot that needs a schedule, the list and its cards carry no ask', async () => {
        await saveStates(state(GRAPE_PLOT));
        setup();
        const list = await screen.findByTestId('plan-list');
        await settle();
        expect(list.querySelector('[data-testid^="schedule-ask"]')).toBeNull();
        expect(screen.queryByTestId('schedule-ask')).toBeNull();
    });

    it('English_mode_English_only: the ask in English, no Devanagari word the app added', async () => {
        await saveStates(state(GRAPE_PLOT));
        setup('en');
        chooseGrape();
        const ask = await screen.findByTestId('schedule-ask');
        expect(screen.getByTestId('schedule-ask-title')).toHaveTextContent('Choose a schedule first');
        expect(screen.getByTestId('schedule-ask-why')).toHaveTextContent('Choose a schedule for this plot before planning new work.');
        const added = (ask.textContent ?? '').replace('द्राक्ष विद्यापीठ शेड्यूल', '').replace(/सोनाका/, '');
        expect(added).not.toMatch(/[ऀ-ॿ]/);
    });
});
