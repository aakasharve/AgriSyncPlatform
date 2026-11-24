// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-150 picture S3, D-148 layout C, D-149 item 6; notes 5.1, 5.2, 5.4, 5.5)
 *
 * The real SchedulerPage over a real (fake-indexeddb) phone database and the shared test farm (`pictureMapFixtures`): grapes G1, G2 (both follow the
 * university's schedule) and G3 (follows nothing); sugarcane U1 (follows his own schedule).
 *   - the PICTURE MAP at the top: plots left with the crop's photo, name and day; schedules right with the maker's badge, name and "N प्लॉट"; a coloured
 *     line from each plot to its schedule; one schedule followed by two plots reads as two lines into one card;
 *   - plots that follow no schedule are in a dashed "शेड्यूल नाही" group, each with "शेड्यूल निवडा" that opens the library with THAT plot chosen;
 *   - tapping a plot chooses it (the owner bar and the rest show THAT plot's schedule); tapping a schedule lights all its plots;
 *   - the owner bar under the map: white, green top edge, the maker's picture place, real name; nothing the page had is gone.
 */
import { autoOpenFolds } from './foldTestKit';
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../usePlotClips', () => ({ usePlotClips: () => new Map() }));
vi.mock('../../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../../finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 0 } }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

import SchedulerPage from '../../../../pages/SchedulerPage';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { CropProfile } from '../../../../types';
import { P, T, TEMPLATES, farm, seedFarmSubscriptions } from './pictureMapFixtures';

beforeAll(() => setScheduleTemplatesFromReferenceData(TEMPLATES));
beforeEach(async () => {
    setScheduleTemplatesFromReferenceData(TEMPLATES);
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear()]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z')); // stored schedule day 9, printed as day 10
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function mount(initial: CropProfile[] = farm()) {
    const Harness = () => {
        const [crops, setCrops] = useState(initial);
        return <SchedulerPage crops={crops} logs={[]} tasks={[]} onUpdateCrops={setCrops} onBack={() => undefined} onCloseDay={() => undefined} />;
    };
    render(<Harness />);
    autoOpenFolds();
}
const text = (id: string) => screen.getByTestId(id).textContent ?? '';
/** The map once the phone's subscriptions have been read (the page draws first with none). */
const readyMap = async () => { await screen.findByTestId(`map-schedule-${T.university}`); };

describe('the picture map: who follows what, at a glance', () => {
    it('two plots into one schedule and a third into another: two lines into one card, one line into the other', async () => {
        await seedFarmSubscriptions();
        mount();
        await readyMap();

        const university = screen.getByTestId(`map-schedule-${T.university}`);
        const cane = screen.getByTestId(`map-schedule-${T.ownCane}`);
        expect(university).toHaveAttribute('data-plots', '2');
        expect(university.textContent).toContain('२ प्लॉट');
        expect(cane).toHaveAttribute('data-plots', '1');
        expect(cane.textContent).toContain('१ प्लॉट');

        // one line per plot, ending at ITS schedule
        const lines = [...document.querySelectorAll('[data-testid^="map-line-"]')].map(l => l.getAttribute('data-testid'));
        expect(lines).toEqual([`map-line-${P.g1}-${T.university}`, `map-line-${P.g2}-${T.university}`, `map-line-${P.u1}-${T.ownCane}`]);
        // plots on one schedule sit together and wear its colour; each card names its plot and its day
        expect(screen.getByTestId(`map-plot-${P.g1}`)).toHaveAttribute('data-schedule', T.university);
        expect(screen.getByTestId(`map-plot-${P.g2}`)).toHaveAttribute('data-schedule', T.university);
        expect(screen.getByTestId(`map-plot-${P.u1}`)).toHaveAttribute('data-schedule', T.ownCane);
        expect(text(`map-plot-${P.g1}`)).toContain('G1');
        expect(text(`map-plot-${P.g1}`)).toContain('दिवस १०'); // UI-9a item 9: Marathi digits
        expect(screen.getByTestId(`map-plot-${P.g1}`).querySelector('[data-part="bar"]')).toHaveStyle({ background: '#1448E6' });
    });

    it('each schedule has ONE colour, the farmer\'s own is green, and the lines, the card border and the plot\'s bar all wear it', async () => {
        await seedFarmSubscriptions();
        mount();
        await readyMap();
        const blue = '#1448E6';
        const green = '#16A34A';
        expect(screen.getByTestId(`map-schedule-${T.university}`)).toHaveAttribute('data-colour', blue);
        expect(screen.getByTestId(`map-schedule-${T.ownCane}`)).toHaveAttribute('data-colour', green);
        expect(screen.getByTestId(`map-schedule-${T.ownCane}`)).toHaveAttribute('data-own', 'yes');
        for (const id of [P.g1, P.g2]) {
            expect(screen.getByTestId(`map-line-${id}-${T.university}`)).toHaveAttribute('stroke', blue);
            expect(screen.getByTestId(`map-plot-${id}`)).toHaveAttribute('data-colour', blue);
        }
        expect(screen.getByTestId(`map-line-${P.u1}-${T.ownCane}`)).toHaveAttribute('stroke', green);
        expect(screen.getByTestId(`map-schedule-${T.university}`)).toHaveStyle({ borderColor: blue });
        // the lines are on the map's own layer and say nothing to a screen reader (the cards do)
        expect(screen.getByTestId('schedule-map-lines')).toHaveAttribute('aria-hidden', 'true');
    });

    it('each schedule card carries its maker\'s badge (square for the institution, the letter of the real name) and the schedule\'s name in Marathi', async () => {
        await seedFarmSubscriptions();
        mount();
        await readyMap();
        const badge = screen.getByTestId(`map-badge-${T.university}`);
        expect(badge).toHaveAttribute('data-shape', 'square');
        expect(badge.textContent).toBe('T');
        expect(screen.getByTestId(`map-badge-${T.ownCane}`)).toHaveAttribute('data-shape', 'round');
        expect(within(screen.getByTestId(`map-schedule-${T.university}`)).getByText('Grapes - University Schedule')).toBeInTheDocument(); // a body's own name, as written
    });

    it('a plot that follows no schedule is in the dashed "शेड्यूल नाही" group (not on the map, no line) with a "शेड्यूल निवडा" button', async () => {
        await seedFarmSubscriptions();
        mount();
        await readyMap();
        const group = screen.getByTestId('map-unscheduled');
        expect(group.className).toContain('border-dashed');
        expect(text('map-unscheduled-title')).toBe('शेड्यूल नाही');
        expect(within(group).getByTestId(`map-plot-${P.g3}`)).toBeInTheDocument();
        expect(text(`map-choose-${P.g3}`)).toBe('शेड्यूल निवडा');
        expect(document.querySelector(`[data-testid^="map-line-${P.g3}"]`)).toBeNull();
        expect(screen.getByTestId('schedule-map-board').contains(screen.getByTestId(`map-plot-${P.g3}`))).toBe(false);
        // nobody else is in the group
        expect(within(group).queryByTestId(`map-plot-${P.g1}`)).toBeNull();
    });

    it('"शेड्यूल निवडा" opens the library with THAT plot already chosen (and its crop\'s schedules listed)', async () => {
        await seedFarmSubscriptions();
        mount();
        await readyMap();
        fireEvent.click(screen.getByTestId(`map-choose-${P.g3}`));
        expect(screen.getByTestId('schedule-page')).toHaveAttribute('data-view', 'LIBRARY');
        expect(screen.getByTestId(`library-plot-${P.g3}`)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId(`library-plot-${P.g1}`)).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByTestId(`library-pick-${T.university}`));
        expect(text('library-confirm')).toContain('G3');
    });
});

describe('tapping', () => {
    it('tapping a plot chooses it: the heading, the owner bar and the numbers below are THAT plot\'s schedule', async () => {
        await seedFarmSubscriptions();
        mount();
        await readyMap();
        // opens on the first plot (G1): the university's schedule, a real name, a square badge
        expect(text('sched-crop-plot')).toBe('द्राक्ष · G1');
        expect(text('sched-owner-name')).toBe('Test University recommendation');
        expect(screen.getByTestId('map-plot-' + P.g1)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-shape', 'square');

        fireEvent.click(screen.getByTestId(`map-plot-${P.u1}`));
        expect(text('sched-crop-plot')).toContain('· U1');
        expect(text('sched-owner-name')).toBe('अशोक पाटील'); // his own schedule, by its real maker
        expect(text('sched-owner-type')).toBe('शेतकऱ्याने स्वतः बनवलेलं');
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-shape', 'round');
        expect(text('sched-name')).toContain('My Own');
        expect(screen.getByTestId(`map-plot-${P.u1}`)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId(`map-plot-${P.g1}`)).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('day-now')).toBeInTheDocument();
    });

    it('tapping a plot that follows nothing shows the page exactly as before (the app\'s default and the way to choose)', async () => {
        await seedFarmSubscriptions();
        mount();
        await readyMap();
        fireEvent.click(screen.getByTestId(`map-plot-${P.g3}`));
        expect(text('sched-crop-plot')).toBe('द्राक्ष · G3');
        expect(text('default-schedule-note')).toContain('तुम्ही अजून शेड्यूल निवडलेलं नाही');
    });

    it('tapping a schedule card lights every plot that follows it and dims the rest; tapping it again clears it', async () => {
        await seedFarmSubscriptions();
        mount();
        await readyMap();
        const lit = (id: string) => screen.getByTestId(`map-plot-${id}`).getAttribute('data-lit');
        expect([P.g1, P.g2, P.u1].map(lit)).toEqual(['no', 'no', 'no']);
        fireEvent.click(screen.getByTestId(`map-schedule-${T.university}`));
        expect([P.g1, P.g2, P.u1].map(lit)).toEqual(['yes', 'yes', 'no']);
        expect(screen.getByTestId(`map-schedule-${T.university}`)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId(`map-plot-${P.u1}`).className).toContain('opacity-45');
        expect(screen.getByTestId(`map-line-${P.u1}-${T.ownCane}`)).toHaveAttribute('opacity', '0.2');
        // lighting a schedule changes nothing below: the chosen plot is still G1
        expect(text('sched-crop-plot')).toBe('द्राक्ष · G1');
        fireEvent.click(screen.getByTestId(`map-schedule-${T.university}`));
        expect([P.g1, P.g2, P.u1].map(lit)).toEqual(['no', 'no', 'no']);
        fireEvent.click(screen.getByTestId(`map-schedule-${T.ownCane}`));
        expect([P.g1, P.g2, P.u1].map(lit)).toEqual(['no', 'no', 'yes']);
    });

    it('every tap target is at least 44 px tall', async () => {
        await seedFarmSubscriptions();
        mount();
        await readyMap();
        for (const id of [P.g1, P.g2, P.u1]) expect(parseInt(screen.getByTestId(`map-plot-${id}`).style.height, 10)).toBeGreaterThanOrEqual(44);
        for (const el of document.querySelectorAll<HTMLElement>('[data-testid^="map-schedule-"]')) expect(parseInt(el.style.height, 10)).toBeGreaterThanOrEqual(44);
        expect(screen.getByTestId(`map-choose-${P.g3}`).className).toContain('min-h-[48px]');
    });
});

describe('the owner bar and what the page had before', () => {
    it('version 7: the plot head, tiles and tabs come first, the plot lists (the map) after them, and the older owner bar, numbers, stage line and today card in a closed row after the lists', async () => {
        await seedFarmSubscriptions();
        mount();
        await readyMap();
        const order = ['plot-head', 'schedule-tiles', 'schedule-panes', 'schedule-map', 'sched-owner-bar', 'day-now', 'stage-line', 'today-card'].map(id => screen.getByTestId(id));
        for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByTestId('sched-owner-bar').className).toContain('bg-white');
        for (const row of ['owed', 'ahead', 'done', 'stages', 'followed', 'tools']) expect(screen.getByTestId(`fold-${row}`)).toBeInTheDocument();
        expect(text('day-now')).toBe('१०');
        expect(screen.getByTestId('sched-check')).toHaveAttribute('data-check-state', 'Checked'); // ShramSafal's check is still said, under the name
    });

    it('a single plot: the map has one plot and one schedule - the same page, no crop and plot chips', async () => {
        const db = getDatabase();
        await db.scheduleSubscriptions.bulkPut([{ id: 'dddddddd-0000-4000-8000-0000000000b1', farmId: 'f', plotId: P.g1, cropCycleId: '', templateId: T.university, referenceDate: null, state: 'Active', adoptedAtUtc: '2026-10-02T00:00:00Z', origin: 'Outside', checkState: 'Checked', slot: 1, isMain: true }]);
        mount([farm()[0]].map(c => ({ ...c, plots: [c.plots[0]] })));
        await readyMap();
        expect(screen.getByTestId(`map-schedule-${T.university}`)).toHaveAttribute('data-plots', '1');
        expect(screen.queryByTestId('crop-pick')).toBeNull();
        expect(screen.queryByTestId('plot-pick')).toBeNull();
        await waitFor(() => expect(screen.getByTestId('sched-owner-bar')).toBeInTheDocument());
    });
});
