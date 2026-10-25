// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chosen vs not chosen, told apart WITHOUT reading (PLR-D5): green + ring + tick versus
 * grey + dashed + an empty ring, on plots and on crops.
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CropSelector from '../CropSelector';
import type { CropProfile } from '../../../../types';

const crop = (id: string, name: string, iconName: string, plots: string[]) =>
    ({ id, name, iconName, color: 'emerald', plots: plots.map((n, i) => ({ id: `${id}-${i + 1}`, name: n })) }) as unknown as CropProfile;
const CROPS = [crop('cane', 'ऊस', 'Sugarcane', ['ऊस १', 'ऊस २']), crop('grape', 'द्राक्ष', 'Grape', ['सोनाका', 'थॉम्पसन'])];

afterEach(cleanup);

const Harness: React.FC = () => {
    const [crops, setCrops] = useState<string[]>([]);
    const [plots, setPlots] = useState<Record<string, string[]>>({});
    return <CropSelector mode="log" layout="stepper" crops={CROPS} selectedCrops={crops} selectedPlots={plots} onSelectionChange={(c, p) => { setCrops(c); setPlots(p); }} />;
};

describe('chosen and not chosen without reading', () => {
    it('plots: chosen = green + ring + tick; not chosen = grey + dashed + empty ring', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        fireEvent.click(screen.getByTestId('flow-plot-cane-2'));
        const on = screen.getByTestId('flow-plot-cane-2');
        const off = screen.getByTestId('flow-plot-cane-1');
        expect(on.className).toContain('from-emerald-700');
        expect(on.className).toContain('ring-emerald-300');
        expect(on.querySelector('svg')).toBeTruthy();
        expect(off.className).toContain('border-dashed');
        expect(off.className).toContain('bg-stone-100');
        expect(off.querySelector('svg')).toBeNull();
    });

    it('crops: a chosen crop is a solid green card with a tick; crops not chosen wait behind a dashed + button', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('flow-crop-cane'));
        // a crop with no plot ticked yet is amber and dashed: it still needs one
        expect(screen.getByTestId('flow-sel-cane').className).toContain('ring-amber-300');
        fireEvent.click(screen.getByTestId('flow-plot-cane-1'));
        expect(screen.getByTestId('flow-sel-cane').className).toContain('ring-emerald-300');
        expect(screen.getByTestId('flow-sel-cane').querySelector('svg')).toBeTruthy();
        // the crops not chosen wait behind one dashed, green "+" button
        expect(screen.getByTestId('flow-add-open').className).toContain('border-dashed');
        expect(screen.getByTestId('flow-add-open').className).toContain('bg-emerald-50');
    });
});
