// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2 Task 2; founder D-32, register F09, C2, P8)
 *
 * The real SchedulerPage over a real (fake-indexeddb) phone database: a schedule chosen on the page is saved on the SERVER -
 * the library's three steps end on ONE named plot = one `adopt_schedule` for that plot (lane UI-8, founder D-150 picture L2; it was one per plot of
 * the crop), the editor's save = one for that plot with its day 0, a switch = `migrate_schedule` with reason `Other` and no text, a plot with no
 * crop season = nothing queued and the page says why. Nothing on the screen moves: the same page, the same words, and the chosen schedule shows at once.
 */
import { autoOpenFolds } from '../../features/scheduler/schedulePage/__tests__/foldTestKit';
import 'fake-indexeddb/auto';
import React, { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../features/scheduler/schedulePage/usePlotClips', () => ({ usePlotClips: () => new Map() }));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../features/finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 0 } }));
// Sending is the worker's job; here only what the page QUEUES is read.
vi.mock('../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import SchedulerPage from '../SchedulerPage';
import { setScheduleTemplatesFromReferenceData } from '../../infrastructure/reference/TemplateCatalog';
import { getDatabase, resetDatabase } from '../../infrastructure/storage/DexieDatabase';
import type { CropProfile } from '../../types';
import { SC } from '../../features/scheduler/schedulePage/scheduleCopy';
import { SPRAY_TEMPLATE, SPRAY_TEMPLATE_ID, SERVER_TEMPLATE, TEMPLATE_ID, REF, crop, plot } from '../../features/scheduler/schedulePage/__tests__/scheduleFixtures';
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';

const FARM = '11111111-1111-4111-8111-111111111111';
const PLOT_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLOT_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const CYCLE_1 = 'cccccccc-0000-4000-8000-000000000001';
const CYCLE_2 = 'cccccccc-0000-4000-8000-000000000002';

const twoPlots = (): CropProfile[] => [crop([
    plot({ id: PLOT_1, name: 'A', schedule: { ...plot().schedule, id: 'sch-1', plotId: PLOT_1 } }),
    plot({ id: PLOT_2, name: 'B', schedule: { ...plot().schedule, id: 'sch-2', plotId: PLOT_2 } }),
])];

async function seedSeasons(plots: Array<[string, string]>) {
    const db = getDatabase();
    for (const [plotId, cycleId] of plots) {
        await db.plots.put({ id: plotId, farmId: FARM, payload: { id: plotId, farmId: FARM, name: plotId }, updatedAt: '2026-10-01T00:00:00Z' });
        await db.cropCycles.put({
            id: cycleId, farmId: FARM, plotId, updatedAt: '2026-10-01T00:00:00Z',
            payload: { id: cycleId, farmId: FARM, plotId, cropName: 'Grapes', stage: 'x', startDate: REF },
        });
    }
}

/** Lane UI-8: the library's steps 2 and 3 - pick the schedule's radio row, then the one big button. */
function chooseInLibrary(templateId: string) {
    fireEvent.click(screen.getByTestId(`library-pick-${templateId}`));
    fireEvent.click(screen.getByTestId('library-confirm'));
}

async function queued() {
    return (await getDatabase().mutationQueue.toArray())
        .filter(r => r.mutationType === SyncMutationName.AdoptSchedule || r.mutationType === SyncMutationName.MigrateSchedule)
        .map(r => ({ type: r.mutationType, payload: r.payload as Record<string, unknown> }));
}

function mount(initial: CropProfile[]) {
    const Harness = () => {
        const [crops, setCrops] = useState(initial);
        return <SchedulerPage crops={crops} logs={[]} tasks={[]} onUpdateCrops={setCrops} onBack={() => undefined} onCloseDay={() => undefined} />;
    };
    render(<Harness />);
    autoOpenFolds();
}

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));
beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear()]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('a schedule chosen on the page is saved on the server (L8b-2 Task 2)', () => {
    it("the library's big button enqueues one adopt_schedule for the ONE plot it names - not the crop's other plots (lane UI-8, D-150)", async () => {
        await seedSeasons([[PLOT_1, CYCLE_1], [PLOT_2, CYCLE_2]]);
        mount(twoPlots());
        fireEvent.click(screen.getByTestId('open-library'));
        chooseInLibrary(SPRAY_TEMPLATE_ID);

        await waitFor(async () => expect(await queued()).toHaveLength(1));
        const rows = await queued();
        expect(rows.map(r => r.type)).toEqual([SyncMutationName.AdoptSchedule]);
        expect(rows.map(r => r.payload.plotId)).toEqual([PLOT_1]);
        expect(rows.map(r => r.payload.cropCycleId)).toEqual([CYCLE_1]);
        for (const r of rows) {
            expect(r.payload).toMatchObject({ farmId: FARM, scheduleTemplateId: SPRAY_TEMPLATE_ID });
            expect(r.payload).not.toHaveProperty('referenceDate'); // the library names no day 0
            expect(typeof r.payload.subscriptionId).toBe('string');
        }
        // The choice is kept on this phone at once (pending, until the server answers) and the page already follows it - for that plot only.
        const kept = await getDatabase().scheduleSubscriptions.toArray();
        expect(kept.map(k => [k.plotId, k.templateId, k.pending])).toEqual([[PLOT_1, SPRAY_TEMPLATE_ID, true]]);
        // The step is the confirmation: the page is back on the शेड्यूल tab, on the plot it named.
        expect(screen.getByTestId('schedule-page')).toHaveAttribute('data-view', 'HOME');
        expect(screen.getByTestId('sched-name')).toHaveTextContent('द्राक्ष — फवारणी शेड्यूल');
        expect(screen.queryByTestId('sched-choice-note')).toBeNull(); // nothing new is said when it could be sent
    });

    it('step 1 picks the plot: choosing B enqueues one adopt for B only', async () => {
        await seedSeasons([[PLOT_1, CYCLE_1], [PLOT_2, CYCLE_2]]);
        mount(twoPlots());
        fireEvent.click(screen.getByTestId('open-library'));
        fireEvent.click(screen.getByTestId(`library-plot-${PLOT_2}`));
        expect(screen.getByTestId('library-confirm')).toHaveTextContent('द्राक्ष · B साठी हे शेड्यूल लावा');
        chooseInLibrary(SPRAY_TEMPLATE_ID);
        await waitFor(async () => expect(await queued()).toHaveLength(1));
        expect((await queued())[0].payload).toMatchObject({ plotId: PLOT_2, cropCycleId: CYCLE_2, scheduleTemplateId: SPRAY_TEMPLATE_ID });
        expect((await getDatabase().scheduleSubscriptions.toArray()).map(k => k.plotId)).toEqual([PLOT_2]);
        expect(screen.getByTestId('sched-crop-plot')).toHaveTextContent('द्राक्ष · B'); // the page came back on the plot it named
        expect(screen.getByTestId('sched-name')).toHaveTextContent('द्राक्ष — फवारणी शेड्यूल');
    });

    it('editor save enqueues one adopt for THAT plot with its day 0; the other plot is not touched (founder C2)', async () => {
        await seedSeasons([[PLOT_1, CYCLE_1], [PLOT_2, CYCLE_2]]);
        mount(twoPlots());
        fireEvent.click(screen.getByTestId('open-editor'));
        fireEvent.click(screen.getByTestId(`editor-schedule-${SPRAY_TEMPLATE_ID}`));
        fireEvent.change(screen.getByTestId('editor-date'), { target: { value: '2026-10-18' } });
        fireEvent.click(screen.getByTestId('editor-save'));

        await waitFor(async () => expect(await queued()).toHaveLength(1));
        const [row] = await queued();
        expect(row.type).toBe(SyncMutationName.AdoptSchedule);
        expect(row.payload).toMatchObject({ farmId: FARM, plotId: PLOT_1, cropCycleId: CYCLE_1, scheduleTemplateId: SPRAY_TEMPLATE_ID, referenceDate: '2026-10-18' });
        expect((await getDatabase().scheduleSubscriptions.toArray()).map(k => k.plotId)).toEqual([PLOT_1]);
    });

    it('a plot that already follows a schedule is SWITCHED: migrate_schedule, reason Other, no text, the day 0 kept', async () => {
        await seedSeasons([[PLOT_1, CYCLE_1]]);
        await getDatabase().scheduleSubscriptions.put({
            id: 'dddddddd-0000-4000-8000-000000000001', farmId: FARM, plotId: PLOT_1, cropCycleId: CYCLE_1, templateId: TEMPLATE_ID,
            referenceDate: '2026-10-17', state: 'Active', adoptedAtUtc: '2026-10-17T00:00:00Z',
        });
        mount([crop([plot({ id: PLOT_1, schedule: { ...plot().schedule, plotId: PLOT_1 } })])]);
        fireEvent.click(screen.getByTestId('open-library'));
        chooseInLibrary(SPRAY_TEMPLATE_ID);

        await waitFor(async () => expect(await queued()).toHaveLength(1));
        const [row] = await queued();
        expect(row.type).toBe(SyncMutationName.MigrateSchedule);
        expect(row.payload).toMatchObject({ plotId: PLOT_1, cropCycleId: CYCLE_1, newScheduleTemplateId: SPRAY_TEMPLATE_ID, reason: 'Other' });
        expect(row.payload).not.toHaveProperty('reasonText'); // the screen asks no reason (P8)
        expect(row.payload).not.toHaveProperty('referenceDate'); // none named: the server keeps the plot's day 0
        expect(row.payload).toMatchObject({ fromSubscriptionId: 'dddddddd-0000-4000-8000-000000000001' }); // B006
        const rows = await getDatabase().scheduleSubscriptions.toArray();
        // B001: the server's row is not touched before the server answers; the change lives on the pending row
        expect(rows.find(r => r.id === 'dddddddd-0000-4000-8000-000000000001')?.state).toBe('Active');
        expect(rows.filter(r => r.pending).map(r => [r.templateId, r.referenceDate])).toEqual([[SPRAY_TEMPLATE_ID, '2026-10-17']]);
    });

    it('a plot with no crop season on the server: nothing is queued and the page says why; the choice still shows', async () => {
        await seedSeasons([[PLOT_1, CYCLE_1]]); // plot 2 has no season
        mount(twoPlots());
        fireEvent.click(screen.getByTestId('open-library'));
        fireEvent.click(screen.getByTestId(`library-plot-${PLOT_2}`));
        chooseInLibrary(SPRAY_TEMPLATE_ID);

        expect(await screen.findByTestId('sched-choice-note')).toHaveTextContent(SC.choiceNotSent);
        // B009: the line says what is true - the choice is on this phone only until chosen again; it promises no later send.
        expect(SC.choiceNotSent).toBe('या प्लॉटचा हंगाम अजून सर्व्हरवर नाही, म्हणून ही निवड फक्त या फोनवर आहे. हंगाम सर्व्हरवर पोचल्यावर पुन्हा निवडा.');
        const rows = await queued();
        expect(rows).toHaveLength(0); // the plot the server cannot be told about: nothing is sent
        expect(screen.getByTestId('sched-name')).toHaveTextContent('द्राक्ष — फवारणी शेड्यूल');
    });

    it('Task 6: no "only on this phone" wording for the schedule choice, before or after choosing; nothing new is drawn', async () => {
        await seedSeasons([[PLOT_1, CYCLE_1], [PLOT_2, CYCLE_2]]);
        mount(twoPlots());
        // "फक्त या फोनवरचं रेकॉर्डिंग" is about a day's voice clips, not the choice; every other form of the line is the old wording.
        const oldWording = /फक्त या फोनवर(?!चं)|only on this phone|फक्त या फोनवर साठवलं/i;
        const seen: string[] = [document.body.textContent ?? ''];
        fireEvent.click(screen.getByTestId('open-library'));
        seen.push(document.body.textContent ?? '');
        chooseInLibrary(SPRAY_TEMPLATE_ID);
        await waitFor(async () => expect(await queued()).toHaveLength(1));
        seen.push(document.body.textContent ?? '');
        fireEvent.click(await screen.findByTestId('open-editor'));
        seen.push(document.body.textContent ?? '');
        fireEvent.click(screen.getByTestId(`editor-schedule-${TEMPLATE_ID}`));
        seen.push(document.body.textContent ?? '');
        for (const text of seen) expect(text).not.toMatch(oldWording);
        expect(screen.queryByTestId('sched-choice-note')).toBeNull();
    });
});
