// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane WIZARD-F2; founder pick F2, 2026-11-19)
 *
 * Adding a plot used to OVERWRITE the schedule of every plot the crop already had with the wizard's pick (and cleared their stage and task
 * edits). Now only the NEW plot gets a schedule: existing plots keep theirs, and the crop's own legacy `activeScheduleId` is not rewritten
 * (it outranks a plot's own schedule on the schedule page, so rewriting it would move every plot). The checked schedule is sent to the server
 * with the new plot, never a stand-in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const register = vi.hoisted(() => vi.fn(async () => 'queued'));
vi.mock('../../../sync/plots/registerNewPlotOnServer', () => ({ registerNewPlotOnServer: register }));

import { useCropPlotState } from '../useCropPlotState';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE } from '../../../scheduler/schedulePage/__tests__/scheduleFixtures';
import type { CropProfile, Plot } from '../../../../types';

const CHECKED = '10000000-0000-4000-8000-000000000003';
const OLD_TEMPLATE = '10000000-0000-4000-8000-0000000000aa';

const plot = (id: string, over: Partial<Plot> = {}): Plot => ({
    id,
    name: `प्लॉट ${id}`,
    startDate: '2026-01-10',
    baseline: { totalArea: 1, unit: 'Acre' },
    schedule: {
        id: `sch_${id}`, plotId: id, templateId: OLD_TEMPLATE, referenceType: 'PRUNING', referenceDate: '2026-01-10',
        stageOverrides: [{ stageId: 's1', customDays: 3 } as never],
        expectationOverrides: [{ expectationId: 'e1', customFrequencyValue: 2 } as never],
    },
    ...over,
} as Plot);

const grapes = (): CropProfile => ({
    id: 'c_grapes', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500',
    plots: [plot('p1'), plot('p2', { schedule: { ...plot('p2').schedule, templateId: '10000000-0000-4000-8000-0000000000bb', referenceDate: '2026-05-01' } })],
    activeScheduleId: OLD_TEMPLATE, supportedTasks: [], workflow: [],
});
const onions = (): CropProfile => ({
    id: 'c_onion', name: 'Onion', iconName: 'Sprout', color: 'bg-red-500', plots: [plot('o1')], activeScheduleId: null, supportedTasks: [], workflow: [],
});

const newPlot = (): Plot => plot('p3', {
    startDate: '2026-10-12',
    schedule: { id: 'sch_p3', plotId: 'p3', templateId: CHECKED, referenceType: 'PRUNING', referenceDate: '2026-10-12', stageOverrides: [], expectationOverrides: [] },
});

function addPlot(crops: CropProfile[], start: { scheduleTemplateId: string | null; referenceDate: string }, plotToAdd: Plot = newPlot()) {
    const onUpdateCrops = vi.fn();
    const { result } = renderHook(() => useCropPlotState({ crops, onUpdateCrops }));
    act(() => result.current.setWizardCropId('c_grapes'));
    act(() => result.current.handleAddPlot(plotToAdd, start));
    return { onUpdateCrops, result };
}

describe('adding a plot touches only the new plot', () => {
    beforeEach(() => {
        register.mockClear();
        // The checked schedule is in the phone's catalog, so the OLD code (which copied the wizard's pick onto every plot of the crop) would act.
        setScheduleTemplatesFromReferenceData([{ ...SERVER_TEMPLATE, id: CHECKED, name: 'Grapes - Expert Schedule', versionHash: 'h', ownerType: 'EXPERT', hasStoredDays: true, check: { state: 'Checked', checkerDisplayName: 'x', checkedAtUtc: '2026-11-08T05:00:00Z', note: null } }]);
    });

    it('the plots the crop already has keep their own schedule, day 0 and stage and task edits - exactly as they were', () => {
        const before = grapes();
        const { onUpdateCrops } = addPlot([before], { scheduleTemplateId: CHECKED, referenceDate: '2026-10-12' });
        const next = onUpdateCrops.mock.calls[0][0] as CropProfile[];
        const crop = next.find(c => c.id === 'c_grapes')!;
        expect(crop.plots.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
        expect(crop.plots[0]).toEqual(grapes().plots[0]);
        expect(crop.plots[1]).toEqual(grapes().plots[1]);
        expect(crop.plots[0].schedule.templateId).toBe(OLD_TEMPLATE);
        expect(crop.plots[0].schedule.stageOverrides).toHaveLength(1);
        expect(crop.plots[0].schedule.expectationOverrides).toHaveLength(1);
    });

    it('the new plot is added as the wizard built it, with the chosen day and the checked schedule', () => {
        const { onUpdateCrops } = addPlot([grapes()], { scheduleTemplateId: CHECKED, referenceDate: '2026-10-12' });
        const added = (onUpdateCrops.mock.calls[0][0] as CropProfile[]).find(c => c.id === 'c_grapes')!.plots[2];
        expect(added).toEqual(newPlot());
        expect(added.startDate).toBe('2026-10-12');
        expect(added.schedule.templateId).toBe(CHECKED);
        expect(added.schedule.referenceDate).toBe('2026-10-12');
    });

    it('the crop\'s own legacy schedule is not rewritten (it would move every plot), and other crops are untouched', () => {
        const { onUpdateCrops } = addPlot([grapes(), onions()], { scheduleTemplateId: CHECKED, referenceDate: '2026-10-12' });
        const next = onUpdateCrops.mock.calls[0][0] as CropProfile[];
        expect(next.find(c => c.id === 'c_grapes')!.activeScheduleId).toBe(OLD_TEMPLATE);
        expect(next.find(c => c.id === 'c_onion')).toEqual(onions());
    });

    it('sends the new plot to the server WITH its checked schedule and the chosen day, and says nothing about any other plot', () => {
        addPlot([grapes()], { scheduleTemplateId: CHECKED, referenceDate: '2026-10-12' });
        expect(register).toHaveBeenCalledTimes(1);
        expect(register).toHaveBeenCalledWith({ plot: newPlot(), cropName: 'Grapes', schedule: { templateId: CHECKED, referenceDate: '2026-10-12' } });
    });

    it('a crop with no checked schedule sends the plot with NO schedule (never a stand-in)', () => {
        const noSchedule = plot('p3', { startDate: '2026-10-12', schedule: { ...newPlot().schedule, templateId: '' } });
        addPlot([grapes()], { scheduleTemplateId: null, referenceDate: '2026-10-12' }, noSchedule);
        expect(register).toHaveBeenCalledWith({ plot: noSchedule, cropName: 'Grapes', schedule: null });
    });

    it('closes the wizard', () => {
        const { result } = addPlot([grapes()], { scheduleTemplateId: CHECKED, referenceDate: '2026-10-12' });
        expect(result.current.wizardCropId).toBeNull();
    });
});
