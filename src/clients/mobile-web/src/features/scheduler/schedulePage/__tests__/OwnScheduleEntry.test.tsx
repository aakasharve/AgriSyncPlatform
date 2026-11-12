// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 1; founder D-132 Q1 = 1 "entry only from planning", Q2 = 1; P5, P10)
 *
 * The grey "स्वतःचं शेड्यूल बनवा" on the शेड्यूल page (and on the ask card) becomes LIVE and ONLY takes him to planning, where the maker opens;
 * nothing else on the page changes. The promise line "नियोजनात बनवता येईल" goes where the button is live (P10). A seat WITHOUT the authority
 * sees no maker and no library controls - nothing greyed; an unknown seat is hidden (fail closed).
 */
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const language = vi.hoisted(() => ({ current: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: language.current }) }));
vi.mock('../usePlotClips', () => ({ usePlotClips: () => new Map() }));
vi.mock('../../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../../finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 0 } }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

import SchedulerPage from '../../../../pages/SchedulerPage';
import { ScheduleAsk } from '../ScheduleAsk';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { ScheduleSubscriptionRow } from '../../../../infrastructure/storage/scheduleSubscriptionRow';
import type { CropProfile } from '../../../../types';
import { REF, SERVER_TEMPLATE, crop, plot } from './scheduleFixtures';

const FARM = '11111111-1111-4111-8111-111111111111';
const PLOT_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const CYCLE_1 = 'cccccccc-0000-4000-8000-000000000001';
const T_UNI = '10000000-0000-4000-8000-000000000002';
const S_UNI = 'dddddddd-0000-4000-8000-00000000000a';
const checkedBy = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const UNIVERSITY = { ...SERVER_TEMPLATE, id: T_UNI, name: 'Grapes - University Schedule', versionHash: 'h', ownerType: 'INSTITUTION', sourceLabel: 'Test University', check: checkedBy, hasStoredDays: true };

async function seed() {
    const db = getDatabase();
    await db.plots.put({ id: PLOT_1, farmId: FARM, payload: { id: PLOT_1, farmId: FARM, name: PLOT_1 }, updatedAt: '2026-10-01T00:00:00Z' });
    await db.cropCycles.put({ id: CYCLE_1, farmId: FARM, plotId: PLOT_1, updatedAt: '2026-10-01T00:00:00Z', payload: { id: CYCLE_1, farmId: FARM, plotId: PLOT_1, cropName: 'Grapes', stage: 'x', startDate: REF } });
    const row: ScheduleSubscriptionRow = { id: S_UNI, farmId: FARM, plotId: PLOT_1, cropCycleId: CYCLE_1, templateId: T_UNI, referenceDate: null, state: 'Active', adoptedAtUtc: '2026-10-05T00:00:00Z', origin: 'Outside', checkState: 'Checked', slot: 1, isMain: true };
    await db.scheduleSubscriptions.put(row);
}

const oneCrop = (): CropProfile[] => [crop([plot({ id: PLOT_1, name: 'A', schedule: { ...plot().schedule, id: 'sch-1', plotId: PLOT_1 } })])];

function mount(props: { mayMakeOwnSchedule?: boolean; onMakeOwnSchedule?: (cropId: string) => void } = {}) {
    const initial = oneCrop();
    const Harness = () => {
        const [crops, setCrops] = useState(initial);
        return <SchedulerPage crops={crops} logs={[]} tasks={[]} onUpdateCrops={setCrops} onBack={() => undefined} onCloseDay={() => undefined} {...props} />;
    };
    render(<Harness />);
}

beforeEach(async () => {
    language.current = 'mr';
    setScheduleTemplatesFromReferenceData([UNIVERSITY]);
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear()]);
    await seed();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the शेड्यूल page: the own place', () => {
    it('Live_button_for_a_seat_that_may_make: enabled, its title, NO promise line, and it only asks to go to planning', async () => {
        const onMake = vi.fn();
        mount({ mayMakeOwnSchedule: true, onMakeOwnSchedule: onMake });
        const button = await screen.findByTestId('three-plus-one-own-make');
        expect(button).toBeEnabled();
        expect(button).toHaveTextContent('स्वतःचं शेड्यूल बनवा');
        expect(screen.getByTestId('three-plus-one').textContent).not.toContain('नियोजनात बनवता येईल'); // P10: no promise where the button is live
        expect(button.className).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/);
        fireEvent.click(button);
        expect(onMake).toHaveBeenCalledTimes(1);
        expect(onMake).toHaveBeenCalledWith(expect.any(String)); // the crop the page is on, so planning opens on it
        expect(await getDatabase().mutationQueue.count()).toBe(0); // it writes nothing: it only goes
    });

    it('A_seat_that_may_not_make_sees_no_maker_and_nothing_greyed: only the plain "empty" sentence', async () => {
        mount({ mayMakeOwnSchedule: false, onMakeOwnSchedule: vi.fn() });
        const section = await screen.findByTestId('three-plus-one');
        expect(screen.queryByTestId('three-plus-one-own-make')).toBeNull();
        expect(section.textContent).not.toContain('स्वतःचं शेड्यूल बनवा');
        expect(section.textContent).not.toContain('नियोजनात बनवता येईल');
        expect(screen.getByTestId('three-plus-one-own-empty')).toHaveTextContent('सुरुवातीला ही जागा रिकामी असते.');
        expect(section.querySelectorAll('[aria-disabled="true"], button:disabled')).toHaveLength(0); // nothing greyed
    });

    it('An_unknown_seat_(the_prop_absent)_is_hidden_too: fail closed', async () => {
        mount();
        await screen.findByTestId('three-plus-one');
        expect(screen.queryByTestId('three-plus-one-own-make')).toBeNull();
        expect(screen.getByTestId('three-plus-one').textContent).not.toContain('स्वतःचं शेड्यूल बनवा');
    });

    it('English_mode_shows_English_only', async () => {
        language.current = 'en';
        mount({ mayMakeOwnSchedule: true, onMakeOwnSchedule: vi.fn() });
        const button = await screen.findByTestId('three-plus-one-own-make');
        expect(button).toHaveTextContent('Make your own schedule');
        expect(button.textContent).not.toMatch(/[ऀ-ॿ]/);
    });

    it('Everything_else_on_the_page_works_as_now: the four places, the add button, the leave button are still there', async () => {
        mount({ mayMakeOwnSchedule: true, onMakeOwnSchedule: vi.fn() });
        await screen.findByTestId(`followed-${S_UNI}`);
        expect(screen.getByTestId('three-plus-one-add')).toBeEnabled();
        expect(screen.getByTestId(`followed-leave-${S_UNI}`)).toBeEnabled();
        expect(screen.getByTestId('three-plus-one-rail')).toBeInTheDocument();
    });
});

describe('P004: no copy shown to a seat that cannot make says it can', () => {
    it('The_3_plus_1_help_sheet_says_nothing_about_making_it_in_planning_for_any_seat', async () => {
        for (const may of [false, true]) {
            mount({ mayMakeOwnSchedule: may, onMakeOwnSchedule: vi.fn() });
            fireEvent.click(await screen.findByTestId('three-plus-one-help-open'));
            const help = await screen.findByTestId('three-plus-one-help');
            expect(help.textContent).not.toContain('नियोजनात तुम्ही ते बनवू शकता');
            expect(help.textContent).not.toMatch(/नियोजनात.*बनवू/);
            expect(screen.getByTestId('three-plus-one-help-line-2')).toHaveTextContent('आणि 1 तुमचं स्वतःचं. सुरुवातीला ही जागा रिकामी असते.');
            cleanup();
        }
    });
    it('English_twin', async () => {
        language.current = 'en';
        mount({ mayMakeOwnSchedule: false, onMakeOwnSchedule: vi.fn() });
        fireEvent.click(await screen.findByTestId('three-plus-one-help-open'));
        const help = await screen.findByTestId('three-plus-one-help');
        expect(help.textContent?.toLowerCase()).not.toContain('make it in planning');
        expect(screen.getByTestId('three-plus-one-help-line-2')).toHaveTextContent('And 1 of your own. This place starts empty.');
    });
});

describe('the ask card: the same button, the same rule', () => {
    const ask = (props: { mayMakeOwn?: boolean; onMakeOwn?: () => void } = {}) => render(<ScheduleAsk cropName="Grapes" plotId={PLOT_1} where="page" language="mr" {...props} />);

    it('Live_for_a_seat_that_may_make_with_no_hint_line', () => {
        const onMake = vi.fn();
        ask({ mayMakeOwn: true, onMakeOwn: onMake });
        const own = screen.getByTestId('schedule-ask-own');
        expect(own).toBeEnabled();
        expect(own).toHaveTextContent('स्वतःचं शेड्यूल बनवा');
        expect(screen.queryByTestId('schedule-ask-own-hint')).toBeNull();
        expect(own.textContent).not.toContain('नियोजनात बनवता येईल');
        fireEvent.click(own);
        expect(onMake).toHaveBeenCalledTimes(1);
    });

    it('Not_drawn_at_all_for_a_seat_without_the_authority_or_an_unknown_one', () => {
        ask({ mayMakeOwn: false, onMakeOwn: vi.fn() });
        expect(screen.queryByTestId('schedule-ask-own')).toBeNull();
        cleanup();
        ask();
        expect(screen.queryByTestId('schedule-ask-own')).toBeNull();
        expect(screen.getByTestId('schedule-ask').textContent).not.toContain('नियोजनात बनवता येईल');
        expect(screen.getByTestId('schedule-ask-choose')).toBeEnabled(); // the checked schedule is still offered
    });
});
