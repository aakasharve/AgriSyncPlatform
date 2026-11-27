// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P7; R2-A item 14 "या प्लॉटला पाण्याची सोय कशी केली आहे?"; founder A9.2 many to
 * many; CTO Q4) - the plot's water:
 *   - add plot, step 3, asks it from the farm's OWN sources and their motors (one or more) and the method ठिबक / पाट पाणी / तुषार / पाण्याची सोय नाही;
 *   - no source yet: "आधी पाण्याचा स्रोत जोडा" with a door to पाणी आणि वीज - and the plot is STILL saved (it shows बाकी: nothing is sent for its water);
 *   - "पाण्याची सोय नाही" takes no link (the server refuses `none` with links);
 *   - the plot goes first (`create_plot`), its water after it (`farmsetup.plot_water.set`); the old `irrigationMethod: 'None'` default is not written;
 *   - the plot card shows the plot's water from the farm's set and changes it; a link whose motor is gone is never shown as a dead name.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../i18n/LanguageContext', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../i18n/LanguageContext')>()),
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr' }),
}));
vi.mock('../../../scheduler/schedulePage/usePlotScheduleChoices', () => ({ usePlotScheduleChoices: () => new Map() }));

import AddPlotWizard from '../../components/AddPlotWizard';
import StructureSection from '../../sections/StructureSection';
import { useCropPlotState } from '../../hooks/useCropPlotState';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../../infrastructure/storage/farmSetupRow';
import { SessionStore } from '../../../../infrastructure/storage/SessionStore';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { getLocalFarmSetup, type LocalFarmSetup } from '../farmSetupLocal';
import { removeWaterSource } from '../farmSetupCommands';
import { FARM_A, FARM_B, MOTOR_A1, MOTOR_A2, PLOT_A, SOURCE_A, emptyFarmDto, fullFarmDto } from '../../../../infrastructure/storage/__tests__/farmSetupFixtures';
import type { CropProfile, FarmerProfile, Plot } from '../../../../types';

const crop: CropProfile = { id: 'c_1', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', plots: [], activeScheduleId: null, supportedTasks: [], workflow: [] } as CropProfile;
const profile = { name: 'T', village: '', phone: '', language: 'mr', operators: [], waterResources: [], motors: [], machineries: [] } as unknown as FarmerProfile;

const next = () => fireEvent.click(screen.getByRole('button', { name: /profile\.nextStep/ }));
const fillStep = () => {
    for (const el of Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[]) {
        if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden') continue;
        fireEvent.change(el, { target: { value: el.type === 'number' ? '5' : 'abc' } });
    }
};
const finish = () => fireEvent.click(screen.getByRole('button', { name: /profile\.finishSetup/ }));
const local = (farmId: string) => getLocalFarmSetup(getDatabase(), farmId);
const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

function openStep3(farmSetup: LocalFarmSetup, onSave = vi.fn(), onOpenWaterPage = vi.fn()) {
    render(<AddPlotWizard crop={crop} profile={profile} onSave={onSave} onCancel={vi.fn()} farmSetup={farmSetup} onOpenWaterPage={onOpenWaterPage} />);
    fillStep(); next();
    fillStep(); next();
    fireEvent.click(screen.getByTestId('plot-start-today'));
    return { onSave, onOpenWaterPage };
}

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear(), db.appMeta.clear(), db.plots.clear()]);
    await new DexieFarmSetupRepository(db).replaceFarms([farmSetupFromDto(fullFarmDto(), 'now')!.set, farmSetupFromDto(emptyFarmDto(FARM_B), 'now')!.set]);
});
afterEach(() => cleanup());

describe('add plot, step 3: the plot\'s water (P7)', () => {
    it('no source shows the door, and the plot still saves as बाकी', async () => {
        const { onSave, onOpenWaterPage } = openStep3(await local(FARM_B));
        expect(screen.getByTestId('plot-water-question')).toHaveTextContent('या प्लॉटला पाण्याची सोय कशी केली आहे?');
        expect(screen.getByTestId('plot-water-no-source')).toHaveTextContent('आधी पाण्याचा स्रोत जोडा');
        // the door saves the plot first (his typed plot is never lost), then opens पाणी आणि वीज
        fireEvent.click(screen.getByTestId('plot-water-open-water-page'));
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onOpenWaterPage).toHaveBeenCalledTimes(1);
        expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(onOpenWaterPage.mock.invocationCallOrder[0]);
        const [plot, , water] = onSave.mock.calls[0] as [Plot, unknown, unknown];
        expect(water).toBeUndefined(); // never asked = बाकी: nothing is sent for its water
        expect(plot.infrastructure).toBeUndefined(); // the old irrigationMethod 'None' default is no longer written
    });

    it('with sources: one or more ticks and the method; "पाण्याची सोय नाही" takes no link', async () => {
        const { onSave } = openStep3(await local(FARM_A));
        fireEvent.click(screen.getByTestId(`plot-water-link-${SOURCE_A}-${MOTOR_A1}`));
        fireEvent.click(screen.getByTestId(`plot-water-link-${SOURCE_A}-${MOTOR_A2}`));
        fireEvent.click(screen.getByTestId('plot-water-method-drip'));
        finish();
        expect(onSave.mock.calls[0][2]).toEqual({ farmId: FARM_A, method: 'drip', links: [{ waterSourceId: SOURCE_A, motorId: MOTOR_A1 }, { waterSourceId: SOURCE_A, motorId: MOTOR_A2 }] });
        cleanup();
        const second = openStep3(await local(FARM_A));
        fireEvent.click(screen.getByTestId(`plot-water-link-${SOURCE_A}-${MOTOR_A1}`));
        fireEvent.click(screen.getByTestId('plot-water-method-none'));
        expect(screen.getByTestId(`plot-water-link-${SOURCE_A}-${MOTOR_A1}`)).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId(`plot-water-link-${SOURCE_A}-${MOTOR_A1}`)).toBeDisabled();
        finish();
        expect(second.onSave.mock.calls[0][2]).toEqual({ farmId: FARM_A, method: 'none', links: [] });
    });

    it('the plot is queued first, its water after it', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        const plotId = 'aaaa1111-0000-4000-8000-00000000000a';
        const crops = [{ ...crop }];
        const { result } = renderHook(() => useCropPlotState({ crops, onUpdateCrops: vi.fn() }));
        act(() => result.current.setWizardCropId('c_1'));
        const plot = { id: plotId, name: 'G9', variety: '', startDate: '2026-11-27', createdAt: 'x', baseline: { totalArea: 1, unit: 'Acre' } } as Plot;
        act(() => result.current.handleAddPlot(plot, { scheduleTemplateId: null, referenceDate: '2026-11-27' }, { farmId: FARM_A, method: 'flood', links: [{ waterSourceId: SOURCE_A, motorId: null }] }));
        await waitFor(async () => expect((await queue()).some(r => r.mutationType === SyncMutationName.FarmsetupPlotWaterSet)).toBe(true));
        const types = (await queue()).map(r => r.mutationType);
        expect(types.indexOf(SyncMutationName.CreatePlot)).toBeGreaterThanOrEqual(0);
        expect(types.indexOf(SyncMutationName.FarmsetupPlotWaterSet)).toBeGreaterThan(types.indexOf(SyncMutationName.CreatePlot));
        const water = (await queue()).find(r => r.mutationType === SyncMutationName.FarmsetupPlotWaterSet)!;
        expect(water.payload).toEqual({ farmId: FARM_A, plotId, baseRevision: 0, method: 'flood', links: [{ waterSourceId: SOURCE_A }] });
    });
});

describe('the plot card: the plot\'s water from the farm\'s set (P7)', () => {
    const G2 = 'aaaa2222-0000-4000-8000-00000000000b';
    const OTHER_FARM_PLOT = 'bbbb3333-0000-4000-8000-00000000000c';
    beforeEach(async () => {
        // the server's plots of farm A (G1, G2); the third plot the list shows belongs to farm B (the FIX-2 mix this lane must not add to)
        await getDatabase().plots.bulkPut([
            { id: PLOT_A, farmId: FARM_A, payload: {}, updatedAt: 'x' },
            { id: G2, farmId: FARM_A, payload: {}, updatedAt: 'x' },
            { id: OTHER_FARM_PLOT, farmId: FARM_B, payload: {}, updatedAt: 'x' },
        ]);
    });
    const grapes = (plots: Plot[]): CropProfile[] => [{ ...crop, plots }];
    const p = (id: string, name: string) => ({ id, name, variety: '', startDate: '2026-01-01', createdAt: 'x', baseline: { totalArea: 2, unit: 'Acre' } } as Plot);
    const renderCard = (farmSetup: LocalFarmSetup) => render(
        <StructureSection crops={grapes([p(PLOT_A, 'G1'), p(G2, 'G2'), p(OTHER_FARM_PLOT, 'B7')])} isAddingCrop={false} setIsAddingCrop={vi.fn()}
            newCropData={{}} setNewCropData={vi.fn()} cropNameError="" setCropNameError={vi.fn()} normalizeCropName={s => s} normalizedNewCropName=""
            isDuplicateCropName={false} handleAddCrop={vi.fn()} setMappingPlotId={vi.fn()} deletePlot={vi.fn()} setWizardCropId={vi.fn()} farmSetup={farmSetup} />);

    it('shows the method and its links; a plot never asked says बाकी; the link is changed from the card', async () => {
        renderCard(await local(FARM_A));
        expect(within(screen.getByTestId(`plot-${PLOT_A}`)).getByTestId(`plot-water-line-${PLOT_A}`)).toHaveTextContent('ठिबक · १ जोडणी');
        expect(screen.getByTestId(`plot-water-line-${G2}`)).toHaveTextContent('पाण्याची सोय बाकी');
        // a plot of another farm the list still shows gets no water line and no water door here
        expect(within(screen.getByTestId(`plot-${OTHER_FARM_PLOT}`)).queryByTestId(`plot-water-${OTHER_FARM_PLOT}`)).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId(`plot-water-change-${PLOT_A}`));
        fireEvent.click(screen.getByTestId('plot-water-method-flood'));
        await act(async () => { fireEvent.click(screen.getByTestId('plot-water-save')); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        expect((await queue())[0].payload).toEqual({ farmId: FARM_A, plotId: PLOT_A, baseRevision: 1, method: 'flood', links: [{ waterSourceId: SOURCE_A, motorId: MOTOR_A1 }] });
    });

    it('removing a motor leaves the plot बाकी, never a dead name', async () => {
        await removeWaterSource({ farmId: FARM_A, waterSourceId: SOURCE_A });
        renderCard(await local(FARM_A));
        expect(screen.getByTestId(`plot-water-line-${PLOT_A}`)).toHaveTextContent('ठिबक · पाण्याची सोय बाकी');
        expect(screen.getByTestId(`plot-${PLOT_A}`).textContent).not.toContain('मुख्य विहीर');
    });
});
