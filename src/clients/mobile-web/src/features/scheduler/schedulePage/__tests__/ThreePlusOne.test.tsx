// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-3; founder D-74 "3 + 1", D-76 / R6, D-82 = 3, D-88 = 2, D-91 = 1; P5, P11)
 *
 * The real SchedulerPage over a real (fake-indexeddb) phone database, the real pull reconciler, the real queue:
 *   - four places drawn (3 outside + his own) with the rail; a filled outside place shows its name, source, check badge, "मुख्य" (only on
 *     the row the SERVER marked) and "हे सोडा";
 *   - "हे शेड्यूल पण पाळा" / "हे सोडा" enqueue adopt / abandon with `subscriptionId`, for THIS plot only (never crop-wide, never a switch);
 *   - a full outside row takes the add button away and says why; the library opened to add disables its button with the words;
 *   - his own place: empty = disabled (no tap target) with its words; filled = no badge, the no-check line, the maker line only with a maker;
 *   - a free place says "only checked ones" - or, on a crop with no checked schedule, "the sample can be chosen" (D-91 = 1);
 *   - the second phone shows the same list after a pull; the sweep keeps a pending adopt for a second place while the server shows the first;
 *   - `resolvePlotSchedule` returns the मुख्य schedule and every followed one in place order;
 *   - English mode shows English only, Marathi mode Marathi only.
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
import ScheduleLibraryView from '../../components/ScheduleLibraryView';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { ScheduleSubscriptionRow } from '../../../../infrastructure/storage/scheduleSubscriptionRow';
import type { CropProfile } from '../../../../types';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import { reconcileScheduleSubscriptions, sweepPendingScheduleChoices } from '../../../sync/pull/reconcilers/scheduleSubscriptionsReconciler';
import { resolvePlotSchedule } from '../resolveSchedule';
import { choiceForPlot, readFollowedByPlot, readPlotChoices } from '../scheduleSubscriptions';
import { THREE_PLUS_ONE_WORDS } from '../threePlusOneCopy';
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
    bloom: '10000000-0000-4000-8000-000000000004',
    own: '10000000-0000-4000-8000-000000000005',
} as const;
const S = { a: 'dddddddd-0000-4000-8000-00000000000a', b: 'dddddddd-0000-4000-8000-00000000000b', c: 'dddddddd-0000-4000-8000-00000000000c', own: 'dddddddd-0000-4000-8000-00000000000d' } as const;

const checkedBy = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ ...SERVER_TEMPLATE, id, name, versionHash: 'h', ...extra });
const TEMPLATES = {
    withChecked: [
        row(T.university, 'Grapes - University Schedule', { ownerType: 'INSTITUTION', sourceLabel: 'Test University recommendation', check: checkedBy, hasStoredDays: true }),
        row(T.expert, 'Grapes - Expert Schedule', { ownerType: 'EXPERT', sourceLabel: 'Test Expert', check: checkedBy, hasStoredDays: true }),
        row(T.bloom, 'Grapes - Bloom Schedule', { ownerType: 'EXPERT', sourceLabel: 'Test Bloom', check: checkedBy, hasStoredDays: true }),
        row(T.own, 'Grapes - My Own', { ownerType: 'USER', sourceLabel: 'अशोक पाटील', check: null }),
        row(T.sample, 'Grapes - Standard Seasonal Template', { check: null, ownerType: null }),
    ],
    sampleOnly: [row(T.sample, 'Grapes - Standard Seasonal Template', { check: null, ownerType: null })],
};

const server = (id: string, templateId: string, slot: number | null, extra: Partial<ScheduleSubscriptionRow> = {}, plotId = PLOT_1, cycleId = CYCLE_1): ScheduleSubscriptionRow => ({
    id, farmId: FARM, plotId, cropCycleId: cycleId, templateId, referenceDate: null, state: 'Active', adoptedAtUtc: `2026-10-0${(slot ?? 5) + 1}T00:00:00Z`,
    origin: 'Outside', checkState: 'Checked', ...(slot === null ? {} : { slot }), ...extra,
});

async function seed(rows: ScheduleSubscriptionRow[]) {
    const db = getDatabase();
    for (const [plotId, cycleId] of [[PLOT_1, CYCLE_1], [PLOT_2, CYCLE_2]] as const) {
        await db.plots.put({ id: plotId, farmId: FARM, payload: { id: plotId, farmId: FARM, name: plotId }, updatedAt: '2026-10-01T00:00:00Z' });
        await db.cropCycles.put({ id: cycleId, farmId: FARM, plotId, updatedAt: '2026-10-01T00:00:00Z', payload: { id: cycleId, farmId: FARM, plotId, cropName: 'Grapes', stage: 'x', startDate: REF } });
    }
    await db.scheduleSubscriptions.bulkPut(rows);
}

const twoPlots = (): CropProfile[] => [crop([
    plot({ id: PLOT_1, name: 'A', schedule: { ...plot().schedule, id: 'sch-1', plotId: PLOT_1 } }),
    plot({ id: PLOT_2, name: 'B', schedule: { ...plot().schedule, id: 'sch-2', plotId: PLOT_2 } }),
])];

function mount(initial: CropProfile[] = twoPlots()) {
    const Harness = () => {
        const [crops, setCrops] = useState(initial);
        return <SchedulerPage crops={crops} logs={[]} tasks={[]} onUpdateCrops={setCrops} onBack={() => undefined} onCloseDay={() => undefined} />;
    };
    render(<Harness />);
}

const queuedOf = async (type: string) => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === type).map(r => r.payload as Record<string, unknown>);
const allSchedule = async () => (await getDatabase().mutationQueue.toArray()).filter(r => [SyncMutationName.AdoptSchedule, SyncMutationName.MigrateSchedule, SyncMutationName.AbandonSchedule].includes(r.mutationType as never));

beforeAll(() => setScheduleTemplatesFromReferenceData(TEMPLATES.withChecked));
beforeEach(async () => {
    language.current = 'mr';
    setScheduleTemplatesFromReferenceData(TEMPLATES.withChecked);
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear()]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the section: four places', () => {
    it('Four_places_drawn: 3 outside in place order, his own, the rail, and the heading', async () => {
        await seed([
            server(S.b, T.expert, 2), server(S.a, T.university, 1, { isMain: true }), server(S.c, T.bloom, 3),
            server(S.own, T.own, 0, { origin: 'Own', checkState: undefined }),
        ]);
        mount();
        await screen.findByTestId(`followed-${S.own}`);
        expect(screen.getByTestId('three-plus-one-heading')).toHaveTextContent('तुम्ही पाळत असलेली शेड्यूल');
        expect(screen.getByTestId('three-plus-one-help-open')).toHaveTextContent('3 + 1 म्हणजे काय?');
        expect(screen.getByTestId('three-plus-one-outside-label')).toHaveTextContent('बाहेरची शेड्यूल — 3 पर्यंत');
        expect(screen.getByTestId('three-plus-one-own-label')).toHaveTextContent('तुमचं स्वतःचं — 1');
        const order = [...document.querySelectorAll('[data-testid^="followed-"][data-slot]')].map(e => [e.getAttribute('data-slot'), e.getAttribute('data-origin')]);
        expect(order).toEqual([['1', 'Outside'], ['2', 'Outside'], ['3', 'Outside'], ['0', 'Own']]); // outside places first, then his own
        const rail = screen.getByTestId('three-plus-one-rail');
        expect([...rail.querySelectorAll('b')].map(b => b.getAttribute('data-filled'))).toEqual(['true', 'true', 'true', 'true']);
        // each outside place: name, source, check badge, leave
        expect(screen.getByTestId(`followed-name-${S.a}`)).toHaveTextContent('Grapes - University Schedule');
        expect(screen.getByTestId(`followed-source-${S.a}`)).toHaveTextContent('Test University recommendation');
        expect(screen.getByTestId(`followed-check-${S.a}`)).toHaveTextContent('श्रमसफलने तपासलेलं');
        expect(screen.getByTestId(`followed-leave-${S.a}`)).toHaveTextContent('हे सोडा');
    });

    it('Full_row_disables_add: three outside takes the add button away and says why', async () => {
        await seed([server(S.a, T.university, 1, { isMain: true }), server(S.b, T.expert, 2), server(S.c, T.bloom, 3)]);
        mount();
        await screen.findByTestId('three-plus-one-full');
        expect(screen.getByTestId('three-plus-one-full')).toHaveTextContent('बाहेरची 3 शेड्यूल आधीच पाळताय. नवीन घेण्यासाठी आधी एक सोडा.');
        expect(screen.queryByTestId('three-plus-one-add')).toBeNull();
    });

    it('Full_library_button_is_disabled_with_its_words', () => {
        const words = THREE_PLUS_ONE_WORDS.mr;
        render(<ScheduleLibraryView crop={crop()} allCrops={[crop()]} adoptedScheduleId={null} onAdopt={vi.fn()}
            plotAdd={{ followedTemplateIds: new Set([T.university]), full: true, words: { follow: words.follow, fullWhy: words.fullButtonWhy, alreadyFollowed: words.alreadyFollowed, title: words.libraryTitle } }} />);
        const open = screen.getByTestId(`library-adopt-${T.expert}`);
        expect(open).toBeDisabled();
        expect(open).toHaveTextContent('हे शेड्यूल पण पाळा');
        expect(screen.getByTestId(`library-full-${T.expert}`)).toHaveTextContent('बाहेरची 3 शेड्यूल आधीच पाळताय');
        expect(screen.queryByTestId(`library-adopt-${T.university}`)).toBeNull(); // the one he follows says so instead
    });

    it('Own_place_disabled_with_words: empty = no tap target, P5', async () => {
        await seed([server(S.a, T.university, 1, { isMain: true })]);
        mount();
        const own = await screen.findByTestId('three-plus-one-own-empty');
        expect(own).toHaveAttribute('aria-disabled', 'true');
        expect(own).toHaveTextContent('स्वतःचं शेड्यूल बनवा');
        expect(own).toHaveTextContent('सुरुवातीला ही जागा रिकामी असते. नियोजनात बनवता येईल.');
        expect(within(own).queryByRole('button')).toBeNull();
        fireEvent.click(own);
        expect(await allSchedule()).toHaveLength(0); // nothing happens, nothing is queued
    });

    it('Filled_own_place: no badge, the no-check line, the maker line only when a maker exists', async () => {
        await seed([server(S.a, T.university, 1, { isMain: true }), server(S.own, T.own, 0, { origin: 'Own', checkState: undefined })]);
        mount();
        await screen.findByTestId(`followed-${S.own}`);
        expect(screen.getByTestId(`followed-own-note-${S.own}`)).toHaveTextContent('स्वतःच्या शेड्यूलला तपासणी लागत नाही');
        expect(screen.queryByTestId(`followed-check-${S.own}`)).toBeNull(); // never a ShramSafal badge
        expect(screen.getByTestId(`followed-${S.own}`).textContent).not.toContain('तपासणी बाकी');
        expect(screen.getByTestId(`followed-maker-${S.own}`)).toHaveTextContent('बनवलं: अशोक पाटील');
        expect(screen.getByTestId(`followed-leave-${S.own}`)).toHaveTextContent('हे सोडा');
        cleanup();
        // no maker name on the schedule (the built-in tag is not a person): no "बनवलं" line at all (P4; SCH-OWN fills it)
        setScheduleTemplatesFromReferenceData([...TEMPLATES.withChecked.filter(t => t.id !== T.own), row(T.own, 'Grapes - My Own', { ownerType: 'USER', check: null })]);
        mount();
        await screen.findByTestId(`followed-${S.own}`);
        expect(screen.queryByTestId(`followed-maker-${S.own}`)).toBeNull();
    });

    it('Free_place_says_checked_only; on a crop with no checked schedule the sample can be chosen (D-91 = 1)', async () => {
        await seed([server(S.a, T.sample, 1, { isMain: true, checkState: 'NotChecked' })]);
        mount();
        await screen.findByTestId(`followed-${S.a}`);
        expect(await screen.findByTestId('three-plus-one-add-why')).toHaveTextContent('श्रमसफलने तपासलेलीच शेड्यूल इथे निवडता येतात');
        cleanup();
        setScheduleTemplatesFromReferenceData(TEMPLATES.sampleOnly);
        mount();
        expect(await screen.findByTestId('three-plus-one-add-why')).toHaveTextContent('तपासलेलं शेड्यूल येईपर्यंत नमुना निवडता येतो');
        // the sample followed is drawn as not yet checked, never as checked
        await screen.findByTestId(`followed-check-${S.a}`);
        expect(screen.getByTestId(`followed-check-${S.a}`)).toHaveAttribute('data-check-state', 'NotChecked');
        expect(screen.getByTestId(`followed-check-${S.a}`)).toHaveTextContent('श्रमसफलने अजून तपासलेलं नाही');
    });

    it('Main_sits_on_the_row_the_server_marked_not_one_the_phone_counted', async () => {
        // the server marked place 3 (a checked Institution schedule) - NOT the lowest place
        await seed([server(S.a, T.expert, 1), server(S.b, T.bloom, 2), server(S.c, T.university, 3, { isMain: true })]);
        mount();
        await screen.findByTestId('three-plus-one');
        expect(screen.getByTestId(`followed-main-${S.c}`)).toHaveTextContent('मुख्य');
        expect(screen.queryByTestId(`followed-main-${S.a}`)).toBeNull();
        expect(screen.queryByTestId(`followed-main-${S.b}`)).toBeNull();
        // the stage line follows the main schedule, and says so when two or more are followed
        expect(screen.getByTestId('stage-line-note')).toHaveTextContent('स्टेजची ओळ मुख्य शेड्यूलवरून: Grapes - University Schedule');
        expect(screen.getByTestId('sched-name')).toHaveTextContent('University');
    });
});

describe('add and drop enqueue adopt / abandon with subscriptionId', () => {
    it('Add_enqueues_an_adopt_for_THIS_plot_only: never crop-wide, never a switch; the toast offers undo', async () => {
        await seed([server(S.a, T.university, 1, { isMain: true })]);
        mount();
        fireEvent.click(await screen.findByTestId('three-plus-one-add'));
        fireEvent.click(await screen.findByTestId(`library-adopt-${T.expert}`));

        await waitFor(async () => expect(await queuedOf(SyncMutationName.AdoptSchedule)).toHaveLength(1));
        const [adopt] = await queuedOf(SyncMutationName.AdoptSchedule);
        expect(adopt).toMatchObject({ farmId: FARM, plotId: PLOT_1, cropCycleId: CYCLE_1, scheduleTemplateId: T.expert });
        expect(typeof adopt.subscriptionId).toBe('string');
        expect(adopt).not.toHaveProperty('carryOver');
        expect(await queuedOf(SyncMutationName.MigrateSchedule)).toHaveLength(0); // never a switch
        expect((await queuedOf(SyncMutationName.AdoptSchedule)).map(p => p.plotId)).toEqual([PLOT_1]); // the other plot is not touched
        // kept on this phone at once as an unanswered addition; the main schedule did not change
        const rows = await getDatabase().scheduleSubscriptions.toArray();
        expect(rows.filter(r => r.pending).map(r => [r.templateId, r.isMain])).toEqual([[T.expert, undefined]]);
        expect(await screen.findByTestId('schedule-toast-text')).toHaveTextContent('हे शेड्यूल पण पाळताय');
        expect(await screen.findByTestId(`followed-${adopt.subscriptionId as string}`)).toBeInTheDocument();
        expect(screen.getByTestId(`followed-pending-${adopt.subscriptionId as string}`)).toHaveTextContent('फोनवर ठेवलं');
        expect(screen.getByTestId(`followed-main-${S.a}`)).toBeInTheDocument();

        // undo = the reverse act queued at once: an abandon of the new subscription id
        fireEvent.click(screen.getByTestId('schedule-toast-undo'));
        await waitFor(async () => expect(await queuedOf(SyncMutationName.AbandonSchedule)).toHaveLength(1));
        expect((await queuedOf(SyncMutationName.AbandonSchedule))[0]).toMatchObject({ plotId: PLOT_1, subscriptionId: adopt.subscriptionId });
    });

    it('Drop_enqueues_an_abandon_with_subscriptionId and the row is no longer drawn; undo re-adopts the dropped schedule', async () => {
        await seed([server(S.a, T.university, 1, { isMain: true }), server(S.b, T.expert, 2)]);
        mount();
        fireEvent.click(await screen.findByTestId(`followed-leave-${S.b}`));

        await waitFor(async () => expect(await queuedOf(SyncMutationName.AbandonSchedule)).toHaveLength(1));
        expect((await queuedOf(SyncMutationName.AbandonSchedule))[0]).toMatchObject({ farmId: FARM, plotId: PLOT_1, cropCycleId: CYCLE_1, subscriptionId: S.b });
        await waitFor(() => expect(screen.queryByTestId(`followed-${S.b}`)).toBeNull());
        expect(screen.getByTestId(`followed-${S.a}`)).toBeInTheDocument(); // the other one stays
        expect(await screen.findByTestId('schedule-toast-text')).toHaveTextContent('हे शेड्यूल सोडलं');
        expect((await getDatabase().scheduleSubscriptions.get(S.b))?.ending).toBe(true);

        fireEvent.click(screen.getByTestId('schedule-toast-undo'));
        await waitFor(async () => expect(await queuedOf(SyncMutationName.AdoptSchedule)).toHaveLength(1));
        expect((await queuedOf(SyncMutationName.AdoptSchedule))[0]).toMatchObject({ plotId: PLOT_1, scheduleTemplateId: T.expert });
    });

    it('Header_switch_names_the_main_row: fromSubscriptionId is the main one, the others are untouched', async () => {
        await seed([server(S.a, T.expert, 1), server(S.b, T.university, 2, { isMain: true })]);
        mount();
        fireEvent.click(await screen.findByTestId('open-editor'));
        fireEvent.click(await screen.findByTestId(`editor-schedule-${T.bloom}`));
        fireEvent.click(screen.getByTestId('editor-save'));

        await waitFor(async () => expect(await queuedOf(SyncMutationName.MigrateSchedule)).toHaveLength(1));
        expect((await queuedOf(SyncMutationName.MigrateSchedule))[0]).toMatchObject({ plotId: PLOT_1, newScheduleTemplateId: T.bloom, fromSubscriptionId: S.b });
        const rows = await getDatabase().scheduleSubscriptions.toArray();
        expect(rows.find(r => r.id === S.a)?.state).toBe('Active'); // B001: nothing of the server's is touched
        const pending = rows.find(r => r.pending);
        expect(pending).toMatchObject({ replacesId: S.b, slot: 2, isMain: true }); // stands in for the row it replaces: its place, its mark
    });
});

describe('the pull and the sweep', () => {
    const pull = (extra: Record<string, unknown>) => ({ scheduleSubscriptions: [], ...extra }) as never;
    const dto = (r: ScheduleSubscriptionRow) => ({
        id: r.id, farmId: r.farmId, plotId: r.plotId, cropCycleId: r.cropCycleId, cropKey: 'grapes', scheduleTemplateId: r.templateId, scheduleVersionTag: 'v1',
        adoptedAtUtc: r.adoptedAtUtc, state: r.state, checkState: r.checkState, origin: r.origin, slot: r.slot,
    });

    it('The_second_phone_shows_the_same_list_after_a_pull', async () => {
        await seed([]);
        const rows = [server(S.a, T.expert, 1), server(S.b, T.university, 2), server(S.c, T.bloom, 3)];
        await reconcileScheduleSubscriptions(getDatabase(), pull({
            scheduleSubscriptions: rows.map(dto),
            plotMainSchedules: [{ plotId: PLOT_1, cropCycleId: CYCLE_1, subscriptionId: S.b }],
        }));
        mount();
        await screen.findByTestId(`followed-${S.c}`);
        expect([...document.querySelectorAll('[data-testid^="followed-"][data-slot]')].map(e => e.getAttribute('data-slot'))).toEqual(['1', '2', '3']);
        expect(screen.getByTestId(`followed-main-${S.b}`)).toBeInTheDocument();
        // a withdrawal on the server: the NEXT pull names another row (the key is full on every pull) and the mark moves
        await reconcileScheduleSubscriptions(getDatabase(), pull({ plotMainSchedules: [{ plotId: PLOT_1, cropCycleId: CYCLE_1, subscriptionId: S.a }] }));
        await waitFor(() => expect(screen.getByTestId(`followed-main-${S.a}`)).toBeInTheDocument());
        expect(screen.queryByTestId(`followed-main-${S.b}`)).toBeNull();
    });

    it('An_older_server_that_names_no_main_leaves_the_marks_and_the_phone_falls_back_to_the_newest_Active_row', async () => {
        await seed([server(S.a, T.expert, 1, { isMain: true })]);
        await reconcileScheduleSubscriptions(getDatabase(), pull({ scheduleSubscriptions: [] })); // no plotMainSchedules key at all
        expect((await getDatabase().scheduleSubscriptions.get(S.a))?.isMain).toBe(true);
        // a slot the server did not send is left out, never guessed
        await reconcileScheduleSubscriptions(getDatabase(), pull({ scheduleSubscriptions: [{ ...dto(server(S.b, T.bloom, 2)), slot: 'x' }] }));
        expect((await getDatabase().scheduleSubscriptions.get(S.b))?.slot).toBeUndefined();
        // P11: with no mark anywhere the choice is today's best Active row
        await getDatabase().scheduleSubscriptions.clear();
        await seed([server(S.a, T.expert, null, { adoptedAtUtc: '2026-10-01T00:00:00Z' })]);
        expect((await readPlotChoices()).get(PLOT_1)?.id).toBe(S.a);
    });

    it('The_sweep_keeps_a_pending_adopt_for_a_second_place_while_the_server_shows_the_first', async () => {
        await seed([server(S.a, T.university, 1, { isMain: true })]);
        const pendingId = 'eeeeeeee-0000-4000-8000-000000000001';
        await getDatabase().scheduleSubscriptions.put({ ...server(pendingId, T.expert, null), pending: true, checkState: undefined });
        const requestId = `${SyncMutationName.AdoptSchedule}:${pendingId}`;
        await getDatabase().mutationQueue.add({
            deviceId: mutationQueue.getDeviceId(), clientRequestId: requestId, clientCommandId: requestId, mutationType: SyncMutationName.AdoptSchedule,
            payload: {}, status: 'PENDING', createdAt: 'x', updatedAt: 'x', retryCount: 0,
        });

        await sweepPendingScheduleChoices(getDatabase());
        expect((await getDatabase().scheduleSubscriptions.get(pendingId))?.pending).toBe(true); // waiting: kept (the old rule dropped it: a DIFFERENT row on the server)

        // refused (the limit) while the server shows something: the server's list stands, the parked request keeps its words
        const queueRow = (await getDatabase().mutationQueue.toArray())[0];
        await getDatabase().mutationQueue.update(queueRow.id!, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.ScheduleLimitReached' });
        await sweepPendingScheduleChoices(getDatabase());
        expect(await getDatabase().scheduleSubscriptions.get(pendingId)).toBeUndefined();
        expect((await getDatabase().mutationQueue.toArray())[0].status).toBe('REJECTED_USER_REVIEW'); // still parked for him to read
    });

    it('A_letting_go_that_the_server_refused_is_drawn_again', async () => {
        await seed([server(S.a, T.university, 1, { isMain: true }), server(S.b, T.expert, 2, { ending: true })]);
        const requestId = `${SyncMutationName.AbandonSchedule}:${S.b}`;
        await getDatabase().mutationQueue.add({
            deviceId: mutationQueue.getDeviceId(), clientRequestId: requestId, clientCommandId: requestId, mutationType: SyncMutationName.AbandonSchedule,
            payload: {}, status: 'PENDING', createdAt: 'x', updatedAt: 'x', retryCount: 0,
        });
        await sweepPendingScheduleChoices(getDatabase());
        expect((await getDatabase().scheduleSubscriptions.get(S.b))?.ending).toBe(true); // waiting: still not drawn
        const queueRow = (await getDatabase().mutationQueue.toArray())[0];
        await getDatabase().mutationQueue.update(queueRow.id!, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.Forbidden' });
        await sweepPendingScheduleChoices(getDatabase());
        expect((await getDatabase().scheduleSubscriptions.get(S.b))?.ending).toBeUndefined();
    });
});

describe('resolvePlotSchedule', () => {
    it('returns_main_and_the_followed_in_slot_order', async () => {
        await seed([server(S.c, T.bloom, 3), server(S.a, T.expert, 1), server(S.b, T.university, 2, { isMain: true }), server(S.own, T.own, 0, { origin: 'Own', checkState: undefined })]);
        const followed = (await readFollowedByPlot()).get(PLOT_1)!;
        const choice = choiceForPlot(followed, CYCLE_1)!;
        const resolved = resolvePlotSchedule(crop([plot({ id: PLOT_1 })]), plot({ id: PLOT_1 }), '2026-10-26', choice)!;

        expect(resolved.template.id).toBe(T.university); // the header, the stage line and the tabs follow the main schedule
        expect(resolved.source).toBe('adopted');
        expect(resolved.followed.map(f => [f.slot, f.templateId, f.origin, f.isMain])).toEqual([
            [0, T.own, 'Own', false], [1, T.expert, 'Outside', false], [2, T.university, 'Outside', true], [3, T.bloom, 'Outside', false],
        ]);
        // a single-row choice (every caller before this lane) still resolves, with one followed place
        const single = resolvePlotSchedule(crop([plot({ id: PLOT_1 })]), plot({ id: PLOT_1 }), '2026-10-26', { templateId: T.expert, referenceDate: null, pending: false })!;
        expect(single.template.id).toBe(T.expert);
        expect(single.followed).toHaveLength(1);
        // nobody chose: the app's default is not a followed schedule
        expect(resolvePlotSchedule(crop([plot({ id: PLOT_2 })]), plot({ id: PLOT_2 }), '2026-10-26')!.followed).toEqual([]);
    });
});

describe('words: one language at a time', () => {
    it('English_mode_shows_English_only', async () => {
        language.current = 'en';
        await seed([server(S.a, T.university, 1, { isMain: true }), server(S.b, T.expert, 2)]);
        mount();
        const section = await screen.findByTestId('three-plus-one');
        await screen.findByTestId(`followed-${S.b}`);
        expect(section).toHaveAttribute('data-language', 'en');
        const text = section.textContent ?? '';
        expect(text).toContain('Schedules you follow · 3 + 1');
        expect(text).toContain('What does 3 + 1 mean?');
        expect(text).toContain('Main');
        expect(text).toContain('Stop following');
        expect(text).toContain('Follow this one too');
        expect(text).toContain('Make your own schedule');
        expect(text).toContain('Checked by ShramSafal');
        expect(text).not.toMatch(/[ऀ-ॿ]/); // no Devanagari anywhere in the section
        fireEvent.click(screen.getByTestId('three-plus-one-help-open'));
        const help = await screen.findByTestId('three-plus-one-help');
        expect(help.textContent).not.toMatch(/[ऀ-ॿ]/);
        expect(help.querySelectorAll('li')).toHaveLength(5); // line 5 (per-stage task count in planning) is withheld - P10 (fix round 1, L001)
    });

    it('Marathi_mode_shows_Marathi_only; the help sheet carries its five lines', async () => {
        await seed([server(S.a, T.university, 1, { isMain: true }), server(S.b, T.expert, 2)]);
        mount();
        const section = await screen.findByTestId('three-plus-one');
        expect(section).toHaveAttribute('data-language', 'mr');
        const own = screen.getByTestId('three-plus-one-own-empty');
        for (const element of [screen.getByTestId('three-plus-one-heading'), screen.getByTestId('three-plus-one-add'), own, screen.getByTestId(`followed-leave-${S.a}`), screen.getByTestId(`followed-main-${S.a}`)]) {
            expect(element.textContent).not.toMatch(/[A-Za-z]{4,}/);
        }
        fireEvent.click(screen.getByTestId('three-plus-one-help-open'));
        const help = await screen.findByTestId('three-plus-one-help');
        expect(help.querySelectorAll('li')).toHaveLength(5);
        expect(help).toHaveTextContent('एका प्लॉटसाठी तुम्ही बाहेरची 3 शेड्यूल पाळू शकता');
        expect(help).toHaveTextContent('शासन किंवा कृषी विद्यापीठाचं तपासलेलं शेड्यूल पाळत असाल तर ते "मुख्य" असतं');
        fireEvent.click(screen.getByTestId('three-plus-one-help-close'));
        expect(screen.queryByTestId('three-plus-one-help')).toBeNull();
    });
});

describe('fix round 1', () => {
    it('L001: the help sheet carries five lines in both languages and none says the per-stage count shows in planning (P10)', async () => {
        await seed([server(S.a, T.university, 1, { isMain: true })]);
        for (const lang of ['mr', 'en'] as const) {
            language.current = lang;
            mount();
            fireEvent.click(await screen.findByTestId('three-plus-one-help-open'));
            const help = await screen.findByTestId('three-plus-one-help');
            expect(help.querySelectorAll('li')).toHaveLength(5);
            expect(help.textContent).not.toContain('किती वेळा सांगतं');
            expect(help.textContent).not.toContain('how many times each of your schedules');
            cleanup();
        }
    });

    it('L003: the toast hides by itself after 4 s; Undo before that still queues the reverse act; the timer is cleared on unmount', async () => {
        await seed([server(S.a, T.university, 1, { isMain: true }), server(S.b, T.expert, 2)]);
        const real = window.setTimeout.bind(window);
        const realClear = window.clearTimeout.bind(window);
        const timers = new Map<number, () => void>();
        const cleared: number[] = [];
        let next = 9000;
        vi.spyOn(window, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
            if (ms === 4000) { next += 1; timers.set(next, fn); return next as unknown as ReturnType<typeof setTimeout>; }
            return real(fn, ms, ...(rest as []));
        }) as never);
        vi.spyOn(window, 'clearTimeout').mockImplementation(((id?: number) => {
            if (typeof id === 'number' && timers.has(id)) { cleared.push(id); timers.delete(id); return; }
            realClear(id);
        }) as never);
        mount();
        fireEvent.click(await screen.findByTestId(`followed-leave-${S.b}`));
        expect(await screen.findByTestId('schedule-toast')).toBeInTheDocument();
        expect(screen.getByTestId('schedule-toast-undo')).toHaveTextContent('परत आणा'); // the working screen's own word
        await waitFor(() => expect(timers.size).toBe(1));
        // not yet 4 s: Undo still queues the reverse act
        fireEvent.click(screen.getByTestId('schedule-toast-undo'));
        await waitFor(async () => expect(await queuedOf(SyncMutationName.AdoptSchedule)).toHaveLength(1));
        expect(screen.queryByTestId('schedule-toast')).toBeNull();
        expect(timers.size).toBe(0); // the timer of the closed toast was cleared

        // a toast nobody touched is gone after 4 s
        fireEvent.click(await screen.findByTestId(`followed-leave-${S.a}`));
        await screen.findByTestId('schedule-toast');
        await waitFor(() => expect(timers.size).toBe(1));
        const [fire] = [...timers.values()];
        await act(async () => { fire(); });
        expect(screen.queryByTestId('schedule-toast')).toBeNull();
        expect(await queuedOf(SyncMutationName.AbandonSchedule)).toHaveLength(2); // hiding it queued nothing more

        // unmount with a toast showing clears its timer
        cleanup();
        await seed([server('dddddddd-0000-4000-8000-0000000000e1', T.bloom, 3)]);
        mount();
        fireEvent.click(await screen.findByTestId('followed-leave-dddddddd-0000-4000-8000-0000000000e1'));
        await screen.findByTestId('schedule-toast');
        await waitFor(() => expect(timers.size).toBe(1));
        cleanup();
        expect(timers.size).toBe(0);
    });

    it('L003: the Undo word in English is Undo', async () => {
        language.current = 'en';
        await seed([server(S.a, T.university, 1, { isMain: true }), server(S.b, T.expert, 2)]);
        mount();
        fireEvent.click(await screen.findByTestId(`followed-leave-${S.b}`));
        expect(await screen.findByTestId('schedule-toast-undo')).toHaveTextContent('Undo');
    });

    it('L004: a pending first choice the server REFUSED does not say "kept on this phone - sent when the net returns"', async () => {
        const id = 'eeeeeeee-0000-4000-8000-0000000000f1';
        await seed([{ ...server(id, T.expert, null), pending: true, checkState: undefined }]);
        const requestId = `${SyncMutationName.AdoptSchedule}:${id}`;
        await getDatabase().mutationQueue.add({
            deviceId: mutationQueue.getDeviceId(), clientRequestId: requestId, clientCommandId: requestId, mutationType: SyncMutationName.AdoptSchedule,
            payload: {}, status: 'PENDING', createdAt: 'x', updatedAt: 'x', retryCount: 0,
        });
        mount();
        expect(await screen.findByTestId(`followed-pending-${id}`)).toHaveTextContent('फोनवर ठेवलं'); // waiting: the line is true
        cleanup();
        const queueRow = (await getDatabase().mutationQueue.toArray())[0];
        await getDatabase().mutationQueue.update(queueRow.id!, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.ScheduleNotChecked' });
        mount();
        await screen.findByTestId(`followed-${id}`); // his choice stays visible (P10; the parked request keeps the words)
        expect(screen.queryByTestId(`followed-pending-${id}`)).toBeNull(); // but no longer claims it will be sent
    });

    it('L004: a pending row whose request was GIVEN UP (REJECTED_DROPPED) is dropped by the sweep even with no server row', async () => {
        const id = 'eeeeeeee-0000-4000-8000-0000000000f2';
        await seed([{ ...server(id, T.expert, null), pending: true, checkState: undefined }]);
        const requestId = `${SyncMutationName.AdoptSchedule}:${id}`;
        await getDatabase().mutationQueue.add({
            deviceId: mutationQueue.getDeviceId(), clientRequestId: requestId, clientCommandId: requestId, mutationType: SyncMutationName.AdoptSchedule,
            payload: {}, status: 'REJECTED_DROPPED', createdAt: 'x', updatedAt: 'x', retryCount: 0,
        });
        await sweepPendingScheduleChoices(getDatabase());
        expect(await getDatabase().scheduleSubscriptions.get(id)).toBeUndefined();
        // the refused (not given up) one with no server row is still kept: P10, pinned by the existing reconciler tests
        const id2 = 'eeeeeeee-0000-4000-8000-0000000000f3';
        await getDatabase().scheduleSubscriptions.put({ ...server(id2, T.bloom, null), pending: true, checkState: undefined });
        const r2 = `${SyncMutationName.AdoptSchedule}:${id2}`;
        await getDatabase().mutationQueue.add({
            deviceId: mutationQueue.getDeviceId(), clientRequestId: r2, clientCommandId: r2, mutationType: SyncMutationName.AdoptSchedule,
            payload: {}, status: 'REJECTED_USER_REVIEW', createdAt: 'x', updatedAt: 'x', retryCount: 0, errorCode: 'ShramSafal.ScheduleNotChecked',
        });
        await sweepPendingScheduleChoices(getDatabase());
        expect(await getDatabase().scheduleSubscriptions.get(id2)).toBeDefined();
    });

    it.each([
        ['mr', 'शेड्यूल निवडा'],
        ['en', 'Choose a schedule'],
    ] as const)('L006: when the plot follows nothing the free place says a first-choice word, not "too" (%s)', async (lang, word) => {
        language.current = lang;
        await seed([]);
        mount();
        const add = await screen.findByTestId('three-plus-one-add');
        expect(add).toHaveTextContent(word);
        expect(add.textContent).not.toContain('पण पाळा');
        expect(add.textContent).not.toContain('too');
        cleanup();
        // once he follows one, it is "too" again
        await seed([server(S.a, T.university, 1, { isMain: true })]);
        mount();
        // spec: plr-d10 lane SCH-OWN carry-in F206 (test only) - the button is found at once with its old words and the plot's schedule arrives
        // a tick later; waiting for the words (not just for the element) is what makes this stable.
        await waitFor(() => expect(screen.getByTestId('three-plus-one-add')).toHaveTextContent(THREE_PLUS_ONE_WORDS[lang].follow));
    });
});
