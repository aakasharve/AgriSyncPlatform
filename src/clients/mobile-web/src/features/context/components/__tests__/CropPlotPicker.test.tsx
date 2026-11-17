// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-7, founder D-150)
 *
 * The ONE crop -> plot look: crop photo tiles, then plot chips, each carrying the crop's own colour. The picker is a pure view: it
 * holds no selection, it only says what was tapped (`onPickCrop`, `onTogglePlot`), so each page keeps its own model and its rules.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CropPlotPicker, CropTile, PlotChip, PlotCount, cropColorOf, type PickerCrop, type PickerTestIds } from '../CropPlotPicker';

const GRAPE: PickerCrop = { id: 'grape', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', plots: [{ id: 'g1', name: 'सोनाका' }, { id: 'g2', name: 'थॉम्पसन' }] };
const CANE: PickerCrop = { id: 'cane', name: 'Sugarcane', iconName: 'Sugarcane', color: 'bg-pink-500', plots: [{ id: 'c1', name: 'ऊस १' }] };
const IDS: PickerTestIds = { root: 'pk', cropRow: 'pk-crops', plotRow: 'pk-plots', crop: k => `pk-crop-${k}`, plot: id => `pk-plot-${id}` };

afterEach(cleanup);

const part = (el: HTMLElement, name: string) => el.querySelector(`[data-part="${name}"]`);

describe('CropPlotPicker — tiles then coloured chips', () => {
    it('draws a photo tile per crop (name in his language, "N प्लॉट"), then a chip per plot with its crop\'s colour dot', () => {
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="all" pickedPlotIds={['g1', 'g2', 'c1']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} testIds={IDS} language="mr" />);
        // the crop's name in Marathi, never the stored English
        expect(screen.getByTestId('pk-crop-grape')).toHaveTextContent('द्राक्ष');
        expect(screen.getByTestId('pk-crop-cane')).toHaveTextContent('ऊस');
        // a tile that is not chosen says how many plots the crop has; the colour strip is the crop's own colour
        expect(screen.getByTestId('pk-crop-grape')).toHaveTextContent('2 प्लॉट');
        expect(part(screen.getByTestId('pk-crop-grape'), 'accent')?.className).toContain('bg-purple-500');
        expect(part(screen.getByTestId('pk-crop-cane'), 'accent')?.className).toContain('bg-pink-500');
        // tiles come before chips
        const tiles = screen.getByTestId('pk-crops');
        const chips = screen.getByTestId('pk-plots');
        expect(tiles.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // every plot chip carries its OWN crop's colour as a dot
        expect(part(screen.getByTestId('pk-plot-g1'), 'dot')?.className).toContain('bg-purple-500');
        expect(part(screen.getByTestId('pk-plot-g2'), 'dot')?.className).toContain('bg-purple-500');
        expect(part(screen.getByTestId('pk-plot-c1'), 'dot')?.className).toContain('bg-pink-500');
    });

    it('"all crops" tile first when asked and there is more than one crop; chosen tile is ticked and counts "N पैकी N"', () => {
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="all" pickedPlotIds={['g1', 'c1']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        const all = screen.getByTestId('pk-crop-all');
        expect(all).toHaveTextContent('सर्व पिकं');
        expect(all).toHaveAttribute('aria-pressed', 'true');
        expect(part(all, 'tick')).toBeTruthy();
        expect(all).toHaveTextContent('2 पैकी 3 प्लॉट');
        expect(part(screen.getByTestId('pk-crop-grape'), 'tick')).toBeNull();
        // the "all" tile is the first tile
        expect(screen.getByTestId('pk-crops').querySelectorAll('button')[0]).toBe(all);
    });

    it('no "all crops" tile for a single crop even when asked', () => {
        render(<CropPlotPicker crops={[GRAPE]} chosen="grape" pickedPlotIds={['g1', 'g2']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        expect(screen.queryByTestId('pk-crop-all')).toBeNull();
        expect(screen.getByTestId('pk-crop-grape')).toHaveTextContent('2 पैकी 2 प्लॉट');
    });

    it('a page that is on "all" with no "all" tile to show it (one crop) has that crop\'s tile on, with every plot counted', () => {
        render(<CropPlotPicker crops={[GRAPE]} chosen="all" pickedPlotIds={['g1', 'g2']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        expect(screen.getByTestId('pk-crop-grape')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('pk-crop-grape')).toHaveTextContent('2 पैकी 2 प्लॉट');
    });

    it('hidePlots draws the crop tiles and no chips (the schedule library asks for the crop only)', () => {
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="grape" pickedPlotIds={['g1']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} hidePlots testIds={IDS} language="mr" />);
        expect(screen.getByTestId('pk-crops')).toBeTruthy();
        expect(screen.queryByTestId('pk-plots')).toBeNull();
    });

    it('choosing a crop and a plot only reports what was tapped (the page applies its own rules)', () => {
        const onPickCrop = vi.fn();
        const onTogglePlot = vi.fn();
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="grape" pickedPlotIds={['g1']} onPickCrop={onPickCrop} onTogglePlot={onTogglePlot} testIds={IDS} language="mr" />);
        fireEvent.click(screen.getByTestId('pk-crop-cane'));
        expect(onPickCrop).toHaveBeenCalledWith('cane');
        fireEvent.click(screen.getByTestId('pk-plot-g2'));
        expect(onTogglePlot).toHaveBeenCalledWith('grape', 'g2');
        // only the chosen crop's plots show
        expect(screen.queryByTestId('pk-plot-c1')).toBeNull();
        expect(screen.getByTestId('pk-plot-g1')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('pk-plot-g2')).toHaveAttribute('aria-pressed', 'false');
        // a chosen chip is told apart without reading: a tick; a plain one has none
        expect(part(screen.getByTestId('pk-plot-g1'), 'tick')).toBeTruthy();
        expect(part(screen.getByTestId('pk-plot-g2'), 'tick')).toBeNull();
    });

    it('choiceOnly: a row is drawn only when it holds a real choice (one crop, one plot: nothing)', () => {
        const { unmount } = render(<CropPlotPicker crops={[CANE]} chosen="cane" pickedPlotIds={['c1']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} choiceOnly testIds={IDS} language="mr" />);
        expect(screen.queryByTestId('pk-crops')).toBeNull();
        expect(screen.queryByTestId('pk-plots')).toBeNull();
        unmount();
        // one crop, two plots: the chips only
        render(<CropPlotPicker crops={[GRAPE]} chosen="grape" pickedPlotIds={['g1']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} choiceOnly testIds={IDS} language="mr" />);
        expect(screen.queryByTestId('pk-crops')).toBeNull();
        expect(screen.getByTestId('pk-plots')).toBeTruthy();
    });

    it('a crop with no plot says so on its tile and draws no chips', () => {
        const EMPTY: PickerCrop = { ...CANE, id: 'onion', name: 'Onion', iconName: 'Onion', plots: [] };
        render(<CropPlotPicker crops={[GRAPE, EMPTY]} chosen="onion" pickedPlotIds={[]} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} testIds={IDS} language="mr" />);
        expect(screen.getByTestId('pk-crop-onion')).toHaveTextContent('प्लॉट नाही');
        expect(screen.queryByTestId('pk-plots')).toBeNull();
    });

    it('English twin: the words and the count read in English', () => {
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="grape" pickedPlotIds={['g1']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="en" />);
        expect(screen.getByTestId('pk-crop-all')).toHaveTextContent('All crops');
        expect(screen.getByTestId('pk-crop-grape')).toHaveTextContent('1 of 2 plots');
        expect(screen.getByTestId('pk-crop-cane')).toHaveTextContent('1 plot');
        expect(screen.getByTestId('pk-crops').textContent).not.toMatch(/[ऀ-ॿ]/);
    });

    it('question lines sit above their rows when given', () => {
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="grape" pickedPlotIds={['g1']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} cropQuestion="पीक" plotQuestion="प्लॉट" testIds={IDS} language="mr" />);
        expect(within(screen.getByTestId('pk-crops')).getByText('पीक')).toBeTruthy();
        expect(within(screen.getByTestId('pk-plots')).getByText('प्लॉट')).toBeTruthy();
    });
});

describe('the pieces', () => {
    it('cropColorOf keeps a real colour class and falls back to a quiet grey', () => {
        expect(cropColorOf('bg-teal-500')).toBe('bg-teal-500');
        expect(cropColorOf('emerald')).toBe('bg-stone-400');
        expect(cropColorOf(undefined)).toBe('bg-stone-400');
    });

    it('PlotCount: with a count it reads "N पैकी N प्लॉट", without one "N प्लॉट", none at all "प्लॉट नाही"', () => {
        const { container, rerender } = render(<PlotCount total={3} picked={1} language="mr" />);
        expect(container).toHaveTextContent('1 पैकी 3 प्लॉट');
        rerender(<PlotCount total={3} language="mr" />);
        expect(container).toHaveTextContent('3 प्लॉट');
        rerender(<PlotCount total={0} language="mr" />);
        expect(container).toHaveTextContent('प्लॉट नाही');
    });

    it('a plot chip is at least 44 px tall in both sizes; the dot is the crop\'s colour and the tick shows only when chosen', () => {
        const { rerender } = render(<PlotChip testId="chip" name="प्लॉट १" on={false} onClick={vi.fn()} color="bg-teal-500" />);
        expect(screen.getByTestId('chip').className).toContain('min-h-[44px]');
        expect(part(screen.getByTestId('chip'), 'dot')?.className).toContain('bg-teal-500');
        expect(part(screen.getByTestId('chip'), 'tick')).toBeNull();
        rerender(<PlotChip testId="chip" name="प्लॉट १" on onClick={vi.fn()} color="bg-teal-500" size="lg" />);
        expect(screen.getByTestId('chip').className).toContain('min-h-[52px]');
        expect(part(screen.getByTestId('chip'), 'tick')).toBeTruthy();
    });

    it('a crop tile wears the crop\'s colour strip, a tick when chosen, and reports its tap', () => {
        const onClick = vi.fn();
        const { rerender } = render(<CropTile testId="tile" name="द्राक्ष" on={false} onClick={onClick} photo={<span />} color="bg-purple-500" count="2 प्लॉट" />);
        fireEvent.click(screen.getByTestId('tile'));
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(part(screen.getByTestId('tile'), 'accent')?.className).toContain('bg-purple-500');
        expect(part(screen.getByTestId('tile'), 'tick')).toBeNull();
        rerender(<CropTile testId="tile" name="द्राक्ष" on onClick={onClick} photo={<span />} color="bg-purple-500" />);
        expect(part(screen.getByTestId('tile'), 'tick')).toBeTruthy();
    });
});
