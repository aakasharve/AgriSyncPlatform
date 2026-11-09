// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 4; R10, D-76 "experience one stage, not the entire
 * schedule", D-83 = 1, P4, P10)
 *
 * The trial view, through the REAL SchedulerPage over a fake-indexeddb phone database and the real pull key:
 *   - while the server says the plot is in its trial, TODAY'S stage is the one in full (the stage the SERVER names, `trialStage`),
 *     every other stage shows its name and days only, greyed, with no progress and no tick; the R10 line says it is a ShramSafal
 *     rule; today's stage carries "आजची स्टेज — वर पूर्ण दिसते";
 *   - the पुढे list and tomorrow's line hold only today's stage's work (the other stages are not laid open);
 *   - outside the trial nothing of this changes: the ribbon with every stage's bar, the whole पुढे list;
 *   - nothing here says a record is held back; Marathi mode Marathi only, English mode English only.
 */
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

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
import { agriSyncClient } from '../../../../infrastructure/api/AgriSyncClient';
import type { CropProfile } from '../../../../types';
import { REF, SERVER_TEMPLATE, crop, plot } from './scheduleFixtures';

const FARM = '11111111-1111-4111-8111-111111111111';
const PLOT_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const CYCLE_1 = 'cccccccc-0000-4000-8000-000000000001';
const T_UNI = '10000000-0000-4000-8000-000000000002';
const SUB = 'dddddddd-0000-4000-8000-00000000000a';
const checkedBy = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
// A checked schedule that STORES its days (Post Pruning days 0-14, Canopy Build days 15-39); day 0 = 2026-10-17, so 2026-10-26 is day 9.
const UNIVERSITY = { ...SERVER_TEMPLATE, id: T_UNI, name: 'Grapes - University Schedule', versionHash: 'h', ownerType: 'INSTITUTION', sourceLabel: 'कृषी विद्यापीठ', check: checkedBy, hasStoredDays: true };

const inTrial = (over: Partial<PlotPlanningStateDto> = {}): PlotPlanningStateDto => ({
    plotId: PLOT_1, cropCycleId: CYCLE_1, inTrial: true, followsAllowed: true, canFollowSomething: true,
    trialStage: { name: 'Post Pruning', startDay: 0, endDay: 14 }, needsSchedule: false, ...over,
});
const saveStates = (...states: PlotPlanningStateDto[]) => writePlanningStates(getDatabase(), states, '2026-10-26T06:00:00.000Z');

async function seedFollowing() {
    const db = getDatabase();
    await db.plots.put({ id: PLOT_1, farmId: FARM, payload: { id: PLOT_1, farmId: FARM, name: 'A' }, updatedAt: '2026-10-01T00:00:00Z' });
    await db.cropCycles.put({ id: CYCLE_1, farmId: FARM, plotId: PLOT_1, updatedAt: '2026-10-01T00:00:00Z', payload: { id: CYCLE_1, farmId: FARM, plotId: PLOT_1, cropName: 'Grapes', stage: 'x', startDate: REF } });
    await db.scheduleSubscriptions.put({ id: SUB, farmId: FARM, plotId: PLOT_1, cropCycleId: CYCLE_1, templateId: T_UNI, referenceDate: REF, state: 'Active', adoptedAtUtc: '2026-10-17T00:00:00Z', origin: 'Outside', checkState: 'Checked', slot: 1, isMain: true });
}

const oneCrop = (): CropProfile[] => [crop([plot({ id: PLOT_1, name: 'A', schedule: { ...plot().schedule, id: 'sch-1', plotId: PLOT_1, templateId: T_UNI } })], { activeScheduleId: T_UNI })];
function mount() {
    const Harness = () => {
        const [crops, setCrops] = useState(oneCrop());
        return <SchedulerPage crops={crops} logs={[]} tasks={[]} onUpdateCrops={setCrops} onBack={() => undefined} onCloseDay={() => undefined} />;
    };
    render(<Harness />);
}
const dayKeyOf = (scheduleDay: number): string => {
    const d = new Date(`${REF}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + scheduleDay);
    return d.toISOString().slice(0, 10);
};

beforeAll(() => setScheduleTemplatesFromReferenceData([UNIVERSITY]));
beforeEach(async () => {
    language.current = 'mr';
    setScheduleTemplatesFromReferenceData([UNIVERSITY]);
    vi.spyOn(agriSyncClient.http, 'get').mockRejectedValue(new Error('no net in this test'));
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear()]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the trial view (R10)', () => {
    it('Today_in_full_others_greyed: the stage the server names is the one in full; the other stage shows its name and days only', async () => {
        await seedFollowing();
        await saveStates(inTrial());
        mount();
        const view = await screen.findByTestId('trial-stages');
        expect(screen.getByTestId('trial-heading')).toHaveTextContent('चाचणी');
        expect(screen.getByTestId('trial-rule')).toHaveTextContent('श्रमसफलच्या नियमानुसार चाचणीच्या काळात आजची स्टेज पूर्ण दिसते');
        const today = within(view).getByTestId('trial-stage-1');
        expect(today).toHaveAttribute('data-today', 'yes');
        expect(today).toHaveTextContent('छाटणीनंतर');
        expect(today).toHaveTextContent('दिवस 0–14');
        expect(today).toHaveTextContent('आजची स्टेज — वर पूर्ण दिसते');
        const other = within(view).getByTestId('trial-stage-2');
        expect(other).toHaveAttribute('data-today', 'no');
        expect(other).toHaveAttribute('data-greyed', 'yes');
        expect(other).toHaveTextContent('फूट वाढ');
        expect(other).toHaveTextContent('दिवस 15–39');
        expect(other.textContent).not.toContain('आजची स्टेज'); // only today's stage carries the marker
        expect(other.textContent).not.toContain('✓'); // a greyed stage shows no tick, no bar
        expect(other.querySelector('[data-testid^="ribbon-"]')).toBeNull();
        expect(screen.queryByTestId('stage-ribbon')).toBeNull(); // the ribbon with every stage's bar is not drawn in the trial
    });

    it('The_server_names_the_stage: when its stage differs from the phone\'s own day count, the server\'s stage is the one in full', async () => {
        await seedFollowing();
        await saveStates(inTrial({ trialStage: { name: 'Canopy Build', startDay: 15, endDay: 39 } }));
        mount();
        const view = await screen.findByTestId('trial-stages');
        expect(within(view).getByTestId('trial-stage-2')).toHaveAttribute('data-today', 'yes');
        expect(within(view).getByTestId('trial-stage-1')).toHaveAttribute('data-today', 'no');
    });

    it('Ahead_holds_only_todays_stage: the days of the other stage are not laid open (the list and its count)', async () => {
        await seedFollowing();
        await saveStates(inTrial());
        mount();
        await screen.findByTestId('trial-stages');
        fireEvent.click(screen.getByTestId('tab-ahead'));
        const ahead = await screen.findByTestId('ahead');
        expect(within(ahead).queryByTestId(`ahead-${dayKeyOf(12)}`)).not.toBeNull(); // day 12 is in Post Pruning
        expect(within(ahead).queryByTestId(`ahead-${dayKeyOf(15)}`)).toBeNull(); // day 15 is Canopy Build: not shown in the trial
        expect(within(ahead).queryByTestId(`ahead-${dayKeyOf(16)}`)).toBeNull();
    });

    it('Not_in_the_trial_nothing_changes: the ribbon with every stage, the whole ahead list', async () => {
        await seedFollowing();
        await saveStates(inTrial({ inTrial: false }));
        mount();
        await screen.findByTestId('stage-ribbon');
        expect(screen.queryByTestId('trial-stages')).toBeNull();
        fireEvent.click(screen.getByTestId('tab-ahead'));
        const ahead = await screen.findByTestId('ahead');
        expect(within(ahead).queryByTestId(`ahead-${dayKeyOf(15)}`)).not.toBeNull();
    });

    it('No_state_no_trial_view: an older server says nothing, the page is as it was', async () => {
        await seedFollowing();
        mount();
        await screen.findByTestId('stage-ribbon');
        expect(screen.queryByTestId('trial-stages')).toBeNull();
    });

    it('English_mode_English_only', async () => {
        language.current = 'en';
        await seedFollowing();
        await saveStates(inTrial());
        mount();
        const view = await screen.findByTestId('trial-stages');
        expect(screen.getByTestId('trial-rule')).toHaveTextContent("By ShramSafal's rule, during the trial today's stage shows in full");
        expect(screen.getByTestId('trial-heading')).toHaveTextContent('Trial');
        expect(within(view).getByTestId('trial-stage-1')).toHaveTextContent("Today's stage — shown in full above");
        expect(within(view).getByTestId('trial-stage-2')).toHaveTextContent('Day 15–39');
        expect(view.textContent ?? '').not.toMatch(/[ऀ-ॿ]/);
    });

    it('Marathi_mode_no_Latin_letter: every word of the trial view is Marathi (the schedule\'s stage names are said in Marathi)', async () => {
        await seedFollowing();
        await saveStates(inTrial());
        mount();
        const view = await screen.findByTestId('trial-stages');
        expect(view.textContent ?? '').not.toMatch(/[A-Za-z]/);
        expect(view.textContent ?? '').not.toMatch(/\p{Extended_Pictographic}/u);
    });
});
