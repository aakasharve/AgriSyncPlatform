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
import { ChosenCropStrip, CropPlotPicker, CropTile, PlotChip, PlotCount, cropColorOf, type PickerCrop, type PickerTestIds } from '../CropPlotPicker';

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
        expect(screen.getByTestId('pk-crop-grape')).toHaveTextContent('२ पैकी २ निवडले'); // Marathi digits (UI-9a); the page is on "all" with no card, so every plot counts (fix round item 4)
        expect(screen.getByTestId('pk-crop-cane')).toHaveTextContent('१ पैकी १ निवडले');
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

    it('the all-crops card (UI-9a, option C) sits above the crop cards: "सर्व पिकं", "२ पिकं · ३ प्लॉट", a tick and a green border when every crop is on', () => {
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="all" pickedPlotIds={['g1', 'c1']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        const all = screen.getByTestId('pk-crop-all');
        expect(all).toHaveTextContent('सर्व पिकं');
        expect(screen.getByTestId('pk-crop-all-line')).toHaveTextContent('२ पिकं · ३ प्लॉट');
        expect(all).toHaveAttribute('aria-pressed', 'true');
        expect(part(all, 'tick')).toBeTruthy();
        expect(all).not.toHaveTextContent('सगळी बघा');
        expect(screen.getByTestId('pk-crop-all-card')).toHaveAttribute('data-on', 'yes');
        expect(screen.getByTestId('pk-crop-all-card').className).toContain('border-emerald-700');
        // fix round item 6 (founder 2026-11-20): the card already holds a photo of every crop, so the crop cards are not drawn a second time
        expect(screen.queryByTestId('pk-crop-grape')).toBeNull();
        expect(screen.queryByTestId('pk-crop-cane')).toBeNull();
        expect(screen.getByTestId('pk-crops').querySelector('.snap-x')).toBeNull();
        expect(Array.from(screen.getByTestId('pk-crops').querySelectorAll('.snap-x button')).includes(all)).toBe(false);
    });

    it('item 6: with the all-crops card the crop cards below it are not drawn while every crop has its own photo (8 or fewer); with more crops they stay, they are then the only way to the extra crops', () => {
        const many = (n: number): PickerCrop[] => Array.from({ length: n }, (_, i) => ({ id: `k${i}`, name: `Crop${i}`, iconName: 'Grape', color: 'bg-teal-500', plots: [{ id: `k${i}p`, name: 'x' }] }));
        const { unmount } = render(<CropPlotPicker crops={many(8)} chosen="all" pickedPlotIds={[]} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        expect(screen.queryByTestId('pk-crop-k0')).toBeNull();
        for (let i = 0; i < 8; i++) expect(screen.getByTestId(`pk-crop-all-photo-k${i}`)).toBeTruthy(); // every crop is still reachable
        unmount();
        const nine = render(<CropPlotPicker crops={many(9)} chosen="all" pickedPlotIds={[]} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        expect(screen.getByTestId('pk-crop-k0')).toBeTruthy();
        expect(screen.getByTestId('pk-crop-k8')).toBeTruthy(); // the crop with no photo on the card is reached from its card
        expect(screen.getByTestId('pk-crop-all-more')).toBeTruthy();
        nine.unmount();
        // a page that does not ask for the all-crops card (the schedule maker) keeps its crop cards
        render(<CropPlotPicker crops={many(3)} chosen="k0" pickedPlotIds={[]} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} testIds={IDS} language="mr" />);
        expect(screen.getByTestId('pk-crop-k0')).toBeTruthy();
        expect(screen.getByTestId('pk-crop-k2')).toBeTruthy();
    });

    it('item 6: tapping a photo on the card is the crop pick the lower card used to be, and a chosen crop still shows its green border and tick there', () => {
        const onPickCrop = vi.fn();
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="grape" pickedPlotIds={['g1']} onPickCrop={onPickCrop} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        expect(screen.queryByTestId('pk-crop-grape')).toBeNull();
        expect(screen.getByTestId('pk-crop-all-photo-grape')).toHaveAttribute('aria-pressed', 'true');
        expect(part(screen.getByTestId('pk-crop-all-photo-grape'), 'tick')).toBeTruthy();
        fireEvent.click(screen.getByTestId('pk-crop-all-photo-cane'));
        expect(onPickCrop).toHaveBeenLastCalledWith('cane');
    });

    it('the card shows a small photo of EVERY crop, each with its own colour strip, name and plot count', () => {
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="all" pickedPlotIds={[]} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        const g = screen.getByTestId('pk-crop-all-photo-grape');
        const c = screen.getByTestId('pk-crop-all-photo-cane');
        expect(g).toHaveTextContent('द्राक्ष');
        expect(g).toHaveTextContent('२ प्लॉट');
        expect(c).toHaveTextContent('ऊस');
        expect(c).toHaveTextContent('१ प्लॉट');
        expect(part(g, 'accent')?.className).toContain('bg-purple-500');
        expect(part(c, 'accent')?.className).toContain('bg-pink-500');
        expect(g.querySelector('img, svg')).toBeTruthy();
        expect(screen.getByTestId('pk-crop-all-photos')).toHaveAttribute('data-cols', '2');
    });

    it('every photo in the card is its own button and picks that crop: the same tap as the crop\'s card', () => {
        const onPickCrop = vi.fn();
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="all" pickedPlotIds={[]} onPickCrop={onPickCrop} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        expect(screen.getByTestId('pk-crop-all-photo-cane').tagName).toBe('BUTTON');
        fireEvent.click(screen.getByTestId('pk-crop-all-photo-cane'));
        expect(onPickCrop).toHaveBeenLastCalledWith('cane');
        fireEvent.click(screen.getByTestId('pk-crop-all-photo-grape'));
        expect(onPickCrop).toHaveBeenLastCalledWith('grape');
    });

    it('with one crop chosen the card loses its tick and border and says "सगळी बघा"; one tap goes back to every crop', () => {
        const onPickCrop = vi.fn();
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="grape" pickedPlotIds={['g1']} onPickCrop={onPickCrop} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        const all = screen.getByTestId('pk-crop-all');
        expect(all).toHaveAttribute('aria-pressed', 'false');
        expect(part(all, 'tick')).toBeNull();
        expect(all).toHaveTextContent('सगळी बघा');
        expect(screen.getByTestId('pk-crop-all-card')).toHaveAttribute('data-on', 'no');
        expect(screen.getByTestId('pk-crop-all-card').className).not.toContain('border-emerald-700');
        // the chosen crop's photo inside the card carries the green border and the tick
        expect(screen.getByTestId('pk-crop-all-photo-grape')).toHaveAttribute('aria-pressed', 'true');
        expect(part(screen.getByTestId('pk-crop-all-photo-grape'), 'tick')).toBeTruthy();
        expect(screen.getByTestId('pk-crop-all-photo-grape').className).toContain('border-emerald-700');
        expect(part(screen.getByTestId('pk-crop-all-photo-cane'), 'tick')).toBeNull();
        fireEvent.click(all);
        expect(onPickCrop).toHaveBeenLastCalledWith('all');
    });

    it('more than 8 crops: 7 photos and a "+N पिकं" tile that is not a button; up to 8 every crop has its photo', () => {
        const many = (n: number): PickerCrop[] => Array.from({ length: n }, (_, i) => ({ id: `k${i}`, name: `Crop${i}`, iconName: 'Grape', color: 'bg-teal-500', plots: [{ id: `k${i}p`, name: 'x' }] }));
        const { unmount } = render(<CropPlotPicker crops={many(8)} chosen="all" pickedPlotIds={[]} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        expect(screen.getByTestId('pk-crop-all-photos').querySelectorAll('button').length).toBe(8);
        expect(screen.queryByTestId('pk-crop-all-more')).toBeNull();
        expect(screen.getByTestId('pk-crop-all-photos')).toHaveAttribute('data-cols', '4');
        unmount();
        render(<CropPlotPicker crops={many(10)} chosen="all" pickedPlotIds={[]} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        expect(screen.getByTestId('pk-crop-all-photos').querySelectorAll('button').length).toBe(7);
        expect(screen.getByTestId('pk-crop-all-more')).toHaveTextContent('+३ पिकं');
        expect(screen.getByTestId('pk-crop-all-more').tagName).not.toBe('BUTTON');
        expect(screen.getByTestId('pk-crop-all-line')).toHaveTextContent('१० पिकं · १० प्लॉट');
    });

    it('no all-crops card for a single crop even when asked', () => {
        render(<CropPlotPicker crops={[GRAPE]} chosen="grape" pickedPlotIds={['g1', 'g2']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        expect(screen.queryByTestId('pk-crop-all')).toBeNull();
        expect(screen.getByTestId('pk-crop-grape')).toHaveTextContent('२ पैकी २ निवडले');
    });

    it('a page that is on "all" with no all-crops card to show it (one crop) has that crop\'s tile on, with every plot counted', () => {
        render(<CropPlotPicker crops={[GRAPE]} chosen="all" pickedPlotIds={['g1', 'g2']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        expect(screen.getByTestId('pk-crop-grape')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('pk-crop-grape')).toHaveTextContent('२ पैकी २ निवडले');
    });

    it('the plot chips are in natural number order: G2 before G10 (the schedule maker draws this row)', () => {
        const crop: PickerCrop = { id: 'g', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', plots: [{ id: 'a', name: 'G10' }, { id: 'b', name: 'G2' }, { id: 'c', name: 'G1' }] };
        render(<CropPlotPicker crops={[crop]} chosen="g" pickedPlotIds={[]} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} testIds={IDS} language="mr" />);
        expect([...screen.getByTestId('pk-plots').querySelectorAll('button')].map(b => b.textContent)).toEqual(['G1', 'G2', 'G10']);
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
        const { unmount } = render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="grape" pickedPlotIds={['g1']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="en" />);
        expect(screen.getByTestId('pk-crop-all')).toHaveTextContent('All crops');
        expect(screen.getByTestId('pk-crop-all-photo-grape')).toHaveTextContent('2 plots');
        expect(screen.getByTestId('pk-crop-all-photo-cane')).toHaveTextContent('1 plot');
        expect(screen.getByTestId('pk-crops').textContent).not.toMatch(/[ऀ-ॿ]/);
        unmount();
        // without the all-crops card the crop cards carry the English count
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="grape" pickedPlotIds={['g1']} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} testIds={IDS} language="en" />);
        expect(screen.getByTestId('pk-crop-grape')).toHaveTextContent('1 of 2 plots');
        expect(screen.getByTestId('pk-crop-cane')).toHaveTextContent('1 plot');
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

    it('PlotCount (fix round item 4): with a count it reads the one sentence "३ पैकी १ निवडले" (total first), without one "३ प्लॉट", none at all "प्लॉट नाही"', () => {
        const { container, rerender } = render(<PlotCount total={3} picked={1} language="mr" />);
        expect(container).toHaveTextContent('३ पैकी १ निवडले');
        expect(container.textContent).not.toContain('प्लॉट'); // not the backwards "१ पैकी ३ प्लॉट"
        rerender(<PlotCount total={3} language="mr" />);
        expect(container).toHaveTextContent('३ प्लॉट');
        rerender(<PlotCount total={0} language="mr" />);
        expect(container).toHaveTextContent('प्लॉट नाही');
        // nothing picked yet is still said with the same sentence once a count is given
        rerender(<PlotCount total={15} picked={0} language="mr" />);
        expect(container.textContent).toBe('१५ पैकी ० निवडले');
        // every digit of a count is Devanagari in Marathi mode, however long the number
        rerender(<PlotCount total={125} picked={40} language="mr" />);
        expect(container.textContent).toBe('१२५ पैकी ४० निवडले');
        expect(container.textContent).not.toMatch(/[0-9]/);
        // English keeps its own digits
        rerender(<PlotCount total={12} picked={4} language="en" />);
        expect(container).toHaveTextContent('4 of 12 plots');
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

    it('item 5: the count under a crop card is 13 px in the darker grey (stone-700), chosen: emerald-900 - and it may wrap, so it is a rounded box, not a one-line pill', () => {
        const { rerender } = render(<CropTile testId="tile" name="द्राक्ष" on={false} onClick={vi.fn()} photo={<span />} count="१५ पैकी १ निवडले" />);
        const pill = screen.getByTestId('tile').querySelector('span.inline-block') as HTMLElement;
        expect(pill.className).toContain('text-[13px]');
        expect(pill.className).toContain('text-stone-700');
        expect(pill.className).not.toMatch(/text-\[11/);
        expect(pill.className).not.toContain('rounded-full');
        rerender(<CropTile testId="tile" name="द्राक्ष" on onClick={vi.fn()} photo={<span />} count="१५ पैकी १ निवडले" />);
        const onPill = screen.getByTestId('tile').querySelector('span.inline-block') as HTMLElement;
        expect(onPill.className).toContain('text-emerald-900');
        expect(onPill.className).toContain('text-[13px]');
    });

    it('item 5: the hint on the all-crops card is 14 px in stone-700 (it was 12.5 px, pale grey)', () => {
        render(<CropPlotPicker crops={[GRAPE, CANE]} chosen="all" pickedPlotIds={[]} onPickCrop={vi.fn()} onTogglePlot={vi.fn()} allCrops testIds={IDS} language="mr" />);
        const hint = within(screen.getByTestId('pk-crop-all-card')).getByText('फोटो दाबा: फक्त ते पीक दिसेल');
        expect(hint.className).toContain('text-[14px]');
        expect(hint.className).toContain('text-stone-700');
        expect(hint.className).not.toContain('text-stone-500');
    });
});

describe('ChosenCropStrip (log plot step, strip A)', () => {
    it('is the one chosen look - dark green, white letters, a tick on the photo corner - with the photo and the name and nothing else', () => {
        const onClick = vi.fn();
        render(<ChosenCropStrip testId="strip" name="द्राक्ष" onClick={onClick} photo={<img alt="" width={40} height={40} />} className="h-[76px]" />);
        const strip = screen.getByTestId('strip');
        expect(strip.className).toContain('bg-emerald-800');
        expect(strip.className).toContain('h-[76px]'); // the caller's size and ring come through
        expect(strip.textContent).toBe('द्राक्ष');
        expect(strip).toHaveAttribute('aria-pressed', 'true');
        expect(part(part(strip, 'photo') as HTMLElement, 'tick')).toBeTruthy();
        expect(strip.children).toHaveLength(2); // the photo (with its tick) and the name: no label, no count, no second tick
        fireEvent.click(strip);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('a Marathi name with Devanagari digits, or a long one, wraps to two lines and never grows the strip: 2 lines of 16 px (40 px) in the 52 px it has inside the 64 px strip', () => {
        render(<ChosenCropStrip testId="strip" name="सोयाबीन १५ प्लॉट वाला पीक" onClick={vi.fn()} photo={<span />} className="h-[64px]" />);
        const name = part(screen.getByTestId('strip'), 'name') as HTMLElement;
        expect(name.className).toContain('line-clamp-2');
        expect(name.className).toContain('break-words');
        expect(name.className).toContain('min-w-0');
        expect(name.className).toContain('leading-tight');
        // 2 lines x (16 px x 1.25) = 40 px at most; 64 px - 2 x 6 px padding = 52 px of room inside the strip
        expect(2 * 16 * 1.25).toBeLessThanOrEqual(64 - 2 * 6);
        expect(screen.getByTestId('strip').className).toContain('overflow-hidden');
    });
});
