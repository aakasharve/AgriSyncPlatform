// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker; P5, P11) - the door from the REAL planning page into the one-work maker:
 *   - the schedule mechanism OFF (or unknown) for the farm: nothing new on the page;
 *   - ON: "माझं शेड्यूल" of the plot-season, "काम जोडा" opens the maker, a saved work comes back to the page as kept-on-the-phone (P10);
 *   - ON but no single plot chosen: the card stays and says when it works (it never vanishes).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: 'mr' }) }));
vi.mock('../components/PlanMic', () => ({ PlanMic: () => <button type="button" data-testid="plan-mic">माइक</button> }));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import type { CropProfile, FarmerProfile } from '../../../types';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { writeScheduleMechanismFarmIds } from '../../../core/session/scheduleMechanism';
import { clearWorkDrafts } from '../../scheduler/ownSchedule/form/workDraftStore';
import { PlanWorkPage } from '../components/PlanWorkPage';

const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const ME = '0a0a0a0a-0000-4000-8000-00000000000a';
const PLOT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const PLOT_2 = 'a1a1a1a1-0000-4000-8000-0000000000a2';
const CYCLE = 'c1c1c1c1-0000-4000-8000-0000000000c1';
const ONE_PLOT = [{ id: 'grape', name: 'Grapes', iconName: 'Grape', color: 'emerald', plots: [{ id: PLOT, name: 'G1' }] }] as unknown as CropProfile[];
const TWO_PLOTS = [{ id: 'grape', name: 'Grapes', iconName: 'Grape', color: 'emerald', plots: [{ id: PLOT, name: 'G1' }, { id: PLOT_2, name: 'G2' }] }] as unknown as CropProfile[];
const PROFILE = { operators: [], activeOperatorId: '' } as unknown as FarmerProfile;

const page = (crops = ONE_PLOT) => render(
    <PlanWorkPage farmId={FARM} userId={ME} language="mr" crops={crops} farmerProfile={PROFILE} mayPlan mayAssign={false} mayMakeOwnSchedule
        onBack={() => undefined} onOpenConflicts={() => undefined} today={new Date(2026, 10, 23)} />,
);

afterEach(() => cleanup());
beforeEach(async () => {
    clearWorkDrafts();
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.appMeta.clear(), db.cropCycles.clear(), db.ownScheduleItems.clear(), db.referenceData.clear(), db.scheduleSubscriptions.clear()]);
    await db.cropCycles.put({ id: CYCLE, farmId: FARM, plotId: PLOT, updatedAt: '2026-10-15T00:00:00Z', payload: { id: CYCLE, farmId: FARM, plotId: PLOT, cropName: 'Grapes', stage: 'x', startDate: '2026-10-15' } } as never);
});

describe('planning page -> the one-work maker (slice 4)', () => {
    it('switch off: nothing new is drawn', async () => {
        page();
        await screen.findByTestId('plan-work');
        await new Promise(r => setTimeout(r, 60));
        expect(screen.queryByTestId('own-work-section')).toBeNull();
        expect(screen.queryByTestId('own-list')).toBeNull();
    });

    it('switch on: "काम जोडा" opens the maker, and the saved work is back on the page, kept on the phone', async () => {
        await writeScheduleMechanismFarmIds(getDatabase(), [FARM], '2026-11-23T00:00:00Z');
        page();
        fireEvent.click(await screen.findByTestId('own-list-add'));
        fireEvent.click(await screen.findByTestId('own-kind-work'));
        fireEvent.change(screen.getByTestId('own-work-name'), { target: { value: 'वांज काढणे' } });
        fireEvent.click(screen.getByTestId('own-work-save'));
        expect(await screen.findByTestId('plan-banner')).toBeInTheDocument();
        const saves = (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.OwnscheduleItemSave);
        expect(saves).toHaveLength(1);
        expect(saves[0].payload).toMatchObject({ farmId: FARM, plotId: PLOT, cropCycleId: CYCLE });
        await waitFor(() => expect(screen.getByText('वांज काढणे')).toBeInTheDocument());
        const key = (saves[0].payload as { task: { taskKey: string } }).task.taskKey;
        expect(screen.getByTestId(`own-list-pending-${key}`)).toBeInTheDocument();
    });

    it('switch on, two plots and none chosen: the card stays and says when it works', async () => {
        await writeScheduleMechanismFarmIds(getDatabase(), [FARM], '2026-11-23T00:00:00Z');
        page(TWO_PLOTS);
        expect(await screen.findByTestId('own-work-waiting')).toBeInTheDocument();
        expect(screen.queryByTestId('own-list-add')).toBeNull();
    });
});
