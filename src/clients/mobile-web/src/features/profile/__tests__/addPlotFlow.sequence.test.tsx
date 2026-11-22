// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane WIZARD-F2; founder pick F2, 2026-11-19)
 *
 * The WHOLE flow, end to end on the phone, with nothing between the screen and the outbox mocked except the sync worker (no network):
 * the real wizard (step 3 answered with an earlier date) -> the real `useCropPlotState.handleAddPlot` -> the real `registerNewPlotOnServer`
 * -> the real MutationQueue over fake-indexeddb. What the server will be sent, in order:
 *   1. create_plot            (the new plot)
 *   2. create_crop_cycle      (starts on the CHOSEN day)
 *   3. adopt_schedule         (the crop's checked schedule, day 0 = the chosen day, for the NEW plot only)
 * and an existing plot of the same crop is not touched: not its schedule, not a queue row.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import AddPlotWizard from '../components/AddPlotWizard';
import { useCropPlotState } from '../hooks/useCropPlotState';
import { cropCycleIdForPlot } from '../../sync/plots/pendingPlots';
import { setScheduleTemplatesFromReferenceData } from '../../../infrastructure/reference/TemplateCatalog';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { SERVER_TEMPLATE } from '../../scheduler/schedulePage/__tests__/scheduleFixtures';
import type { CropProfile, FarmerProfile, Plot } from '../../../types';

const FARM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHECKED = '10000000-0000-4000-8000-000000000003';
const OLD_TEMPLATE = '10000000-0000-4000-8000-0000000000aa';
const OLD_PLOT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const existingPlot = (): Plot => ({
    id: OLD_PLOT, name: 'जुना बाग', startDate: '2026-01-10', baseline: { totalArea: 1, unit: 'Acre' },
    schedule: { id: 'sch_old', plotId: OLD_PLOT, templateId: OLD_TEMPLATE, referenceType: 'PRUNING', referenceDate: '2026-01-10', stageOverrides: [], expectationOverrides: [] },
} as Plot);
const grapes = (): CropProfile => ({
    id: 'c_grapes', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', plots: [existingPlot()], activeScheduleId: OLD_TEMPLATE, supportedTasks: [], workflow: [],
});
const profile = { name: 'T', village: '', phone: '', language: 'mr', operators: [], activeOperatorId: '', waterResources: [], motors: [], machineries: [] } as unknown as FarmerProfile;

const next = () => fireEvent.click(screen.getByRole('button', { name: /profile\.nextStep/ }));
const fillStep = () => {
    for (const el of Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[]) {
        if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden') continue;
        fireEvent.change(el, { target: { value: el.type === 'number' ? '5' : 'abc' } });
    }
};
const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id as number) - (b.id as number));

describe('the add-plot flow, from the screen to the outbox', () => {
    beforeEach(async () => {
        await resetDatabase();
        const db = getDatabase();
        await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.uiPrefs.clear()]);
        SessionStore.setCurrentFarmId(FARM);
        setScheduleTemplatesFromReferenceData([{
            ...SERVER_TEMPLATE, id: CHECKED, name: 'Grapes - Standard Seasonal Template', versionHash: 'h', ownerType: 'INSTITUTION', hasStoredDays: true,
            check: { state: 'Checked', checkerDisplayName: 'x', checkedAtUtc: '2026-11-08T05:00:00Z', note: null },
        }]);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-19T06:00:00Z'));
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        SessionStore.clearCurrentFarmId();
        setScheduleTemplatesFromReferenceData([]);
    });

    it('an earlier planting date: create_plot, create_crop_cycle (chosen day), adopt_schedule (chosen day, new plot) - in that order - and the old plot is untouched', async () => {
        const crops = [grapes()];
        const onUpdateCrops = vi.fn();
        const { result } = renderHook(() => useCropPlotState({ crops, onUpdateCrops }));
        act(() => result.current.setWizardCropId('c_grapes'));

        render(<AddPlotWizard crop={crops[0]} profile={profile} onSave={result.current.handleAddPlot} onCancel={vi.fn()} />);
        fillStep(); next();
        fillStep(); next();
        fireEvent.click(screen.getByTestId('plot-start-earlier'));
        fireEvent.change(screen.getByTestId('plot-start-date'), { target: { value: '2026-10-12' } });
        expect(screen.getByTestId('plot-start-day')).toHaveTextContent('आज दिवस ३९');
        fireEvent.click(screen.getByRole('button', { name: /profile\.finishSetup/ }));

        await waitFor(async () => expect((await queue()).map(r => r.mutationType)).toEqual([
            SyncMutationName.CreatePlot, SyncMutationName.CreateCropCycle, SyncMutationName.AdoptSchedule,
        ]));

        const saved = (onUpdateCrops.mock.calls[0][0] as CropProfile[])[0];
        const added = saved.plots[1];
        expect(saved.plots[0]).toEqual(existingPlot());                 // the old plot: not one field moved
        expect(saved.activeScheduleId).toBe(OLD_TEMPLATE);              // the crop's legacy schedule: not rewritten
        expect(added.startDate).toBe('2026-10-12');
        expect(added.schedule).toMatchObject({ templateId: CHECKED, referenceDate: '2026-10-12' });

        const [plotRow, cycleRow, adoptRow] = await queue();
        expect(plotRow.payload).toMatchObject({ plotId: added.id, farmId: FARM });
        expect(cycleRow.payload).toMatchObject({ plotId: added.id, cropName: 'Grapes', startDate: '2026-10-12' });
        expect(adoptRow.payload).toMatchObject({
            plotId: added.id, farmId: FARM, cropCycleId: await cropCycleIdForPlot(added.id), scheduleTemplateId: CHECKED, referenceDate: '2026-10-12',
        });
        // nothing is queued for the old plot, and the phone holds a pending choice for the new plot only
        expect((await queue()).filter(r => JSON.stringify(r.payload).includes(OLD_PLOT))).toEqual([]);
        const subs = await getDatabase().scheduleSubscriptions.toArray();
        expect(subs.map(s => s.plotId)).toEqual([added.id]);
        expect(subs[0]).toMatchObject({ templateId: CHECKED, referenceDate: '2026-10-12', pending: true });
    });

    it('"आज": the plot, its cycle and its schedule all start today', async () => {
        const crops = [grapes()];
        const onUpdateCrops = vi.fn();
        const { result } = renderHook(() => useCropPlotState({ crops, onUpdateCrops }));
        act(() => result.current.setWizardCropId('c_grapes'));
        render(<AddPlotWizard crop={crops[0]} profile={profile} onSave={result.current.handleAddPlot} onCancel={vi.fn()} />);
        fillStep(); next();
        fillStep(); next();
        fireEvent.click(screen.getByTestId('plot-start-today'));
        fireEvent.click(screen.getByRole('button', { name: /profile\.finishSetup/ }));

        await waitFor(async () => expect((await queue()).map(r => r.mutationType)).toContain(SyncMutationName.AdoptSchedule));
        const [, cycleRow, adoptRow] = await queue();
        expect(cycleRow.payload).toMatchObject({ startDate: '2026-11-19' });
        expect(adoptRow.payload).toMatchObject({ referenceDate: '2026-11-19' });
    });

    it('a crop with no checked schedule: the plot and its cycle are queued on the chosen day and NO adopt is, no pending choice is kept', async () => {
        setScheduleTemplatesFromReferenceData([]);
        const crops = [grapes()];
        const onUpdateCrops = vi.fn();
        const { result } = renderHook(() => useCropPlotState({ crops, onUpdateCrops }));
        act(() => result.current.setWizardCropId('c_grapes'));
        render(<AddPlotWizard crop={crops[0]} profile={profile} onSave={result.current.handleAddPlot} onCancel={vi.fn()} />);
        fillStep(); next();
        fillStep(); next();
        expect(screen.getByTestId('plot-start-no-schedule')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('plot-start-earlier'));
        fireEvent.change(screen.getByTestId('plot-start-date'), { target: { value: '2026-09-01' } });
        fireEvent.click(screen.getByRole('button', { name: /profile\.finishSetup/ }));

        await waitFor(async () => expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.CreatePlot, SyncMutationName.CreateCropCycle]));
        expect((await queue())[1].payload).toMatchObject({ startDate: '2026-09-01' });
        expect(await getDatabase().scheduleSubscriptions.count()).toBe(0);
        const added = (onUpdateCrops.mock.calls[0][0] as CropProfile[])[0].plots[1];
        expect(added.schedule.templateId).toBe('');
    });
});
