// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-150 picture L2; note 5.2, 5.3)
 *
 * The schedule library in THREE NUMBERED STEPS on one screen, on the real SchedulerPage over a real (fake-indexeddb) phone database and the shared test
 * farm (`pictureMapFixtures`): 1 "कोणत्या प्लॉटसाठी?" (the plot chips), 2 "कोणतं शेड्यूल?" (a plain list of radio rows), 3 "पक्कं करा" (one big button that
 * names the plot) and "नवीन शेड्यूल बनवा", which only asks to go to planning (the `requestOwnScheduleMaker` hand-off, as in UI-4).
 * What it kept: the search, the order, ShramSafal's check, "वापरात आहे", "पाहा" (the stages), the held-choice note, and the ONE save path
 * (`saveScheduleChoice`; the queue itself is pinned in `SchedulerPage.saveOnServer.test.tsx`).
 */
import { autoOpenFolds } from './foldTestKit';
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
import { requestOwnScheduleMaker, takeOwnScheduleMakerRequest } from '../../ownSchedule/makerHandoff';
import type { CropProfile } from '../../../../types';
import { P, T, TEMPLATES, farm, seedFarmSubscriptions } from './pictureMapFixtures';

beforeAll(() => setScheduleTemplatesFromReferenceData(TEMPLATES));
beforeEach(async () => {
    language.current = 'mr';
    setScheduleTemplatesFromReferenceData(TEMPLATES);
    takeOwnScheduleMakerRequest();
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear()]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function mount(props: { mayMakeOwnSchedule?: boolean; onMakeOwnSchedule?: (cropId: string) => void } = {}, initial: CropProfile[] = farm()) {
    const Harness = () => {
        const [crops, setCrops] = useState(initial);
        return <SchedulerPage crops={crops} logs={[]} tasks={[]} onUpdateCrops={setCrops} onBack={() => undefined} onCloseDay={() => undefined} {...props} />;
    };
    render(<Harness />);
    autoOpenFolds();
}
const text = (id: string) => screen.getByTestId(id).textContent ?? '';
const openLibraryFor = async (plotId: string) => {
    await screen.findByTestId(`map-schedule-${T.university}`);
    fireEvent.click(screen.getByTestId('open-library'));
    if (plotId !== P.g1) fireEvent.click(screen.getByTestId(`library-plot-${plotId}`));
};
const rowIds = () => [...document.querySelectorAll('[data-testid^="library-name-"]')].map(e => (e.getAttribute('data-testid') as string).replace('library-name-', ''));

describe('three numbered steps on one screen', () => {
    it('1 कोणत्या प्लॉटसाठी?  2 कोणतं शेड्यूल?  3 पक्कं करा - numbered १ २ ३, in that order, under one page title', async () => {
        await seedFarmSubscriptions();
        mount();
        await openLibraryFor(P.g1);
        expect(text('page-title')).toBe('शेड्यूल निवडा');
        const heads = ['library-step-1', 'library-step-2', 'library-step-3'].map(id => screen.getByTestId(id));
        expect(heads.map(h => h.textContent)).toEqual(['१कोणत्या प्लॉटसाठी?', '२कोणतं शेड्यूल?', '३पक्कं करा']);
        for (let i = 1; i < heads.length; i++) expect(heads[i - 1].compareDocumentPosition(heads[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // the old crop chips and the old per-card buttons are gone
        expect(screen.queryByTestId('crop-pick')).toBeNull();
        expect(document.querySelector('[data-testid^="library-adopt-"]')).toBeNull();
    });

    it('step 1: a chip for every plot of the farm, the plot the page was on chosen; choosing another plot changes the list in step 2', async () => {
        await seedFarmSubscriptions();
        mount();
        await openLibraryFor(P.g1);
        for (const id of [P.g1, P.g2, P.g3, P.u1]) expect(screen.getByTestId(`library-plot-${id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`library-plot-${P.g1}`)).toHaveAttribute('aria-pressed', 'true');
        expect(text(`library-plot-${P.g1}`)).toContain('द्राक्ष · G1');
        expect(rowIds().sort()).toEqual([T.expert, T.university].sort()); // grapes' schedules only
        fireEvent.click(screen.getByTestId(`library-plot-${P.u1}`));
        expect(screen.getByTestId(`library-plot-${P.u1}`)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId(`library-plot-${P.g1}`)).toHaveAttribute('aria-pressed', 'false');
        expect(rowIds()).not.toContain(T.university);
        expect(rowIds()).toContain(T.cane);
    });

    it('step 2: a plain list of radio rows - the maker\'s badge, the name, who made it - with ShramSafal\'s check and "वापरात आहे" on the one the plot uses', async () => {
        await seedFarmSubscriptions();
        mount();
        await openLibraryFor(P.g1);
        expect(screen.getByTestId('library-list')).toHaveAttribute('role', 'radiogroup');
        const expert = screen.getByTestId(`library-${T.expert}`);
        expect(within(expert).getByTestId(`library-pick-${T.expert}`)).toHaveAttribute('type', 'radio');
        expect(within(expert).getByTestId(`library-badge-${T.expert}`)).toHaveAttribute('data-shape', 'round');
        expect(within(expert).getByTestId(`library-name-${T.expert}`)).toBeInTheDocument();
        expect(expert.textContent).toContain('कोणी बनवलं: तज्ज्ञ · Test Expert');
        expect(screen.getByTestId(`library-check-${T.expert}`)).toHaveAttribute('data-check-state', 'Checked');
        expect(screen.getByTestId(`library-badge-${T.university}`)).toHaveAttribute('data-shape', 'square');
        // G1 follows the university's: marked, and not choosable again
        expect(screen.getByTestId(`library-${T.university}`)).toHaveTextContent('वापरात आहे');
        expect(screen.getByTestId(`library-pick-${T.university}`)).toBeDisabled();
        expect(screen.getByTestId(`library-pick-${T.expert}`)).not.toBeDisabled();
    });

    it('step 3: ONE big green button that names the plot, pressable only once a schedule is picked; another plot starts with nothing picked', async () => {
        await seedFarmSubscriptions();
        mount();
        await openLibraryFor(P.g1);
        const confirm = screen.getByTestId('library-confirm');
        expect(confirm).toBeDisabled();
        expect(screen.getByTestId('library-confirm-hint')).toHaveTextContent('आधी वरून एक शेड्यूल निवडा');
        fireEvent.click(screen.getByTestId(`library-pick-${T.expert}`));
        expect(confirm).not.toBeDisabled();
        expect(confirm).toHaveTextContent('द्राक्ष · G1 साठी हे शेड्यूल लावा');
        expect(screen.getByTestId(`library-${T.expert}`)).toHaveAttribute('data-picked', 'yes');
        expect(screen.queryByTestId('library-confirm-hint')).toBeNull();
        // the plot changes: the pick was for the old plot, so nothing is picked and the button names the new plot
        fireEvent.click(screen.getByTestId(`library-plot-${P.g3}`));
        expect(screen.getByTestId('library-confirm')).toBeDisabled();
        fireEvent.click(screen.getByTestId(`library-pick-${T.expert}`));
        expect(screen.getByTestId('library-confirm')).toHaveTextContent('द्राक्ष · G3 साठी हे शेड्यूल लावा');
        expect(screen.getAllByTestId('library-confirm')).toHaveLength(1);
    });

    it('choosing saves through the existing path (saveScheduleChoice) for the named plot; the page comes back and the plot has joined the schedule on the map', async () => {
        await seedFarmSubscriptions();
        mount();
        await openLibraryFor(P.g3);
        fireEvent.click(screen.getByTestId(`library-pick-${T.expert}`));
        fireEvent.click(screen.getByTestId('library-confirm'));
        await waitFor(async () => expect((await getDatabase().scheduleSubscriptions.toArray()).filter(r => r.plotId === P.g3)).toHaveLength(1));
        const [row] = (await getDatabase().scheduleSubscriptions.toArray()).filter(r => r.plotId === P.g3);
        expect(row).toMatchObject({ templateId: T.expert, pending: true });
        expect(screen.getByTestId('schedule-page')).toHaveAttribute('data-view', 'HOME');
        // G3 left the dashed group and is now joined to the expert's schedule
        await waitFor(() => expect(screen.getByTestId(`map-line-${P.g3}-${T.expert}`)).toBeInTheDocument());
        expect(screen.queryByTestId('map-unscheduled')).toBeNull();
        expect(screen.getByTestId(`map-schedule-${T.expert}`)).toHaveAttribute('data-plots', '1');
        expect(text('sched-crop-plot')).toBe('द्राक्ष · G3');
    });

    it('what the library did before is kept: the search, the order, the stages sheet ("पाहा") and the "no schedule yet" line', async () => {
        await seedFarmSubscriptions();
        mount();
        await openLibraryFor(P.g1);
        fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'expert' } });
        expect(rowIds()).toEqual([T.expert]);
        fireEvent.change(screen.getByTestId('library-search'), { target: { value: '' } });
        expect(screen.getByTestId('library-order-short')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId(`library-view-${T.expert}`));
        expect(screen.getByTestId('library-stages')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('library-stages-back'));
        expect(screen.queryByTestId('library-stages')).toBeNull();
        // the page's own back button returns to the शेड्यूल tab
        fireEvent.click(screen.getByTestId('page-back'));
        expect(screen.getByTestId('schedule-page')).toHaveAttribute('data-view', 'HOME');
    });
});

describe('"नवीन शेड्यूल बनवा" only asks to go to planning (note 5.3; the hand-off UI-4 made)', () => {
    it('for a seat that may make one: the button is under the big button, says it goes to the planning page, and hands over the chosen plot\'s crop', async () => {
        await seedFarmSubscriptions();
        const onMake = vi.fn((cropId: string) => requestOwnScheduleMaker(cropId)); // what the route does, then it goes to planning
        mount({ mayMakeOwnSchedule: true, onMakeOwnSchedule: onMake });
        await openLibraryFor(P.g1);
        const own = screen.getByTestId('library-make-own');
        expect(own).toHaveTextContent('नवीन शेड्यूल बनवा');
        expect(own).toHaveTextContent('नियोजन पानावर जाईल');
        expect(screen.getByTestId('library-confirm').compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        fireEvent.click(own);
        expect(onMake).toHaveBeenCalledTimes(1);
        expect(onMake).toHaveBeenCalledWith('crop-1');
        expect(takeOwnScheduleMakerRequest()).toEqual({ cropId: 'crop-1' }); // planning takes the request once, on this crop
        expect(await getDatabase().mutationQueue.count()).toBe(0); // it writes nothing
    });

    it('after choosing the sugarcane plot in step 1, it hands over the sugarcane crop', async () => {
        await seedFarmSubscriptions();
        const onMake = vi.fn();
        mount({ mayMakeOwnSchedule: true, onMakeOwnSchedule: onMake });
        await openLibraryFor(P.u1);
        fireEvent.click(screen.getByTestId('library-make-own'));
        expect(onMake).toHaveBeenCalledWith('crop-2');
    });

    it('for a seat that may not (or no door given): no button at all - fail closed, never a dead one', async () => {
        await seedFarmSubscriptions();
        mount({ mayMakeOwnSchedule: false, onMakeOwnSchedule: vi.fn() });
        await openLibraryFor(P.g1);
        expect(screen.queryByTestId('library-make-own')).toBeNull();
        cleanup();
        mount({ mayMakeOwnSchedule: true });
        await openLibraryFor(P.g1);
        expect(screen.queryByTestId('library-make-own')).toBeNull();
    });
});

describe('words: one language at a time', () => {
    it('English mode says English only on the map and the three steps', async () => {
        language.current = 'en';
        await seedFarmSubscriptions();
        mount({ mayMakeOwnSchedule: true, onMakeOwnSchedule: vi.fn() });
        await screen.findByTestId(`map-schedule-${T.university}`);
        expect(text(`map-plot-${P.g1}`)).toContain('Day 9');
        expect(text('map-unscheduled-title')).toBe('No schedule');
        expect(text(`map-choose-${P.g3}`)).toBe('Choose a schedule');
        expect(text('sched-owner')).toContain('Schedule made by');
        fireEvent.click(screen.getByTestId('open-library'));
        expect(['library-step-1', 'library-step-2', 'library-step-3'].map(text)).toEqual(['1For which plot?', '2Which schedule?', '3Confirm']);
        fireEvent.click(screen.getByTestId(`library-pick-${T.expert}`));
        expect(text('library-confirm')).toBe('Use this schedule for Grapes · G1');
        expect(text('library-make-own')).toContain('Make a new schedule');
    });
});
