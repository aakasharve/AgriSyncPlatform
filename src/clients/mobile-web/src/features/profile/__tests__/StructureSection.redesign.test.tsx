// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5) — the redesigned "पिकं आणि प्लॉट" page
 * keeps every real control on the same props: add a crop (with the duplicate check), the schedule
 * library, draw / redraw a plot boundary, remove a plot (now asks first), add a plot (the wizard).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StructureSection from '../sections/StructureSection';
import type { CropProfile, Plot } from '../../../domain/types/farm.types';

const plot = (id: string, over: Partial<Plot> = {}): Plot => ({
    id, name: `प्लॉट ${id}`, variety: '', startDate: '2026-01-01', createdAt: '2026-01-01',
    baseline: { totalArea: 2, unit: 'Acre' },
    ...over,
} as Plot);

const crops: CropProfile[] = [{
    id: 'c1', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', activeScheduleId: null,
    supportedTasks: ['General'], workflow: [], createdAt: '2026-01-01',
    plots: [
        plot('p1', { infrastructure: { irrigationMethod: 'Drip', linkedMachineryIds: [] } }),
        plot('p2', { geoData: { calculatedAreaAcres: 1.5 } as Plot['geoData'], baseline: { totalArea: 10, unit: 'Guntha' } }),
    ],
} as CropProfile];

const props = (over: Partial<React.ComponentProps<typeof StructureSection>> = {}): React.ComponentProps<typeof StructureSection> => ({
    crops,
    isAddingCrop: false, setIsAddingCrop: vi.fn(),
    newCropData: {}, setNewCropData: vi.fn(),
    cropNameError: '', setCropNameError: vi.fn(),
    normalizeCropName: (n: string) => n.trim().toLowerCase(),
    normalizedNewCropName: '', isDuplicateCropName: false,
    handleAddCrop: vi.fn(), setMappingPlotId: vi.fn(), deletePlot: vi.fn(), setWizardCropId: vi.fn(),
    onOpenScheduleLibrary: vi.fn(),
    ...over,
});

describe('StructureSection (redesigned)', () => {
    afterEach(() => cleanup());

    it('opens the add-crop form: the crop is chosen from the crop master, then saved through handleAddCrop', () => {
        const p = props();
        const { rerender } = render(<StructureSection {...p} />);
        fireEvent.click(screen.getByTestId('crop-add'));
        expect(p.setIsAddingCrop).toHaveBeenCalledWith(true);
        // spec I18 — the picker: found by its Marathi name, stored by its English name with its MHCR id.
        const adding = props({ isAddingCrop: true });
        rerender(<StructureSection {...adding} />);
        fireEvent.change(screen.getByTestId('crop-search'), { target: { value: 'ऊस' } });
        fireEvent.click(screen.getByTestId('crop-result-MHCR-0045'));
        expect(adding.setNewCropData).toHaveBeenCalledWith({ name: 'Sugarcane', masterId: 'MHCR-0045' });
        const chosen = props({ isAddingCrop: true, newCropData: { name: 'Sugarcane', masterId: 'MHCR-0045' }, normalizedNewCropName: 'sugarcane' });
        rerender(<StructureSection {...chosen} />);
        expect(screen.getByTestId('crop-chosen-name')).toHaveTextContent('ऊस');
        fireEvent.click(screen.getByTestId('crop-save'));
        expect(chosen.handleAddCrop).toHaveBeenCalledTimes(1);
    });

    it('a crop already on the farm cannot be chosen again; a crop the list lacks can be added as typed', () => {
        const p = props({ isAddingCrop: true });
        render(<StructureSection {...p} />);
        fireEvent.change(screen.getByTestId('crop-search'), { target: { value: 'grape' } });
        expect(screen.getByTestId('crop-result-MHCR-0116')).toBeDisabled(); // "Grapes" is on the farm
        fireEvent.change(screen.getByTestId('crop-search'), { target: { value: 'माझं खास पीक' } });
        fireEvent.click(screen.getByTestId('crop-add-typed'));
        expect(p.setNewCropData).toHaveBeenCalledWith({ name: 'माझं खास पीक', masterId: undefined });
    });

    it('the stored crop name is shown in Marathi and never rewritten', () => {
        const before = JSON.stringify(crops);
        render(<StructureSection {...props()} />);
        expect(screen.getByTestId('crop-name-c1')).toHaveTextContent('द्राक्ष');
        expect(screen.queryByText('Grapes')).toBeNull();
        expect(JSON.stringify(crops)).toBe(before);
    });

    it('a duplicate crop name shows a Marathi reason and cannot be saved', () => {
        const p = props({ isAddingCrop: true, newCropData: { name: 'grapes' }, normalizedNewCropName: 'grapes', isDuplicateCropName: true, cropNameError: 'This crop already exists. One crop can be added only once.' });
        render(<StructureSection {...p} />);
        expect(screen.getByTestId('crop-name-error')).toHaveTextContent('हे पीक आधीच जोडलेलं आहे');
        expect(screen.getByTestId('crop-save')).toBeDisabled();
        fireEvent.click(screen.getByTestId('crop-cancel'));
        expect(p.setIsAddingCrop).toHaveBeenCalledWith(false);
    });

    it('no schedule yet → "आता निवडा" opens the schedule library for that crop', () => {
        const p = props();
        render(<StructureSection {...p} />);
        expect(screen.getByTestId('schedule-missing-c1')).toHaveTextContent('अजून वेळापत्रक निवडलेलं नाही');
        fireEvent.click(screen.getByTestId('schedule-open-c1'));
        expect(p.onOpenScheduleLibrary).toHaveBeenCalledWith('c1');
    });

    it('shows each plot in plain words; draw and redraw the boundary are visible buttons', () => {
        const p = props();
        render(<StructureSection {...p} />);
        expect(screen.getByTestId('plot-p1')).toHaveTextContent('2 एकर');
        expect(screen.getByTestId('plot-p1')).toHaveTextContent('ठिबक');
        expect(screen.getByTestId('plot-p2')).toHaveTextContent('10 गुंठे');
        expect(screen.getByTestId('plot-p2')).toHaveTextContent('नकाशावर आखलेला');
        expect(screen.getByTestId('plot-map-p1')).toHaveTextContent('नकाशावर हद्द आखा');
        expect(screen.getByTestId('plot-map-p2')).toHaveTextContent('हद्द पुन्हा आखा');
        fireEvent.click(screen.getByTestId('plot-map-p2'));
        expect(p.setMappingPlotId).toHaveBeenCalledWith({ cropId: 'c1', plotId: 'p2' });
    });

    it('removing a plot asks first, then calls deletePlot', () => {
        const p = props();
        render(<StructureSection {...p} />);
        fireEvent.click(screen.getByTestId('plot-remove-p1'));
        expect(p.deletePlot).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('plot-remove-yes-p1'));
        expect(p.deletePlot).toHaveBeenCalledWith('c1', 'p1');
    });

    it('"या पिकात प्लॉट जोडा" opens the plot wizard for that crop', () => {
        const p = props();
        render(<StructureSection {...p} />);
        fireEvent.click(screen.getByTestId('plot-add-c1'));
        expect(p.setWizardCropId).toHaveBeenCalledWith('c1');
    });

    it('with no crops it says so plainly', () => {
        render(<StructureSection {...props({ crops: [] })} />);
        expect(screen.getByTestId('crops-empty')).toHaveTextContent('अजून पीक जोडलेलं नाही');
    });
});
