// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-7, founder D-150)
 *
 * The log flow's crop -> plot questions (and PlanForm, the task-done sheet, the place picker, which all draw this stepper) in the
 * SHARED look: crop photo tiles, then plot chips, each in the crop's own colour. What did not change, and is pinned here: the stepper
 * still asks ONE question at a time (the crop, then the plots), a tap reports exactly the same selection shapes as before, every test
 * id is the same, and the page that sets compare's own flags keeps the classic look until its own lane.
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CropSelector from '../CropSelector';
import type { StepperExtras } from '../CropPlotStepper';
import type { CropProfile } from '../../../../types';

const crop = (id: string, name: string, iconName: string, color: string, plots: string[]) =>
    ({ id, name, iconName, color, plots: plots.map((n, i) => ({ id: `${id}-${i + 1}`, name: n })) }) as unknown as CropProfile;
const CROPS = [crop('cane', 'ऊस', 'Sugarcane', 'bg-pink-500', ['ऊस १', 'ऊस २']), crop('grape', 'द्राक्ष', 'Grape', 'bg-purple-500', ['सोनाका', 'थॉम्पसन'])];

afterEach(cleanup);

const Harness: React.FC<{ onChange?: (c: string[], p: Record<string, string[]>) => void; stepper?: StepperExtras }> = ({ onChange, stepper }) => {
    const [crops, setCrops] = useState<string[]>([]);
    const [plots, setPlots] = useState<Record<string, string[]>>({});
    return (
        <CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={crops} selectedPlots={plots}
            onSelectionChange={(c, p) => { setCrops(c); setPlots(p); onChange?.(c, p); }}
            stepper={{ lead: ({ step }) => <div data-testid="the-lead" data-step={step} />, footer: <div data-testid="the-mic" />, labels: { selectedCrop: 'CHOSEN-CROP', addCrop: 'ADD' }, ...stepper }} />
    );
};
const part = (el: HTMLElement, name: string) => el.querySelector(`[data-part="${name}"]`);

describe('the stepper in the shared look', () => {
    it('step 1 asks only the crop: a photo tile per crop in its own colour, then "संपूर्ण शेत"; no plot chips, no mic', () => {
        render(<Harness />);
        expect(screen.getByTestId('the-lead').getAttribute('data-step')).toBe('crop');
        expect(screen.getByTestId('flow-crop-cane')).toHaveTextContent('ऊस');
        expect(screen.getByTestId('flow-crop-cane')).toHaveTextContent('2 प्लॉट');
        expect(part(screen.getByTestId('flow-crop-cane'), 'accent')?.className).toContain('bg-pink-500');
        expect(part(screen.getByTestId('flow-crop-grape'), 'accent')?.className).toContain('bg-purple-500');
        expect(screen.getByTestId('flow-crop-cane').querySelector('img')?.getAttribute('src')).toBe('/images/crops/Sugarcane.jpg');
        expect(screen.getByTestId('flow-crop-whole-farm')).toHaveTextContent('Entire Farm');
        expect(screen.queryByTestId('flow-plot-cane-1')).toBeNull();
        expect(screen.queryByTestId('the-mic')).toBeNull();
        // a tile is not a "big card": it carries none of the old card's parts
        expect(screen.queryByTestId('flow-crop-cane-panel')).toBeNull();
    });

    it('the order of the questions is unchanged: crop first, then that crop\'s plots only, the mic once a plot is chosen', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        expect(screen.getByTestId('the-lead').getAttribute('data-step')).toBe('plot');
        expect(screen.getByTestId('flow-step-plot')).toBeTruthy();
        expect(screen.queryByTestId('flow-step-crop')).toBeNull();
        expect(screen.getByTestId('flow-plot-cane-1')).toBeTruthy();
        expect(screen.queryByTestId('flow-plot-grape-1')).toBeNull(); // the other crop's plots are not asked
        expect(screen.queryByTestId('the-mic')).toBeNull();
        fireEvent.click(screen.getByTestId('flow-plot-cane-2'));
        expect(screen.getByTestId('the-mic')).toBeTruthy();
        // back is still one step to the crop question
        fireEvent.click(screen.getByTestId('flow-back'));
        expect(screen.getByTestId('flow-step-crop')).toBeTruthy();
        expect(screen.getByTestId('the-lead').getAttribute('data-step')).toBe('crop');
    });

    it('a tap reports the same selection shapes as before (crops, plots by crop)', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        expect(onChange).toHaveBeenLastCalledWith(['cane'], { cane: [] });
        fireEvent.click(screen.getByTestId('flow-plot-cane-2'));
        expect(onChange).toHaveBeenLastCalledWith(['cane'], { cane: ['cane-2'] });
        fireEvent.click(screen.getByTestId('flow-add-open'));
        fireEvent.click(screen.getByTestId('flow-add-grape'));
        fireEvent.click(screen.getByTestId('flow-plot-grape-1'));
        expect(onChange).toHaveBeenLastCalledWith(['cane', 'grape'], { cane: ['cane-2'], grape: ['grape-1'] });
        // tapping the chosen crop's tile removes the crop and its plots, as before
        fireEvent.click(screen.getByTestId('flow-sel-grape'));
        expect(onChange).toHaveBeenLastCalledWith(['cane'], { cane: ['cane-2'] });
    });

    it('the whole farm is still one tap and the same value', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.click(screen.getByTestId('flow-crop-whole-farm'));
        expect(onChange).toHaveBeenLastCalledWith(['FARM_GLOBAL'], {});
        expect(screen.getByTestId('the-mic')).toBeTruthy();
    });

    it('on the plot step each plot is a chip with its crop\'s colour dot (two crops on screen: each its own colour)', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        expect(part(screen.getByTestId('flow-plot-cane-1'), 'dot')?.className).toContain('bg-pink-500');
        fireEvent.click(screen.getByTestId('flow-add-open'));
        fireEvent.click(screen.getByTestId('flow-add-grape'));
        expect(part(screen.getByTestId('flow-plot-cane-1'), 'dot')?.className).toContain('bg-pink-500');
        expect(part(screen.getByTestId('flow-plot-grape-1'), 'dot')?.className).toContain('bg-purple-500');
        // the chosen crops are the same tiles, ticked, in their colours
        expect(part(screen.getByTestId('flow-sel-cane'), 'accent')?.className).toContain('bg-pink-500');
        expect(part(screen.getByTestId('flow-sel-grape'), 'tick')).toBeTruthy();
    });

    it('a chosen plot is told apart from a plain one without reading, and every chip is a 44 px target or more', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-plot-cane-2'));
        expect(screen.getByTestId('flow-plot-cane-2')).toHaveAttribute('aria-pressed', 'true');
        expect(part(screen.getByTestId('flow-plot-cane-2'), 'tick')).toBeTruthy();
        expect(part(screen.getByTestId('flow-plot-cane-1'), 'tick')).toBeNull();
        for (const id of ['flow-plot-cane-1', 'flow-plot-cane-2']) expect(screen.getByTestId(id).className).toMatch(/min-h-\[(4[4-9]|5\d)px\]/);
    });

    it('the chosen crop\'s tile keeps its words ("CHOSEN-CROP", "N पैकी N प्लॉट") and the amber ring while no plot is chosen', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        const card = screen.getByTestId('flow-sel-cane');
        expect(card).toHaveTextContent('CHOSEN-CROP');
        expect(card).toHaveTextContent('0 पैकी 2 प्लॉट');
        expect(card.className).toContain('ring-amber-300');
        fireEvent.click(screen.getByTestId('flow-plot-cane-1'));
        expect(screen.getByTestId('flow-sel-cane').className).toContain('ring-emerald-300');
        expect(screen.getByTestId('flow-sel-cane')).toHaveTextContent('1 पैकी 2 प्लॉट');
    });

    it('marked plots still carry their short tag, and nothing is chosen for him', () => {
        render(<Harness stepper={{ marked: { plotIds: ['cane-2'], label: 'आत्ता इथे' } }} />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        expect(screen.getByTestId('flow-plot-mark-cane-2')).toHaveTextContent('आत्ता इथे');
        expect(screen.getByTestId('flow-plot-cane-2')).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('which look: shared everywhere, classic only where it is asked for', () => {
    it('compare\'s own flags keep the classic look (the big photo card, the green plot tile) — compare is not touched in this lane', () => {
        const { unmount } = render(<Harness stepper={{ hideEntireFarm: true, hideAddCrop: true, calmRings: true }} />);
        expect(screen.getByTestId('flow-crop-cane-panel')).toBeTruthy(); // the old card's name panel
        expect(part(screen.getByTestId('flow-crop-cane'), 'accent')).toBeNull();
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        expect(screen.getByTestId('flow-sel-cane').className).toContain('from-emerald-700');
        expect(part(screen.getByTestId('flow-plot-cane-1'), 'dot')).toBeNull();
        expect(screen.getByTestId('flow-plot-cane-1').className).toContain('border-dashed');
        unmount();
    });

    it('look="classic" asks for it without the flags; look="shared" wins over the flags', () => {
        const { unmount } = render(<Harness stepper={{ look: 'classic' }} />);
        expect(screen.getByTestId('flow-crop-cane-panel')).toBeTruthy();
        unmount();
        render(<Harness stepper={{ look: 'shared', hideEntireFarm: true }} />);
        expect(screen.queryByTestId('flow-crop-cane-panel')).toBeNull();
        expect(part(screen.getByTestId('flow-crop-cane'), 'accent')).toBeTruthy();
        expect(screen.queryByTestId('flow-crop-whole-farm')).toBeNull(); // the flag still hides the farm row
    });
});
