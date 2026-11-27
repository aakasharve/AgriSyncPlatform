// @vitest-environment jsdom
/**
 * Repair FIX-2 (founder 27 Nov) - a plot added on farm B is sent to the server on farm B: the farm in the header (FarmContext, the
 * one source since FIX-1), the same farm the crop list marks the new plot with. In the FIX-1 drive a plot added on B went under
 * farm A's crop on the phone; the farm it is queued on must never be a second, separately kept pointer.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const register = vi.hoisted(() => vi.fn(async () => 'queued'));
vi.mock('../../../sync/plots/registerNewPlotOnServer', () => ({ registerNewPlotOnServer: register }));

import { FarmContext } from '../../../../core/session/FarmContext';
import { useCropPlotState } from '../useCropPlotState';
import type { CropProfile, Plot } from '../../../../types';

const tomato: CropProfile = { id: 'crop_tomato', name: 'टोमॅटो', iconName: 'Sprout', color: 'bg-red-500', plots: [], supportedTasks: [], workflow: [] };
const b2 = { id: 'p-b2', name: 'B2', baseline: { totalArea: 1, unit: 'Acre' } } as Plot;

describe('the add-plot door sends the plot on the open farm', () => {
    it('farm B open: create_plot goes to farm B', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <FarmContext.Provider value={{ currentFarmId: 'farm-b', farms: [] } as never}>{children}</FarmContext.Provider>
        );
        const { result } = renderHook(() => useCropPlotState({ crops: [tomato], onUpdateCrops: vi.fn() }), { wrapper });
        act(() => result.current.setWizardCropId('crop_tomato'));
        act(() => result.current.handleAddPlot(b2));
        expect(register).toHaveBeenCalledWith(expect.objectContaining({ plot: b2, cropName: 'टोमॅटो', farmId: 'farm-b' }));
    });
});
