// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Tasks 1, 4, 5, 6, 7; founder D-132 Q1 = 1, Q4 = 1 with note, Q6 = 1, Q7 = 1 with note,
 * Q8 = 1, D-137 Q9 = 1, Q10 = 1) - the REAL planning page (`PlanWorkPage`) with the library of the PERSON under it, over a fake-indexeddb phone database
 * holding the pulled rows:
 *   - a seat WITHOUT the authority sees nothing of it (no card, no controls, nothing greyed); the owner and a ScheduleTemplates holder see the maker;
 *   - his own schedules grouped by CROP, each with the plots that follow it (a plot on a different schedule from its neighbour is visible), a "made for"
 *     line, "बनवलं: ‹नाव›" and "मालक: ‹नाव›" only when the owner is not the typist and a name is known (never an id);
 *   - one own schedule: per-plot "हे पाळा" through the EXISTING adopt (this plot only; a newer version = a migrate from the own row), the quiet variety
 *     line, the change list (what, date, name), the empty sheet "आधी कामं जोडा";
 *   - saves still on this phone are listed (waiting / refused with words); the words never promise what is not built (no "after a sale" sentence).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const language = vi.hoisted(() => ({ current: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: language.current }) }));
vi.mock('../components/PlanMic', () => ({ PlanMic: () => <button type="button" data-testid="plan-mic">mic</button> }));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import type { CropProfile, FarmerProfile } from '../../../types';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { ScheduleSubscriptionRow } from '../../../infrastructure/storage/scheduleSubscriptionRow';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { requestOwnScheduleMaker, takeOwnScheduleMakerRequest } from '../../scheduler/ownSchedule/makerHandoff';
import { FARM, OWNER, STAGES_A, TYPIST, WORKS_A, id, ownRow } from '../../scheduler/ownSchedule/__tests__/ownFixtures';
import { PlanWorkPage } from '../components/PlanWorkPage';

const ME = OWNER;
const PLOT_G1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLOT_G2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const PLOT_G3 = 'aaaaaaaa-0000-4000-8000-000000000004';
const PLOT_T1 = 'aaaaaaaa-0000-4000-8000-000000000003';
const CYCLE = (n: number) => `cccccccc-0000-4000-8000-00000000000${n}`;
const TODAY = new Date(2026, 10, 12);

const CROPS = [
    { id: 'grape', name: 'Grapes', iconName: 'Grape', color: 'emerald', plots: [
        { id: PLOT_G1, name: 'G1', variety: 'Grapes' }, { id: PLOT_G2, name: 'G2', variety: 'Sharad Seedless' }, { id: PLOT_G3, name: 'G3', variety: '' },
    ] },
    { id: 'tomato', name: 'Tomato', iconName: 'Tomato', color: 'red', plots: [{ id: PLOT_T1, name: 'T1' }] },
] as unknown as CropProfile[];
const profile = (operators: Array<{ id: string; name: string }>) => ({ operators, activeOperatorId: '' }) as unknown as FarmerProfile;
const PROFILE = profile([{ id: OWNER, name: 'संजय' }, { id: TYPIST, name: 'सुनील' }]);

// chain A: two versions; the 2nd was typed by the TYPIST (not the owner). chain B: one version. chain C (tomato): empty.
const A1 = ownRow({ id: id(1), name: 'माझं द्राक्ष शेड्यूल', stages: STAGES_A, activities: WORKS_A, version: 1, variety: 'Thompson Seedless', soilType: 'black', madeAtUtc: '2026-11-04T05:00:00Z' });
const A2 = ownRow({ id: id(2), name: 'माझं द्राक्ष शेड्यूल', stages: STAGES_A, activities: WORKS_A.slice(0, 2), version: 2, previousVersionId: id(1), madeByUserId: TYPIST, madeAtUtc: '2026-11-07T05:00:00Z', variety: 'Thompson Seedless', soilType: 'black' });
const B1 = ownRow({ id: id(5), name: 'दुसरं द्राक्ष शेड्यूल', stages: STAGES_A, activities: WORKS_A.slice(0, 1), version: 1, madeAtUtc: '2026-11-05T05:00:00Z' });
const C1 = ownRow({ id: id(9), name: 'माझं टोमॅटो शेड्यूल', cropType: 'Tomato', version: 1, madeAtUtc: '2026-11-06T05:00:00Z' });
const SUB_G1 = 'dddddddd-0000-4000-8000-0000000000a1';
const SUB_G2 = 'dddddddd-0000-4000-8000-0000000000a2';

const sub = (subId: string, plotId: string, cycle: number, templateId: string, over: Partial<ScheduleSubscriptionRow> = {}): ScheduleSubscriptionRow => ({
    id: subId, farmId: FARM, plotId, cropCycleId: CYCLE(cycle), templateId, referenceDate: null, state: 'Active', adoptedAtUtc: '2026-11-05T00:00:00Z', origin: 'Own', slot: 0, ...over,
});

async function seed(rows: unknown[] = [A1, A2, B1, C1], subs: ScheduleSubscriptionRow[] = [sub(SUB_G1, PLOT_G1, 1, id(1)), sub(SUB_G2, PLOT_G2, 2, id(5))]) {
    const db = getDatabase();
    await db.referenceData.put({ key: 'scheduleTemplates', data: rows, versionHash: 'h', updatedAt: '2026-11-12T00:00:00Z' } as never);
    for (const [plotId, n] of [[PLOT_G1, 1], [PLOT_G2, 2], [PLOT_G3, 3], [PLOT_T1, 4]] as const) {
        await db.plots.put({ id: plotId, farmId: FARM, payload: { id: plotId, farmId: FARM, name: plotId }, updatedAt: '2026-10-01T00:00:00Z' });
        await db.cropCycles.put({ id: CYCLE(n), farmId: FARM, plotId, updatedAt: '2026-10-01T00:00:00Z', payload: { id: CYCLE(n), farmId: FARM, plotId, cropName: plotId === PLOT_T1 ? 'Tomato' : 'Grapes', stage: 'x', startDate: '2026-10-17' } });
    }
    await db.scheduleSubscriptions.bulkPut(subs);
}
const queued = async (type?: string) => (await getDatabase().mutationQueue.toArray()).filter(r => !type || r.mutationType === type);

interface Setup { mayMake?: boolean; mayPlan?: boolean; farmerProfile?: FarmerProfile; onBack?: () => void }
const setup = ({ mayMake = true, mayPlan = true, farmerProfile = PROFILE, onBack = () => undefined }: Setup = {}) => render(
    <PlanWorkPage farmId={FARM} userId={ME} language={language.current} crops={CROPS} farmerProfile={farmerProfile} mayPlan={mayPlan} mayAssign={false}
        mayMakeOwnSchedule={mayMake} onBack={onBack} onOpenConflicts={() => undefined} today={TODAY} />,
);
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });

beforeEach(async () => {
    language.current = 'mr';
    takeOwnScheduleMakerRequest();
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.referenceData.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear(), db.plannedWork.clear()]);
});
afterEach(cleanup);

describe('Task 1: who is shown the maker, and how planning opens on it', () => {
    it('A_seat_without_the_authority_sees_nothing_of_it: no card, no library, no controls, nothing greyed (even with schedules in the pull)', async () => {
        await seed();
        setup({ mayMake: false });
        await settle();
        expect(screen.queryByTestId('own-card')).toBeNull();
        expect(screen.queryByTestId('own-make')).toBeNull();
        expect(screen.getByTestId('plan-work').textContent).not.toContain('स्वतःचं शेड्यूल');
        expect(screen.getByTestId('plan-work').textContent).not.toContain('माझं द्राक्ष शेड्यूल');
    });

    it('A_seat_with_the_authority_but_no_PlanWork_still_gets_the_own_schedule_card', async () => {
        await seed();
        setup({ mayPlan: false });
        expect(await screen.findByTestId('own-card')).toBeInTheDocument();
        expect(screen.queryByTestId('plan-form')).toBeNull();
    });

    it('The_hand_off_from_the_schedule_page_opens_planning_on_the_maker, on that crop; its back goes back where he came from', async () => {
        await seed();
        requestOwnScheduleMaker('tomato');
        const onBack = vi.fn();
        setup({ onBack });
        const start = await screen.findByTestId('own-start');
        expect(start).toBeInTheDocument();
        expect(screen.getByTestId('own-crop-tomato')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('own-back'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('The_hand_off_is_ignored_for_a_seat_that_may_not_make_(fail closed) and is gone after one use', async () => {
        await seed();
        requestOwnScheduleMaker('grape');
        setup({ mayMake: false });
        await settle();
        expect(screen.queryByTestId('own-start')).toBeNull();
        expect(takeOwnScheduleMakerRequest()).toBeNull();
    });

    it('The_make_button_opens_the_maker_in_place_and_its_back_returns_to_planning', async () => {
        await seed();
        setup();
        fireEvent.click(await screen.findByTestId('own-make'));
        expect(await screen.findByTestId('own-start')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('own-back'));
        expect(await screen.findByTestId('own-card')).toBeInTheDocument();
    });

    it('The_ask_card_in_planning_has_the_live_button_for_a_seat_that_may_make (and it opens the maker there)', async () => {
        await seed();
        await getDatabase().scheduleSubscriptions.clear();
        const { writePlanningStates } = await import('../../../infrastructure/storage/planningStateStore');
        await writePlanningStates(getDatabase(), [{ plotId: PLOT_G3, cropCycleId: null, inTrial: false, followsAllowed: false, canFollowSomething: true, trialStage: null, needsSchedule: true }], '2026-11-12T06:00:00.000Z');
        const { setScheduleTemplatesFromReferenceData } = await import('../../../infrastructure/reference/TemplateCatalog');
        const checked = { ...A1, ownerUserId: null, scope: 'Public', ownerType: 'INSTITUTION', check: { state: 'Checked', checkerDisplayName: 'x', checkedAtUtc: '2026-11-08T05:00:00Z', note: null }, id: id(70) };
        setScheduleTemplatesFromReferenceData([checked]);
        setup();
        fireEvent.click(await screen.findByTestId('flow-crop-grape'));
        fireEvent.click(await screen.findByTestId(`flow-plot-${PLOT_G3}`));
        const own = await screen.findByTestId('schedule-ask-own');
        expect(own).toBeEnabled();
        expect(screen.queryByTestId('schedule-ask-own-hint')).toBeNull();
        fireEvent.click(own);
        expect(await screen.findByTestId('own-start')).toBeInTheDocument();
    });
});

describe('Task 4: the library of the person, under planning', () => {
    it('The_card_says_what_it_is_the_make_button_is_live_and_big_enough_and_the_library_shows_on_all_his_farms', async () => {
        await seed();
        setup();
        const card = await screen.findByTestId('own-card');
        expect(card).toHaveTextContent('तुमचं स्वतःचं शेड्यूल');
        expect(card).toHaveTextContent('इथे तुम्ही तुमचं स्वतःचं शेड्यूल बनवता किंवा बदलता.');
        const make = screen.getByTestId('own-make');
        expect(make).toBeEnabled();
        expect(make).toHaveTextContent('स्वतःचं शेड्यूल बनवा');
        expect(make.className).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/);
        expect(card).toHaveTextContent('तुमची स्वतःची शेड्यूल');
        expect(card).toHaveTextContent('तुमच्या सगळ्या शेतांवर दिसतात');
    });

    it('Grouped_by_crop: the grape group and the tomato group, each with its plots and what they follow', async () => {
        await seed();
        setup();
        const grape = await screen.findByTestId('own-group-grape');
        expect(grape).toHaveTextContent('द्राक्ष');
        await waitFor(() => expect(within(grape).getByTestId(`own-plot-line-${PLOT_G1}`)).toHaveTextContent('G1 पाळतो: माझं द्राक्ष शेड्यूल'));
        // the neighbour follows a DIFFERENT schedule: visible
        expect(within(grape).getByTestId(`own-plot-line-${PLOT_G2}`)).toHaveTextContent('G2 पाळतो: दुसरं द्राक्ष शेड्यूल');
        expect(within(grape).getByTestId(`own-plot-line-${PLOT_G3}`)).toHaveTextContent('G3');
        expect(within(grape).getByTestId(`own-plot-line-${PLOT_G3}`)).toHaveTextContent('स्वतःचं शेड्यूल नाही');
        const tomato = screen.getByTestId('own-group-tomato');
        expect(within(tomato).getByTestId(`own-plot-line-${PLOT_T1}`)).toHaveTextContent('स्वतःचं शेड्यूल नाही');
    });

    it('Only_the_newest_version_of_a_schedule_is_a_card: the older version is not listed as a schedule of its own', async () => {
        await seed();
        setup();
        expect(await screen.findByTestId(`own-lib-${id(1)}`)).toBeInTheDocument(); // the chain is named by its first version
        expect(screen.getAllByText('माझं द्राक्ष शेड्यूल', { exact: false }).filter(e => e.closest('[data-testid^="own-lib-"]'))).toHaveLength(1);
        expect(screen.getByTestId(`own-lib-${id(5)}`)).toBeInTheDocument();
    });

    it('The_card_line: version, who made it, the date, how many works, and the owner ONLY when the owner is not the person who typed it', async () => {
        await seed();
        setup();
        const a = await screen.findByTestId(`own-lib-${id(1)}`);
        expect(a).toHaveTextContent('आवृत्ती 2');
        expect(a).toHaveTextContent('बनवलं: सुनील');
        expect(a).toHaveTextContent('7 नोव्हें');
        expect(a).toHaveTextContent('2 कामं');
        expect(a).toHaveTextContent('मालक: संजय');
        const b = screen.getByTestId(`own-lib-${id(5)}`);
        expect(b).toHaveTextContent('बनवलं: संजय');
        expect(b.textContent).not.toContain('मालक');
    });

    it('The_made_for_line_on_each_card: crop, the days worked out from the stages, then only the items that are set', async () => {
        await seed();
        setup();
        const a = await screen.findByTestId(`own-lib-${id(1)}`);
        const made = within(a).getByTestId('own-made-for');
        expect(made).toHaveTextContent('यासाठी बनवलं');
        expect(made).toHaveTextContent('द्राक्ष');
        expect(made).toHaveTextContent('101 दिवस');
        expect(made).toHaveTextContent('वाण: Thompson Seedless');
        expect(made).toHaveTextContent('माती: काळी');
        expect(made.textContent).not.toContain('प्रदेश');
        expect(made.textContent).not.toContain('हवामान');
        const b = screen.getByTestId(`own-lib-${id(5)}`);
        expect(within(b).getByTestId('own-made-for').textContent).not.toContain('वाण');
    });

    it('A_person_the_phone_has_no_name_for_gives_no_name_line_and_never_an_id', async () => {
        await seed();
        setup({ farmerProfile: profile([]) });
        const a = await screen.findByTestId(`own-lib-${id(1)}`);
        expect(a.textContent).not.toContain('बनवलं:');
        expect(a.textContent).not.toContain('मालक');
        expect(a.textContent).not.toContain(TYPIST);
        expect(a.textContent).not.toContain(OWNER);
    });

    it('Who_follows_it_on_this_farm: the plots, or the honest line when none does', async () => {
        await seed();
        setup();
        const a = await screen.findByTestId(`own-lib-${id(1)}`);
        await waitFor(() => expect(within(a).getByTestId('own-followers')).toHaveTextContent('हे पाळतात:'));
        expect(within(a).getByTestId('own-followers')).toHaveTextContent('G1');
        const c = screen.getByTestId(`own-lib-${id(9)}`);
        expect(within(c).getByTestId('own-followers')).toHaveTextContent('या शेतावर अजून कोणताही प्लॉट हे पाळत नाही');
        expect(c).toHaveTextContent('0 कामं');
    });

    it('The_other_owners_or_outside_schedules_are_not_in_the_library: a plain Team copy with no owner and a Public sample', async () => {
        await seed([A1, { ...B1, ownerUserId: null }, { id: id(60), name: 'Grapes - Sample', cropType: 'Grapes', totalDays: 40, stages: [{ name: 'a', startDay: 0, endDay: 5 }], activities: [], versionHash: 'h' }], []);
        setup();
        await screen.findByTestId('own-group-grape');
        expect(screen.queryByTestId(`own-lib-${id(5)}`)).toBeNull();
        expect(screen.queryByTestId(`own-lib-${id(60)}`)).toBeNull();
    });

    it('Who_can_make_it: the link opens a sheet with the two lines; there is NO sentence about a sale or a transfer (no such feature)', async () => {
        await seed();
        setup();
        fireEvent.click(await screen.findByTestId('own-who-link'));
        const sheet = await screen.findByTestId('own-who-sheet');
        expect(sheet).toHaveTextContent('स्वतःचं शेड्यूल: कोण बनवू शकतं?');
        expect(sheet).toHaveTextContent('पीक वेळापत्रकाचे नमुने');
        expect(sheet).toHaveTextContent('श्रमसफलची तपासणी लागत नाही');
        fireEvent.click(screen.getByTestId('own-who-close'));
        await waitFor(() => expect(screen.queryByTestId('own-who-sheet')).toBeNull());
        const all = screen.getByTestId('plan-work').textContent ?? '';
        expect(all).not.toMatch(/विक्री|विकल्|हस्तांतर|नवीन मालक/);
    });

    it('The_untouched_words: no "AI" wording and no emoji anywhere in the card', async () => {
        await seed();
        setup();
        const card = await screen.findByTestId('own-card');
        expect(card.textContent).not.toMatch(/\bAI\b|ड्राफ्ट/);
        expect(card.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    });

    it('English_mode_shows_English_only', async () => {
        language.current = 'en';
        await seed();
        setup();
        const card = await screen.findByTestId('own-card');
        expect(card).toHaveTextContent('Your own schedule');
        expect(screen.getByTestId('own-make')).toHaveTextContent('Make your own schedule');
        const a = screen.getByTestId(`own-lib-${id(1)}`);
        // the schedule's NAME is the farmer's own text (Marathi here); every word the app added is English
        const words = (a.textContent ?? '').replace('माझं द्राक्ष शेड्यूल', '').replace(/संजय|सुनील/g, '');
        expect(words).not.toMatch(/[ऀ-ॿ]/);
        expect(a).toHaveTextContent('Version 2');
    });
});

describe('saves still on this phone', () => {
    it('A_queued_create_is_listed_as_waiting_for_the_net', async () => {
        await seed([], []);
        await getDatabase().mutationQueue.add({
            deviceId: 'd', clientRequestId: 'schedule.create:abc', clientCommandId: 'schedule.create:abc', mutationType: SyncMutationName.ScheduleCreate,
            payload: { scheduleTemplateId: id(80), farmId: FARM, cropKey: 'grape', name: 'नवं शेड्यूल' }, status: 'PENDING', createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z', retryCount: 0,
        });
        setup();
        const pending = await screen.findByTestId('own-pending-schedule.create:abc');
        expect(pending).toHaveTextContent('नवं शेड्यूल');
        expect(pending).toHaveTextContent('फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल');
    });

    const queueRow = (key: string, status: 'PENDING' | 'FAILED' | 'REJECTED_USER_REVIEW', over: Record<string, unknown> = {}) => getDatabase().mutationQueue.add({
        deviceId: 'd', clientRequestId: key, clientCommandId: key, mutationType: SyncMutationName.ScheduleEdit,
        payload: { scheduleTemplateId: id(1), newScheduleTemplateId: id(81), farmId: FARM, newName: 'माझं बदल' }, status, retryCount: 0,
        createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z', ...over,
    } as never);

    it('A_save_the_app_has_STOPPED_retrying_(FAILED_at_the_cap)_says_it_is_stuck_and_how_to_send_it_never_"waiting for the net" (P002)', async () => {
        await seed([], []);
        await queueRow('schedule.edit:stuck', 'FAILED', { retryCount: 5, lastError: 'ShramSafal.ScheduleCropNotOnFarm' });
        setup();
        const card = await screen.findByTestId('own-pending-schedule.edit:stuck');
        expect(card).toHaveTextContent('अडकलं');
        expect(card).toHaveTextContent('पाठवण्याची स्थिती');
        expect(card.textContent).not.toContain('नेट आल्यावर पाठवलं जाईल');
        expect(card).toHaveTextContent('या शेतात हे पीक नाही.'); // the reason, when the phone knows it
    });

    it('A_save_still_below_the_cap_is_waiting_because_the_worker_will_still_send_it (P002)', async () => {
        await seed([], []);
        await queueRow('schedule.edit:slow', 'FAILED', { retryCount: 2, lastError: 'network' });
        setup();
        const card = await screen.findByTestId('own-pending-schedule.edit:slow');
        expect(card).toHaveTextContent('फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल');
        expect(card.textContent).not.toContain('अडकलं');
    });

    it('A_HELD_save_says_the_farms_plan_holds_it_and_that_it_goes_by_itself_later (P002)', async () => {
        await seed([], []);
        await queueRow('schedule.edit:held', 'FAILED', { retryCount: 0, errorCode: 'entitlement.subscriptionexpired' });
        setup();
        const card = await screen.findByTestId('own-pending-schedule.edit:held');
        expect(card).toHaveTextContent('शेताची सेवा');
        expect(card).toHaveTextContent('आपोआप');
        expect(card.textContent).not.toContain('नेट आल्यावर पाठवलं जाईल');
    });

    it('The_stuck_line_is_English_only_in_English_mode (P002)', async () => {
        language.current = 'en';
        await seed([], []);
        await queueRow('schedule.edit:stuck', 'FAILED', { retryCount: 5, lastError: 'ShramSafal.ScheduleCropNotOnFarm' });
        setup();
        const card = await screen.findByTestId('own-pending-schedule.edit:stuck');
        const words = (card.textContent ?? '').replace('माझं बदल', '');
        expect(words).not.toMatch(/[\u0900-\u097F]/);
        expect(card).toHaveTextContent('Stuck');
        expect(card).toHaveTextContent('Sync Status');
    });

    it('A_dependent_edit_whose_create_is_also_listed_is_not_a_second_card (P003: one card, the create\'s words)', async () => {
        await seed([], []);
        await getDatabase().mutationQueue.add({
            deviceId: 'd', clientRequestId: 'schedule.create:c1', clientCommandId: 'schedule.create:c1', mutationType: SyncMutationName.ScheduleCreate,
            payload: { scheduleTemplateId: id(80), farmId: FARM, cropKey: 'grape', name: 'नवं शेड्यूल' }, status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.ScheduleCropNotOnFarm',
            retryCount: 1, createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
        } as never);
        await queueRow('schedule.edit:dep', 'REJECTED_USER_REVIEW', { payload: { scheduleTemplateId: id(80), newScheduleTemplateId: id(81), farmId: FARM }, errorCode: 'ShramSafal.ScheduleCropNotOnFarm' });
        setup();
        await screen.findByTestId('own-pending-schedule.create:c1');
        expect(screen.queryByTestId('own-pending-schedule.edit:dep')).toBeNull();
        expect(screen.getByTestId('own-pending-schedule.create:c1')).toHaveTextContent('या शेतात हे पीक नाही.');
    });

    it('A_refused_save_says_so_with_the_servers_words_and_is_never_silent', async () => {
        await seed([], []);
        await getDatabase().mutationQueue.add({
            deviceId: 'd', clientRequestId: 'schedule.edit:xyz', clientCommandId: 'schedule.edit:xyz', mutationType: SyncMutationName.ScheduleEdit,
            payload: { scheduleTemplateId: id(1), newScheduleTemplateId: id(81), farmId: FARM, newName: 'माझं' }, status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.ScheduleCropNotOnFarm',
            createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z', retryCount: 1,
        });
        setup();
        const refused = await screen.findByTestId('own-pending-schedule.edit:xyz');
        expect(refused).toHaveTextContent('हे जतन झालं नाही');
        expect(refused).toHaveTextContent('या शेतात हे पीक नाही.');
    });
});

describe('Task 5: one own schedule, and the per-plot "हे पाळा" (Q6 = 1, Q8 = 1)', () => {
    const openA = async () => { fireEvent.click(await screen.findByTestId(`own-lib-${id(1)}`)); return screen.findByTestId('own-detail'); };

    it('The_detail_shows_the_line_the_made_for_box_and_no_check_anything', async () => {
        await seed();
        setup();
        const detail = await openA();
        expect(detail).toHaveTextContent('माझं द्राक्ष शेड्यूल');
        expect(screen.getByTestId('own-detail-line')).toHaveTextContent('आवृत्ती 2 · बनवलं: सुनील · 7 नोव्हें · 2 कामं · मालक: संजय');
        expect(detail).toHaveTextContent('स्वतःच्या शेड्यूलला तपासणी लागत नाही');
        expect(detail.textContent).not.toMatch(/तपासलेलं नाही|तपासणी बाकी/);
        expect(detail.querySelector('[data-check-state]')).toBeNull();
    });

    it('Each_plot_of_the_crop_has_its_own_line: older version, another own schedule, and none', async () => {
        await seed();
        setup();
        await openA();
        await waitFor(() => expect(screen.getByTestId(`own-plot-${PLOT_G1}`)).toHaveTextContent('आवृत्ती 1 पाळतो · नवीन आवृत्ती 2 आहे'));
        expect(screen.getByTestId(`own-plot-${PLOT_G2}`)).toHaveTextContent('हा प्लॉट दुसरं द्राक्ष शेड्यूल पाळतो');
        expect(screen.getByTestId(`own-plot-${PLOT_G3}`)).toHaveTextContent('हा प्लॉट हे शेड्यूल अजून पाळत नाही');
        expect(screen.queryByTestId(`own-plot-${PLOT_T1}`)).toBeNull(); // a plot of another crop is not listed
        for (const p of [PLOT_G1, PLOT_G2, PLOT_G3]) expect(screen.getByTestId(`own-follow-${p}`)).toHaveTextContent('हे पाळा');
    });

    it('Saving_never_makes_a_plot_follow: opening the detail queues nothing', async () => {
        await seed();
        setup();
        await openA();
        await settle();
        expect(await queued()).toEqual([]);
    });

    it('A_plot_with_none_takes_it_through_the_existing_adopt_this_plot_only (an addition in his own place)', async () => {
        await seed();
        setup();
        await openA();
        await act(async () => { fireEvent.click(screen.getByTestId(`own-follow-${PLOT_G3}`)); });
        await waitFor(async () => expect(await queued(SyncMutationName.AdoptSchedule)).toHaveLength(1));
        expect((await queued(SyncMutationName.AdoptSchedule))[0].payload).toMatchObject({ plotId: PLOT_G3, scheduleTemplateId: id(2) }); // the NEWEST version
        expect(await queued(SyncMutationName.MigrateSchedule)).toHaveLength(0);
        expect(await queued()).toHaveLength(1); // no other plot touched, no new kind of write
        const kept = (await getDatabase().scheduleSubscriptions.where('plotId').equals(PLOT_G3).toArray())[0];
        expect(kept).toMatchObject({ origin: 'Own', slot: 0, templateId: id(2), pending: true });
    });

    it('Taking_the_newer_version_is_a_second_tap_on_that_plot: a migrate from the own row, this plot only', async () => {
        await seed();
        setup();
        await openA();
        await waitFor(() => expect(screen.getByTestId(`own-plot-${PLOT_G1}`)).toHaveTextContent('आवृत्ती 1 पाळतो'));
        await act(async () => { fireEvent.click(screen.getByTestId(`own-follow-${PLOT_G1}`)); });
        await waitFor(async () => expect(await queued(SyncMutationName.MigrateSchedule)).toHaveLength(1));
        expect((await queued(SyncMutationName.MigrateSchedule))[0].payload).toMatchObject({ plotId: PLOT_G1, newScheduleTemplateId: id(2), fromSubscriptionId: SUB_G1 });
        expect(await queued()).toHaveLength(1);
    });

    it('A_plot_on_another_own_schedule_switches_with_a_migrate_from_that_row', async () => {
        await seed();
        setup();
        await openA();
        await waitFor(() => expect(screen.getByTestId(`own-plot-${PLOT_G2}`)).toHaveTextContent('दुसरं द्राक्ष शेड्यूल पाळतो'));
        await act(async () => { fireEvent.click(screen.getByTestId(`own-follow-${PLOT_G2}`)); });
        await waitFor(async () => expect(await queued(SyncMutationName.MigrateSchedule)).toHaveLength(1));
        expect((await queued(SyncMutationName.MigrateSchedule))[0].payload).toMatchObject({ plotId: PLOT_G2, newScheduleTemplateId: id(2), fromSubscriptionId: SUB_G2 });
    });

    it('A_plot_already_on_the_newest_version_says_so_and_offers_to_let_it_go', async () => {
        await seed([A1, A2, B1, C1], [sub(SUB_G1, PLOT_G1, 1, id(2))]);
        setup();
        await openA();
        const line = screen.getByTestId(`own-plot-${PLOT_G1}`);
        await waitFor(() => expect(line).toHaveTextContent('हा प्लॉट हे शेड्यूल पाळतो'));
        expect(screen.queryByTestId(`own-follow-${PLOT_G1}`)).toBeNull();
        await act(async () => { fireEvent.click(screen.getByTestId(`own-leave-${PLOT_G1}`)); });
        await waitFor(async () => expect(await queued(SyncMutationName.AbandonSchedule)).toHaveLength(1));
        expect((await queued(SyncMutationName.AbandonSchedule))[0].payload).toMatchObject({ subscriptionId: SUB_G1 });
    });

    it('An_empty_schedule_cannot_be_followed_yet: the tap opens the sheet "आधी कामं जोडा" and queues nothing', async () => {
        await seed();
        setup();
        fireEvent.click(await screen.findByTestId(`own-lib-${id(9)}`));
        await screen.findByTestId('own-detail');
        expect(screen.getByTestId('own-detail-empty')).toHaveTextContent('आधी कामं जोडा');
        fireEvent.click(screen.getByTestId(`own-follow-${PLOT_T1}`));
        const sheet = await screen.findByTestId('own-empty-sheet');
        expect(sheet).toHaveTextContent('आधी कामं जोडा');
        expect(sheet).toHaveTextContent('या शेड्यूलमध्ये अजून कामं नाहीत');
        await settle();
        expect(await queued()).toEqual([]);
    });
});

describe('P006: a schedule of ANOTHER owner is not offered for this farm\'s plots', () => {
    const OTHER_OWNER = '0c0c0c0c-0000-4000-8000-00000000000c';
    const farmOwnedBy = (owner: string) => getDatabase().farms.put({ id: FARM, payload: { id: FARM, ownerUserId: owner }, updatedAt: '2026-11-12T00:00:00Z' } as never);
    const foreign = ownRow({ id: id(30), name: 'दुसऱ्याचं शेड्यूल', stages: STAGES_A, activities: WORKS_A, version: 1, ownerUserId: OTHER_OWNER, madeByUserId: OTHER_OWNER });

    it('When_the_phone_knows_the_farms_owner_and_it_is_not_the_schedules_owner_there_is_no_"हे पाळा" and the plain line says so', async () => {
        await seed([A1, A2, foreign], []);
        await farmOwnedBy(OWNER);
        setup();
        fireEvent.click(await screen.findByTestId(`own-lib-${id(30)}`));
        await screen.findByTestId('own-detail');
        await waitFor(() => expect(screen.getByTestId('own-detail-other-owner')).toHaveTextContent('या शेतावरचे प्लॉट हे पाळू शकत नाहीत.'));
        for (const p of [PLOT_G1, PLOT_G2, PLOT_G3]) expect(screen.queryByTestId(`own-follow-${p}`)).toBeNull();
        expect(await queued()).toEqual([]);
    });

    it('The_same_owner_is_offered_as_before_and_so_is_a_farm_whose_owner_the_phone_does_not_know', async () => {
        await seed([A1, A2, B1, C1], []);
        await farmOwnedBy(OWNER);
        setup();
        fireEvent.click(await screen.findByTestId(`own-lib-${id(1)}`));
        await screen.findByTestId('own-detail');
        await waitFor(() => expect(screen.getByTestId(`own-follow-${PLOT_G3}`)).toBeEnabled());
        expect(screen.queryByTestId('own-detail-other-owner')).toBeNull();
        cleanup();
        await getDatabase().farms.clear(); // unknown owner: the offer stays (the server decides)
        setup();
        fireEvent.click(await screen.findByTestId(`own-lib-${id(1)}`));
        await screen.findByTestId('own-detail');
        await waitFor(() => expect(screen.getByTestId(`own-follow-${PLOT_G3}`)).toBeEnabled());
    });

    it('In_the_library_ANOTHER_owners_own_row_is_marked_as_not_followable_here_and_shows_no_followers_line', async () => {
        await seed([A1, A2, foreign], []);
        await farmOwnedBy(OWNER);
        setup(); // names: the other owner is not in the people list
        const card = await screen.findByTestId(`own-lib-${id(30)}`);
        await waitFor(() => expect(within(card).getByTestId('own-other-owner-line')).toHaveTextContent('या शेतावरचे प्लॉट हे पाळू शकत नाहीत.'));
        expect(within(card).queryByTestId('own-followers')).toBeNull();
        // his own farm's schedule is unaffected
        expect(within(screen.getByTestId(`own-lib-${id(1)}`)).queryByTestId('own-other-owner-line')).toBeNull();
    });
});

describe('Task 7: the quiet variety line', () => {
    it('Under_the_plot_whose_own_variety_differs_grey_and_the_follow_still_works; none for a plot with the crops_name_or_nothing', async () => {
        await seed();
        setup();
        fireEvent.click(await screen.findByTestId(`own-lib-${id(1)}`));
        await screen.findByTestId('own-detail');
        const soft = await screen.findByTestId(`own-soft-variety-${PLOT_G2}`);
        expect(soft).toHaveTextContent('हे शेड्यूल Thompson Seedless वाणासाठी बनवलं आहे. या प्लॉटचं वाण: Sharad Seedless.');
        expect(soft.className).toMatch(/text-stone-/); // quiet grey, no alarm colour
        expect(soft.className).not.toMatch(/red|rose|amber/);
        expect(screen.queryByTestId(`own-soft-variety-${PLOT_G1}`)).toBeNull(); // the plot carries the crop's own name
        expect(screen.queryByTestId(`own-soft-variety-${PLOT_G3}`)).toBeNull(); // the plot carries nothing
        expect(screen.getByTestId(`own-follow-${PLOT_G2}`)).toBeEnabled();
    });

    it('No_line_when_the_schedule_names_no_variety_and_never_for_soil_region_or_climate', async () => {
        await seed();
        setup();
        fireEvent.click(await screen.findByTestId(`own-lib-${id(5)}`)); // chain B: no tags
        const detail = await screen.findByTestId('own-detail');
        expect(screen.queryByTestId(`own-soft-variety-${PLOT_G2}`)).toBeNull();
        expect(detail.textContent).not.toMatch(/मातीचा प्रकार|या प्लॉटबद्दल/);
    });
});

describe('Task 6: the change list under each own schedule', () => {
    it('One_line_per_change_with_date_and_name_newest_first_not_old_versions_to_open', async () => {
        await seed();
        setup();
        fireEvent.click(await screen.findByTestId(`own-lib-${id(1)}`));
        await screen.findByTestId('own-detail');
        const list = screen.getByTestId('own-changes-list');
        const items = within(list).getAllByRole('listitem');
        expect(items[0]).toHaveTextContent('घड विरळणी काढली');
        expect(items[0]).toHaveTextContent('7 नोव्हें');
        expect(items[0]).toHaveTextContent('सुनील');
        expect(items[0]).toHaveTextContent('आवृत्ती 2');
        expect(items[items.length - 1]).toHaveTextContent('तपासलेल्या शेड्यूलवरून बनवलं');
        expect(items[items.length - 1]).toHaveTextContent('4 नोव्हें');
        expect(items[items.length - 1]).toHaveTextContent('संजय');
        expect(within(list).queryAllByRole('button')).toHaveLength(0); // lines, not old versions to open
        expect(screen.getByTestId('own-detail')).toHaveTextContent('प्रत्येक वेळी जतन केल्यावर नवीन आवृत्ती बनते. जुनी आवृत्ती जपून ठेवली जाते.');
    });

    it('The_change_button_opens_the_maker_on_the_newest_version', async () => {
        await seed();
        setup();
        fireEvent.click(await screen.findByTestId(`own-lib-${id(1)}`));
        fireEvent.click(await screen.findByTestId('own-edit'));
        expect(await screen.findByTestId('own-stages')).toBeInTheDocument();
        expect(screen.getByTestId('own-stages')).not.toHaveTextContent('घड विरळणी');
    });
});
