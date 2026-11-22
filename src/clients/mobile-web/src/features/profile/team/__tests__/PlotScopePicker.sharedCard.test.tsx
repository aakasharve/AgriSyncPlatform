// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 6; founder-approved 2026-11-21) - "कोणते प्लॉट?" on a person's team
 * card: for "निवडलेले प्लॉट" the owner sees the SHARED plot card ONCE PER CROP - the crop's photo once, the quick button "सगळे निवडा N", the number
 * grid in natural order (chips for 1 to 6 plots), chosen = dark green with a tick - and ONE count line for the whole farm ("१८ पैकी ५ निवडले").
 * "ठेवा" stays off until at least one plot is chosen, and `onSave` still receives exactly the chosen plot ids.
 *
 * The picker is rendered on its own (farm plots handed in, as `useFarmPlots` returns them); the hook's own reading is in `useFarmPlots.test.ts`.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: h.language, setLanguage: () => undefined, t: (key: string) => key }),
}));

import { PlotScopePicker, groupPlotsByCrop } from '../PlotScopePicker';
import type { FarmPlot, FarmPlotCrop } from '../useFarmPlots';

const GRAPES: FarmPlotCrop = { id: 'c1', name: 'Grapes', iconName: 'Grape', color: 'bg-green-500' }; // stored English, shown in Marathi
const CANE: FarmPlotCrop = { id: 'c2', name: 'Sugarcane', iconName: 'Sugarcane', color: 'bg-pink-500' };
// As `useFarmPlots` hands them over: crop by crop (the order the crop list holds), plots with no known crop last.
const grapePlots: FarmPlot[] = Array.from({ length: 15 }, (_, i) => ({ id: `g${i + 1}`, name: `G${i + 1}`, crop: GRAPES }));
const canePlots: FarmPlot[] = [1, 2, 3].map(n => ({ id: `u${n}`, name: `U${n}`, crop: CANE }));
const ALL_PLOTS: FarmPlot[] = [...grapePlots, ...canePlots];

const M = 'ramesh';
const part = (el: Element, name: string) => el.querySelector(`[data-part="${name}"]`);
const pressed = (id: string) => screen.getByTestId(id).getAttribute('aria-pressed');

function open(farmPlots: FarmPlot[], onSave = vi.fn(), value: { plotScope: 'AllPlots' | 'ChosenPlots' | 'OwnWork'; plotIds?: string[] } = { plotScope: 'AllPlots' }) {
    render(<PlotScopePicker memberId={M} value={value} farmPlots={farmPlots} busy={false} onSave={onSave} />);
    fireEvent.click(screen.getByTestId(`plot-scope-row-${M}`));
    fireEvent.click(screen.getByTestId(`plot-scope-choice-ChosenPlots-${M}`));
    return onSave;
}
const plotBox = (id: string) => screen.getByTestId(`plot-scope-plot-${id}-${M}`);
const saveButton = () => screen.getByTestId(`plot-scope-save-${M}`) as HTMLButtonElement;

afterEach(() => { cleanup(); h.language = 'mr'; });

describe('निवडलेले प्लॉट - the shared card once per crop', () => {
    it('draws one section per crop with the crop\'s photo ONCE and its name in Marathi (never the stored English)', () => {
        open(ALL_PLOTS);
        const grapes = screen.getByTestId(`plot-scope-header-c1-${M}`);
        const cane = screen.getByTestId(`plot-scope-header-c2-${M}`);
        expect(grapes.querySelector('img, svg')).toBeTruthy();
        expect(grapes).toHaveTextContent('द्राक्ष');
        expect(grapes).toHaveTextContent('१५ प्लॉट');
        expect(part(grapes, 'strip')?.className).toContain('bg-green-500');
        expect(cane).toHaveTextContent('ऊस');
        expect(cane).toHaveTextContent('३ प्लॉट');
        // the photo is on the header only, never on a plot
        expect(screen.getByTestId(`plot-scope-grid-c1-${M}`).querySelector('img')).toBeNull();
        expect(screen.getByTestId(`plot-scope-plots-${M}`).textContent).not.toMatch(/Grapes|Sugarcane/);
        // crop by crop, in the given order
        const sections = [...screen.getByTestId(`plot-scope-plots-${M}`).querySelectorAll('section')].map(s => s.getAttribute('data-testid'));
        expect(sections).toEqual([`plot-scope-crop-c1-${M}`, `plot-scope-crop-c2-${M}`]);
    });

    it('the crop with 15 plots is a number grid in natural order with Marathi digits and the quick button "सगळे निवडा १५"; the crop with 3 keeps chips', () => {
        // stored out of number order on purpose: G10, G2, G1 ...
        const scrambled = ['G10', 'G2', 'G1', 'G9', 'G8', 'G7', 'G3', 'G4', 'G5', 'G6', 'G11', 'G12', 'G13', 'G14', 'G15'].map(n => ({ id: `g${n.slice(1)}`, name: n, crop: GRAPES }));
        open([...scrambled, ...canePlots]);
        const grid = screen.getByTestId(`plot-scope-grid-c1-${M}`);
        expect(grid.children).toHaveLength(15);
        expect([...grid.children].map(c => part(c, 'name')?.textContent)).toEqual(Array.from({ length: 15 }, (_, i) => `G${i + 1}`));
        expect([...grid.children].map(c => part(c, 'number')?.textContent).slice(0, 3)).toEqual(['१', '२', '३']);
        expect(part(plotBox('g12'), 'number')).toHaveTextContent('१२');
        expect(screen.getByTestId(`plot-scope-all-c1-${M}`)).toHaveTextContent('सगळे निवडा १५');
        // the small crop: chips, full short names, no number grid
        const caneSection = screen.getByTestId(`plot-scope-crop-c2-${M}`);
        expect(caneSection.querySelector('[data-mode="chips"]')).toBeTruthy();
        expect(caneSection.querySelector('[data-mode="grid"]')).toBeNull();
        expect(plotBox('u2')).toHaveTextContent('U2');
    });

    it('a plot name that starts with the crop word is shown short under the crop\'s header ("द्राक्ष G7" reads "G7")', () => {
        const named = Array.from({ length: 8 }, (_, i) => ({ id: `n${i + 1}`, name: `द्राक्ष G${i + 1}`, crop: { id: 'c1', name: 'द्राक्ष', iconName: 'Grape' } }));
        open(named);
        expect(part(plotBox('n7'), 'name')).toHaveTextContent(/^G7$/);
        expect(screen.getByTestId(`plot-scope-header-c1-${M}`)).toHaveTextContent('द्राक्ष');
    });

    it('chosen = dark green with white letters and a tick; not chosen = white; the count line counts the whole farm', () => {
        open(ALL_PLOTS);
        expect(screen.getByTestId(`plot-scope-count-${M}`)).toHaveTextContent('१८ पैकी ० निवडले');
        expect(plotBox('g7').className).toContain('bg-white');
        expect(part(plotBox('g7'), 'tick')).toBeNull();

        fireEvent.click(plotBox('g7'));
        fireEvent.click(plotBox('g10'));
        fireEvent.click(plotBox('u2'));
        for (const id of ['g7', 'g10', 'u2']) {
            expect(pressed(`plot-scope-plot-${id}-${M}`), id).toBe('true');
            expect(plotBox(id).className, id).toContain('bg-emerald-800');
            expect(plotBox(id).className, id).toContain('text-white');
            expect(part(plotBox(id), 'tick'), id).toBeTruthy();
        }
        expect(pressed(`plot-scope-plot-g8-${M}`)).toBe('false');
        // ONE count line, for all crops together
        expect(screen.getAllByText(/निवडले/).filter(el => el.tagName === 'P' || el.getAttribute('data-testid')?.startsWith('plot-scope-count'))).toHaveLength(1);
        expect(screen.getByTestId(`plot-scope-count-${M}`)).toHaveTextContent('१८ पैकी ३ निवडले');
    });

    it('"सगळे निवडा १५" chooses every plot of THAT crop only, reads "सगळे निवडले", and a second tap clears them', () => {
        open(ALL_PLOTS);
        fireEvent.click(plotBox('u1'));
        fireEvent.click(screen.getByTestId(`plot-scope-all-c1-${M}`));
        for (const g of grapePlots) expect(pressed(`plot-scope-plot-${g.id}-${M}`), g.id).toBe('true');
        expect(pressed(`plot-scope-plot-u1-${M}`)).toBe('true'); // the other crop's choice stays
        expect(pressed(`plot-scope-plot-u2-${M}`)).toBe('false');
        expect(screen.getByTestId(`plot-scope-all-c1-${M}`)).toHaveTextContent('सगळे निवडले');
        expect(screen.getByTestId(`plot-scope-count-${M}`)).toHaveTextContent('१८ पैकी १६ निवडले');

        fireEvent.click(screen.getByTestId(`plot-scope-all-c1-${M}`));
        for (const g of grapePlots) expect(pressed(`plot-scope-plot-${g.id}-${M}`), g.id).toBe('false');
        expect(pressed(`plot-scope-plot-u1-${M}`)).toBe('true');
        expect(screen.getByTestId(`plot-scope-count-${M}`)).toHaveTextContent('१८ पैकी १ निवडले');
    });
});

describe('ठेवा and the ids it sends', () => {
    it('"ठेवा" is off until at least one plot is chosen (and the hint says why); then it sends exactly the chosen ids', () => {
        const onSave = open(ALL_PLOTS);
        expect(saveButton().disabled).toBe(true);
        expect(screen.getByTestId(`plot-scope-pick-one-${M}`)).toHaveTextContent('किमान एक प्लॉट निवडा.');

        fireEvent.click(plotBox('u2'));
        fireEvent.click(plotBox('g3'));
        expect(saveButton().disabled).toBe(false);
        expect(screen.queryByTestId(`plot-scope-pick-one-${M}`)).toBeNull();
        fireEvent.click(saveButton());
        expect(onSave).toHaveBeenCalledTimes(1);
        // in the card's own order (crop by crop), nothing else
        expect(onSave).toHaveBeenCalledWith({ plotScope: 'ChosenPlots', plotIds: ['g3', 'u2'] });
        expect(screen.queryByTestId(`plot-scope-sheet-${M}`)).toBeNull();
    });

    it('taking the last chosen plot off switches "ठेवा" off again', () => {
        open(ALL_PLOTS);
        fireEvent.click(plotBox('g1'));
        expect(saveButton().disabled).toBe(false);
        fireEvent.click(plotBox('g1'));
        expect(saveButton().disabled).toBe(true);
    });

    it('opens with what the server last said already chosen', () => {
        open(ALL_PLOTS, vi.fn(), { plotScope: 'ChosenPlots', plotIds: ['g4', 'g10', 'u3'] });
        for (const id of ['g4', 'g10', 'u3']) expect(pressed(`plot-scope-plot-${id}-${M}`), id).toBe('true');
        expect(screen.getByTestId(`plot-scope-count-${M}`)).toHaveTextContent('१८ पैकी ३ निवडले');
        expect(saveButton().disabled).toBe(false);
    });

    it('सर्व प्लॉट and स्वतःचं काम draw no plot card and still save in one tap', () => {
        const onSave = vi.fn();
        render(<PlotScopePicker memberId={M} value={{ plotScope: 'AllPlots' }} farmPlots={ALL_PLOTS} busy={false} onSave={onSave} />);
        fireEvent.click(screen.getByTestId(`plot-scope-row-${M}`));
        expect(screen.queryByTestId(`plot-scope-plots-${M}`)).toBeNull();
        fireEvent.click(screen.getByTestId(`plot-scope-choice-OwnWork-${M}`));
        expect(screen.queryByTestId(`plot-scope-plots-${M}`)).toBeNull();
        fireEvent.click(saveButton());
        expect(onSave).toHaveBeenCalledWith({ plotScope: 'OwnWork' });
    });
});

describe('plots no crop holds, and a farm with no crop list at all', () => {
    it('are drawn after the crops under "इतर प्लॉट" - never guessed into a crop', () => {
        const lone: FarmPlot[] = [{ id: 'x1', name: 'पडीक' }];
        open([...ALL_PLOTS, ...lone]);
        expect(screen.getByTestId(`plot-scope-header-none-${M}`)).toHaveTextContent('इतर प्लॉट');
        expect(within(screen.getByTestId(`plot-scope-crop-none-${M}`)).getByTestId(`plot-scope-plot-x1-${M}`)).toHaveTextContent('पडीक');
        expect(screen.getByTestId(`plot-scope-count-${M}`)).toHaveTextContent('१९ पैकी ० निवडले');
        fireEvent.click(plotBox('x1'));
        expect(pressed(`plot-scope-plot-x1-${M}`)).toBe('true');
        expect(screen.getByTestId(`plot-scope-count-${M}`)).toHaveTextContent('१९ पैकी १ निवडले');
    });

    it('with no crop known for ANY plot there is one plain card with no crop header and no "इतर प्लॉट" word', () => {
        const onSave = open([{ id: 'p1', name: 'प्लॉट एक' }, { id: 'p2', name: 'प्लॉट दोन' }]);
        expect(screen.queryByTestId(`plot-scope-header-none-${M}`)).toBeNull();
        expect(screen.getByTestId(`plot-scope-count-${M}`)).toHaveTextContent('२ पैकी ० निवडले');
        fireEvent.click(plotBox('p2'));
        fireEvent.click(saveButton());
        expect(onSave).toHaveBeenCalledWith({ plotScope: 'ChosenPlots', plotIds: ['p2'] });
    });

    it('a plot with no name shows "—", never a made-up name', () => {
        open([{ id: 'p1', name: '' }]);
        expect(plotBox('p1')).toHaveTextContent('—');
    });

    it('a farm with no plot on this phone says so and has no count line', () => {
        open([]);
        expect(screen.getByTestId(`plot-scope-plots-${M}`)).toHaveTextContent('या फोनवर अजून प्लॉट नाहीत.');
        expect(screen.queryByTestId(`plot-scope-count-${M}`)).toBeNull();
        expect(saveButton().disabled).toBe(true);
    });
});

describe('groupPlotsByCrop', () => {
    it('groups by crop in the order given; plots with no crop form the last group', () => {
        const groups = groupPlotsByCrop([...grapePlots.slice(0, 2), { id: 'x', name: 'x' }, ...canePlots.slice(0, 1)]);
        expect(groups.map(g => [g.key, g.plots.map(p => p.id)])).toEqual([['c1', ['g1', 'g2']], ['', ['x']], ['c2', ['u1']]]);
    });
});

describe('English mode', () => {
    it('says the count and the quick button in English, with the crop in English', () => {
        h.language = 'en';
        open(ALL_PLOTS);
        expect(screen.getByTestId(`plot-scope-header-c1-${M}`)).toHaveTextContent('Grapes');
        expect(screen.getByTestId(`plot-scope-all-c1-${M}`)).toHaveTextContent('Select all 15');
        expect(screen.getByTestId(`plot-scope-count-${M}`)).toHaveTextContent('0 of 18 chosen');
        fireEvent.click(plotBox('g1'));
        expect(screen.getByTestId(`plot-scope-count-${M}`)).toHaveTextContent('1 of 18 chosen');
    });
});
