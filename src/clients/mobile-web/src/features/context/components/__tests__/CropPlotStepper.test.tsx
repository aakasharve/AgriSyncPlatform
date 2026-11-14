// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CropSelector layout="stepper" (PLR-D5): crop photos first, then the plots, several crops
 * and selective plots allowed, the footer (mic) only once something is chosen. The default
 * layout is untouched (covered by the existing CropSelector tests).
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CropSelector from '../CropSelector';
import type { CropProfile } from '../../../../types';

const crop = (id: string, name: string, iconName: string, plots: string[]) =>
    ({ id, name, iconName, color: 'emerald', plots: plots.map((n, i) => ({ id: `${id}-${i + 1}`, name: n })) }) as unknown as CropProfile;
const CROPS = [crop('cane', 'ऊस', 'Sugarcane', ['ऊस १', 'ऊस २']), crop('grape', 'द्राक्ष', 'Grape', ['सोनाका', 'थॉम्पसन']), crop('guava', 'पेरू', 'Guava', ['पेरू १'])];

afterEach(cleanup);

const Harness: React.FC<{ onChange?: (c: string[], p: Record<string, string[]>) => void }> = ({ onChange }) => {
    const [crops, setCrops] = useState<string[]>([]);
    const [plots, setPlots] = useState<Record<string, string[]>>({});
    return (
        <CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={crops} selectedPlots={plots}
            onSelectionChange={(c, p) => { setCrops(c); setPlots(p); onChange?.(c, p); }}
            stepper={{ lead: ({ step, cropNames }) => <div data-testid="the-lead" data-step={step} data-names={cropNames.join(',')} />, footer: ({ dense }) => <div data-testid="the-mic" data-dense={dense ? 'yes' : 'no'} />, labels: { allCrops: 'ALL-CROPS', allPlots: 'ALL-PLOTS', selectedCrop: 'CHOSEN-CROP', addCrop: 'ADD-CROP' } }} />
    );
};

describe('CropSelector layout="stepper"', () => {
    it('step 1 asks only the crop question: the lead, a photo tile per crop (with its plots), the whole farm; no plots, no mic', () => {
        render(<Harness />);
        expect(screen.getByTestId('the-lead').getAttribute('data-step')).toBe('crop');
        expect(screen.getByTestId('flow-crop-cane').textContent).toContain('ऊस');
        expect(screen.getByTestId('flow-crop-cane').textContent).toContain('ऊस १ · ऊस २');
        expect(screen.getByTestId('flow-crop-cane').querySelector('img')?.getAttribute('src')).toBe('/images/crops/Sugarcane.jpg');
        expect(screen.getByTestId('flow-crop-whole-farm').textContent).toContain('Entire Farm');
        expect(screen.queryByTestId('flow-plot-cane-1')).toBeNull();
        expect(screen.queryByTestId('the-mic')).toBeNull();
    });

    it('one crop: its plots only; the mic appears the moment a plot is chosen; several plots allowed', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        expect(screen.getByTestId('flow-step-plot')).toBeTruthy();
        // the lead (Sathi) is on the plot step too, and knows which crop(s) were chosen
        expect(screen.getByTestId('the-lead').getAttribute('data-step')).toBe('plot');
        expect(screen.getByTestId('the-lead').getAttribute('data-names')).toBe('ऊस');
        expect(screen.getByTestId('flow-plot-cane-1')).toBeTruthy();
        expect(screen.queryByTestId('flow-plot-grape-1')).toBeNull();
        expect(screen.queryByTestId('the-mic')).toBeNull();
        fireEvent.click(screen.getByTestId('flow-plot-cane-2'));
        expect(screen.getByTestId('the-mic').getAttribute('data-dense')).toBe('no');
        fireEvent.click(screen.getByTestId('flow-plot-cane-1'));
        expect(screen.getByTestId('flow-plot-cane-1').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('flow-plot-cane-2').getAttribute('aria-pressed')).toBe('true');
    });

    it('two crops out of three with only the plots he worked: add the second crop on the plot step, tick specific plots across crops', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-plot-cane-2'));
        fireEvent.click(screen.getByTestId('flow-add-open'));
        fireEvent.click(screen.getByTestId('flow-add-grape'));
        // the plots of BOTH chosen crops show, the third crop's do not
        expect(screen.getByTestId('flow-plot-grape-1')).toBeTruthy();
        expect(screen.queryByTestId('flow-plot-guava-1')).toBeNull();
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        expect(onChange).toHaveBeenLastCalledWith(['cane', 'grape'], { cane: ['cane-2'], grape: ['grape-1'] });
        expect(screen.getByTestId('flow-plot-cane-1').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('flow-plot-grape-2').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('the-lead').getAttribute('data-names')).toBe('ऊस,द्राक्ष');
        expect(screen.getByTestId('the-mic').getAttribute('data-dense')).toBe('yes');
        // tapping a chosen crop's tile removes it and its plots
        fireEvent.click(screen.getByTestId('flow-sel-grape'));
        expect(onChange).toHaveBeenLastCalledWith(['cane'], { cane: ['cane-2'] });
    });

    it('"all" shortcuts select every crop / every plot of the chosen crops, only when their labels are supplied', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        // with ONE crop there is no "all plots" button (founder 2026-10-24): he just taps the plots
        expect(screen.queryByTestId('flow-plots-all')).toBeNull();
        // once he adds a second crop with "+", "all plots" appears and takes the plots of every chosen crop
        fireEvent.click(screen.getByTestId('flow-add-open'));
        fireEvent.click(screen.getByTestId('flow-add-grape'));
        fireEvent.click(screen.getByTestId('flow-plots-all'));
        expect(onChange).toHaveBeenLastCalledWith(['cane', 'grape'], { cane: ['cane-1', 'cane-2'], grape: ['grape-1', 'grape-2'] });
        expect(screen.queryByTestId('flow-plots-all')).toBeNull();
        fireEvent.click(screen.getByTestId('flow-add-all'));
        expect(onChange).toHaveBeenLastCalledWith(['cane', 'grape', 'guava'], { cane: ['cane-1', 'cane-2'], grape: ['grape-1', 'grape-2'], guava: ['guava-1'] });
    });

    it('a crop with a single plot has it chosen for him (the mic shows at once)', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-guava'));
        expect(screen.getByTestId('flow-plot-guava-1').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('the-mic')).toBeTruthy();
    });

    it('the whole farm needs no plot: the mic shows at once', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-whole-farm'));
        expect(screen.getByTestId('the-mic')).toBeTruthy();
        expect(screen.queryByTestId('flow-plot-cane-1')).toBeNull();
    });

    it('back is one big labelled step that clears the choice and returns to the crop question', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        const back = screen.getByTestId('flow-back');
        expect(back.textContent).toContain('मागे');
        expect(back.className).toContain('h-[76px]'); // big, labelled, a 64px-wide target
        fireEvent.click(back);
        expect(onChange).toHaveBeenLastCalledWith([], {});
        expect(screen.getByTestId('flow-step-crop')).toBeTruthy();
    });

    it('removing the last chosen crop returns to the crop question', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-sel-cane'));
        expect(screen.getByTestId('flow-step-crop')).toBeTruthy();
    });

    it('on the plot step Sathi sits BELOW the chosen-crop card and ABOVE the plots; the card names the crop', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        const strip = screen.getByTestId('flow-strip');
        const lead = screen.getByTestId('the-lead');
        const plot = screen.getByTestId('flow-plot-cane-1');
        // DOCUMENT_POSITION_FOLLOWING (4): the second node comes after the first
        expect(strip.compareDocumentPosition(lead) & 4).toBeTruthy();
        expect(lead.compareDocumentPosition(plot) & 4).toBeTruthy();
        // the card says what was chosen, in words and in the crop's own name
        const card = screen.getByTestId('flow-sel-cane');
        expect(card.textContent).toContain('CHOSEN-CROP');
        expect(card.textContent).toContain('ऊस');
        expect(card.className).toContain('from-emerald-700');
    });

    it('another crop is added from a tray behind one "+", not squeezed into the strip', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        expect(screen.queryByTestId('flow-add-grape')).toBeNull();
        fireEvent.click(screen.getByTestId('flow-add-open'));
        expect(screen.getByTestId('flow-add-tray')).toBeTruthy();
        fireEvent.click(screen.getByTestId('flow-add-grape'));
        expect(screen.queryByTestId('flow-add-tray')).toBeNull();
        expect(screen.getByTestId('flow-sel-grape')).toBeTruthy();
    });

    it('"entire farm" is a PICTURE card with one short line; with no words from the caller it falls back to the approved hint', () => {
        render(<Harness />);
        const tile = screen.getByTestId('flow-crop-whole-farm');
        expect(tile.querySelector('img')?.getAttribute('src')).toBe('/images/farm/entire-farm.svg');
        expect(screen.getByTestId('flow-crop-whole-farm-sub').textContent).toContain('Choose this when');
        fireEvent.click(tile);
        expect(screen.getByTestId('flow-step-plot')).toBeTruthy();
        expect(screen.getByTestId('flow-crop-chip').querySelector('img')?.getAttribute('src')).toBe('/images/farm/entire-farm.svg');
        expect(screen.getByTestId('the-mic')).toBeTruthy();
    });

    it('the "+" for another crop is a labelled button of its own', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        const plus = screen.getByTestId('flow-add-open');
        expect(plus.textContent).toContain('ADD-CROP');
        expect(plus.className).toContain('w-[70px]');
        expect(plus.className).toContain('ml-1');
    });

    it('the footer (the mic) stays in the page flow: it never floats or sticks over the choices', () => {
        render(
            <CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={['guava']} selectedPlots={{ guava: ['guava-1'] }} onSelectionChange={() => {}}
                stepper={{ footer: <div data-testid="the-mic" /> }} />,
        );
        const slot = screen.getByTestId('flow-mic-slot');
        expect(slot.className).not.toMatch(/\b(sticky|fixed|absolute)\b/);
        expect(slot.style.bottom).toBe('');
        expect(slot.className).not.toContain('backdrop'); // no see-through panel laid over other things
        expect(screen.getByTestId('the-mic').parentElement).toBe(slot);
    });

    it('lane CMP-T: hideEntireFarm leaves the "संपूर्ण शेत" card out of the crop step; by default it is there', () => {
        const { unmount } = render(
            <CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={[]} selectedPlots={{}} onSelectionChange={() => {}} stepper={{ hideEntireFarm: true }} />,
        );
        expect(screen.queryByTestId('flow-crop-whole-farm')).toBeNull();
        expect(screen.getByTestId('flow-crop-cane')).toBeTruthy();
        unmount();
        render(<CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={[]} selectedPlots={{}} onSelectionChange={() => {}} />);
        expect(screen.getByTestId('flow-crop-whole-farm')).toBeTruthy();
    });

    it('lane CMP-T: hideAddCrop leaves the "+" for another crop out of the plot step; by default it is there', () => {
        const { unmount } = render(
            <CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={['cane']} selectedPlots={{ cane: [] }} onSelectionChange={() => {}} stepper={{ hideAddCrop: true }} />,
        );
        expect(screen.getByTestId('flow-step-plot')).toBeTruthy();
        expect(screen.queryByTestId('flow-add-open')).toBeNull();
        unmount();
        render(<CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={['cane']} selectedPlots={{ cane: [] }} onSelectionChange={() => {}} />);
        expect(screen.getByTestId('flow-add-open')).toBeTruthy();
    });

    it('lane CMP-T fix round: a crop chosen but with no plot yet wears an amber ring by default (the log page, unchanged) and an emerald one with calmRings', () => {
        const { unmount } = render(<CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={['cane']} selectedPlots={{ cane: [] }} onSelectionChange={() => {}} />);
        expect(screen.getByTestId('flow-sel-cane').className).toContain('ring-amber-300');
        unmount();
        render(<CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={['cane']} selectedPlots={{ cane: [] }} onSelectionChange={() => {}} stepper={{ calmRings: true }} />);
        expect(screen.getByTestId('flow-sel-cane').className).not.toContain('amber');
        expect(screen.getByTestId('flow-sel-cane').className).toContain('ring-emerald-300');
    });
});
