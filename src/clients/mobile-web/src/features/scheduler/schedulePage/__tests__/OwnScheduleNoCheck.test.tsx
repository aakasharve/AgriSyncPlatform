// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 5; founder D-82 = 3; register F228) - NO CHECK applies to a person's own schedule.
 * The server sends `check: null` on its library entry and `checkState: null` on its subscription. The phone used to read a missing check as
 * "NotChecked" (`resolveSchedule.ts` `?? 'NotChecked'`, and the catalog's "no check = not checked"): fixed for OWN rows only. Never a
 * "not checked" badge, note or word for a schedule of his own; an OUTSIDE row with no check keeps reading "not checked" (D-91 = 1 samples).
 */
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

const language = vi.hoisted(() => ({ current: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: language.current }) }));
vi.mock('../usePlotClips', () => ({ usePlotClips: () => new Map() }));
vi.mock('../../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../../finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 0 } }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

import SchedulerPage from '../../../../pages/SchedulerPage';
import { ScheduleCheckBadge } from '../../components/ScheduleCheckBadge';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { getScheduleById } from '../../planning/ClientPlanEngine';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { ScheduleSubscriptionRow } from '../../../../infrastructure/storage/scheduleSubscriptionRow';
import type { CropProfile } from '../../../../types';
import { resolvePlotSchedule } from '../resolveSchedule';
import { followedCheckNote } from '../followedCheck';
import { choiceForPlot } from '../scheduleSubscriptions';
import { REF, SERVER_TEMPLATE, crop, plot } from './scheduleFixtures';
import { STAGES_A, WORKS_A, ownRow } from '../../ownSchedule/__tests__/ownFixtures';

const FARM = '11111111-1111-4111-8111-111111111111';
const PLOT_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const CYCLE_1 = 'cccccccc-0000-4000-8000-000000000001';
const OWN = '10000000-0000-4000-8000-0000000000a1';
const OUT = '10000000-0000-4000-8000-0000000000b1';
const SUB_OWN = 'dddddddd-0000-4000-8000-0000000000a1';
const SUB_OUT = 'dddddddd-0000-4000-8000-0000000000b1';

const OUTSIDE_NO_CHECK = { ...SERVER_TEMPLATE, id: OUT, name: 'Grapes - Sample', versionHash: 'h', ownerType: null, check: null };
const OWN_ROW = ownRow({ id: OWN, stages: STAGES_A, activities: WORKS_A, name: 'माझं द्राक्ष शेड्यूल' });

const sub = (id: string, templateId: string, over: Partial<ScheduleSubscriptionRow> = {}): ScheduleSubscriptionRow => ({
    id, farmId: FARM, plotId: PLOT_1, cropCycleId: CYCLE_1, templateId, referenceDate: null, state: 'Active', adoptedAtUtc: '2026-10-05T00:00:00Z', ...over,
});

const mount = (initial: CropProfile[]) => {
    const Harness = () => {
        const [crops, setCrops] = useState(initial);
        return <SchedulerPage crops={crops} logs={[]} tasks={[]} onUpdateCrops={setCrops} onBack={() => undefined} onCloseDay={() => undefined} />;
    };
    render(<Harness />);
};
const oneCrop = (): CropProfile[] => [crop([plot({ id: PLOT_1, name: 'A', schedule: { ...plot().schedule, id: 'sch-1', plotId: PLOT_1 } })])];

async function seed(rows: ScheduleSubscriptionRow[]) {
    const db = getDatabase();
    await db.plots.put({ id: PLOT_1, farmId: FARM, payload: { id: PLOT_1, farmId: FARM, name: PLOT_1 }, updatedAt: '2026-10-01T00:00:00Z' });
    await db.cropCycles.put({ id: CYCLE_1, farmId: FARM, plotId: PLOT_1, updatedAt: '2026-10-01T00:00:00Z', payload: { id: CYCLE_1, farmId: FARM, plotId: PLOT_1, cropName: 'Grapes', stage: 'x', startDate: REF } });
    await db.scheduleSubscriptions.bulkPut(rows);
}

beforeEach(async () => {
    language.current = 'mr';
    setScheduleTemplatesFromReferenceData([OUTSIDE_NO_CHECK, OWN_ROW]);
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear()]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the catalog knows whose a schedule is', () => {
    it('An_own_row_carries_its_owner_and_an_outside_row_does_not', () => {
        expect(getScheduleById(OWN)?.ownerUserId).toBe('0a0a0a0a-0000-4000-8000-00000000000a');
        expect(getScheduleById(OUT)?.ownerUserId).toBeUndefined();
    });
});

describe('F228: a missing check on an Own row means "no check applies"', () => {
    it('The_followed_Own_place_has_no_check_state_not_NotChecked', () => {
        const choice = choiceForPlot([sub(SUB_OWN, OWN, { origin: 'Own', slot: 0 })], CYCLE_1)!;
        const resolved = resolvePlotSchedule(crop([plot({ id: PLOT_1, name: 'A' })]), plot({ id: PLOT_1, name: 'A' }), '2026-10-26', choice)!;
        expect(resolved.followed).toHaveLength(1);
        expect(resolved.followed[0].origin).toBe('Own');
        expect(resolved.followed[0].checkState).toBeNull();
    });

    it('An_Outside_place_with_no_check_still_reads_NotChecked (the samples keep their behaviour)', () => {
        const choice = choiceForPlot([sub(SUB_OUT, OUT, { origin: 'Outside', slot: 1 })], CYCLE_1)!;
        const resolved = resolvePlotSchedule(crop([plot({ id: PLOT_1, name: 'A' })]), plot({ id: PLOT_1, name: 'A' }), '2026-10-26', choice)!;
        expect(resolved.followed[0].checkState).toBe('NotChecked');
    });

    it('The_check_note_under_the_header_is_never_drawn_for_an_Own_schedule_but_is_for_an_outside_sample', () => {
        expect(followedCheckNote({ check: undefined }, undefined, true, 'Own')).toBeNull();
        expect(followedCheckNote({ check: undefined }, undefined, false, 'Own')).toBeNull();
        expect(followedCheckNote({ check: undefined }, undefined, true, 'Outside')).toMatchObject({ kind: 'sample', offerNew: true });
        expect(followedCheckNote({ check: undefined }, undefined, true)).toMatchObject({ kind: 'sample' }); // old callers: unchanged
    });

    it('The_check_badge_draws_nothing_for_an_own_template_and_the_grey_not_checked_words_for_an_outside_one', () => {
        const own = getScheduleById(OWN)!;
        const outside = getScheduleById(OUT)!;
        const { container, unmount } = render(<ScheduleCheckBadge template={own} testId="b" />);
        expect(container).toBeEmptyDOMElement();
        unmount();
        render(<ScheduleCheckBadge template={outside} testId="b2" />);
        expect(screen.getByTestId('b2')).toHaveTextContent('श्रमसफलने अजून तपासलेलं नाही');
    });

    it('The_page_of_a_plot_that_follows_only_its_own_schedule_shows_no_not_checked_word_no_badge_and_no_note', async () => {
        await seed([sub(SUB_OWN, OWN, { origin: 'Own', slot: 0, isMain: true })]);
        mount(oneCrop());
        await screen.findByTestId(`followed-${SUB_OWN}`);
        expect(screen.queryByTestId('sched-check')).toBeNull();
        expect(screen.queryByTestId('followed-check-note')).toBeNull();
        expect(screen.queryByTestId(`followed-check-${SUB_OWN}`)).toBeNull();
        expect(screen.getByTestId('schedule-page').textContent).not.toContain('तपासलेलं नाही');
        expect(screen.getByTestId(`followed-own-note-${SUB_OWN}`)).toHaveTextContent('स्वतःच्या शेड्यूलला तपासणी लागत नाही');
    });

    it('The_page_of_a_plot_that_follows_an_outside_sample_still_says_it_is_not_checked', async () => {
        await seed([sub(SUB_OUT, OUT, { origin: 'Outside', slot: 1, isMain: true })]);
        mount(oneCrop());
        await screen.findByTestId(`followed-${SUB_OUT}`);
        expect(screen.getByTestId('sched-check')).toHaveTextContent('श्रमसफलने अजून तपासलेलं नाही');
    });
});
