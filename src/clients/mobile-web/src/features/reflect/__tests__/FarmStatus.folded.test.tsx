// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a; founder pick D-174 = A, 2026-11-22: "folded grids and one search")
 *
 * शेताची स्थिती when the page holds MORE THAN 15 plots: each crop's number grid sits folded behind one row (the crop's photo once, its name,
 * the approved sentence "४० पैकी ४० निवडले" and a 44 px button "नंबर दाखवा"), and ONE search box above the crops hears every crop at once
 * (typing "१७" shows G17, U17 and P17 under their crop photos; one tap on a tile shows only that plot). 15 plots or fewer: nothing changes.
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FarmStatus } from '../overview/FarmStatus';
import { selectAll, type ReflectSelection } from '../overview/reflectSelection';
import { crop, plot } from './reflectFixtures';

afterEach(cleanup);

const mk = (id: string, name: string, icon: string, color: string, letter: string, n: number) =>
    crop(id, name, icon, color, Array.from({ length: n }, (_, i) => plot(`${id}${i + 1}`, `${name} ${letter}${i + 1}`)));
/** 100 plots in 4 crops, the design page's sample farm: 40 + 30 + 20 + 10. */
const GRAPES = mk('g', 'द्राक्ष', 'Grapes', 'bg-green-500', 'G', 40);
const CANE = mk('u', 'ऊस', 'Sugarcane', 'bg-pink-500', 'U', 30);
const POM = mk('p', 'डाळिंब', 'Pomegranate', 'bg-red-500', 'P', 20);
const ONION = mk('o', 'कांदा', 'Onion', 'bg-amber-500', 'O', 10);
const FARM = [GRAPES, CANE, POM, ONION];

const Harness: React.FC<{ crops?: typeof FARM; start?: ReflectSelection; onSel?: (s: ReflectSelection) => void }> = ({ crops = FARM, start, onSel }) => {
    const [sel, setSel] = useState<ReflectSelection>(() => start ?? selectAll(crops));
    return <FarmStatus crops={crops} sel={sel} onSel={s => { setSel(s); onSel?.(s); }} />;
};
const part = (el: HTMLElement, name: string) => el.querySelector(`[data-part="${name}"]`);
const type = (text: string) => fireEvent.change(screen.getByTestId('farm-search'), { target: { value: text } });
const pressed = (id: string) => screen.getByTestId(id).getAttribute('aria-pressed');

describe('more than 15 plots: every crop folded', () => {
    it('draws no number tile at all (100 identical dark-green tiles were the wall), but one row per crop with its photo, name and "४० पैकी ४० निवडले"', () => {
        render(<Harness />);
        expect(document.querySelectorAll('[data-testid^="farm-plot-"]').length).toBe(0);
        for (const [id, text] of [['g', '४० पैकी ४० निवडले'], ['u', '३० पैकी ३० निवडले'], ['p', '२० पैकी २० निवडले'], ['o', '१० पैकी १० निवडले']] as const) {
            const header = screen.getByTestId(`farm-crop-header-${id}`);
            expect(header.querySelector('img, svg')).toBeTruthy();
            expect(header).toHaveTextContent(text);
            expect(screen.queryByTestId(`farm-grid-${id}`)).toBeNull();
        }
    });

    it('each row has a 44 px button "नंबर दाखवा" that is a real button (aria-expanded, closed)', () => {
        render(<Harness />);
        const button = screen.getByTestId('farm-fold-g');
        expect(button).toHaveTextContent('नंबर दाखवा');
        expect(button.className).toContain('min-h-[44px]');
        expect(button.getAttribute('aria-expanded')).toBe('false');
    });

    it('a tap opens THAT crop\'s grid in place, exactly as approved (64 px tiles, the dark-green chosen look); the others stay folded; a second tap folds it', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('farm-fold-g'));
        expect(screen.getByTestId('farm-grid-g').children.length).toBe(40);
        expect(part(screen.getByTestId('farm-plot-g7'), 'name')).toHaveTextContent('G7');
        expect(screen.getByTestId('farm-plot-g7').className).toContain('h-[64px]');
        expect(screen.getByTestId('farm-plot-g7').className).toContain('bg-emerald-800');
        expect(screen.queryByTestId('farm-grid-u')).toBeNull();
        expect(screen.getByTestId('farm-fold-g')).toHaveTextContent('नंबर लपवा');
        expect(screen.getByTestId('farm-fold-g').getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(screen.getByTestId('farm-fold-g'));
        expect(screen.queryByTestId('farm-grid-g')).toBeNull();
        expect(screen.getByTestId('farm-fold-g')).toHaveTextContent('नंबर दाखवा');
    });

    it('an open grid is the same one tap rule: with all chosen, a tap on a tile shows ONLY that plot, and the folded rows count it', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('farm-fold-g'));
        fireEvent.click(screen.getByTestId('farm-plot-g7'));
        expect(screen.getByTestId('farm-solo-line')).toHaveTextContent('फक्त G7 दिसतो');
        expect(pressed('farm-plot-g7')).toBe('true');
        expect(pressed('farm-plot-g8')).toBe('false');
        expect(screen.getByTestId('farm-crop-header-g')).toHaveTextContent('४० पैकी १ निवडले');
        expect(screen.getByTestId('farm-crop-header-u')).toHaveTextContent('३० पैकी ० निवडले');
    });

    it('the boundary is "more than 15": 16 plots fold, 15 plots do not', () => {
        const sixteen = [mk('g', 'द्राक्ष', 'Grapes', 'bg-green-500', 'G', 9), mk('u', 'ऊस', 'Sugarcane', 'bg-pink-500', 'U', 7)];
        const fifteen = [mk('g', 'द्राक्ष', 'Grapes', 'bg-green-500', 'G', 9), mk('u', 'ऊस', 'Sugarcane', 'bg-pink-500', 'U', 6)];
        const { unmount } = render(<Harness crops={sixteen} />);
        expect(screen.getByTestId('farm-search')).toBeTruthy();
        expect(screen.queryByTestId('farm-grid-g')).toBeNull();
        unmount();
        render(<Harness crops={fifteen} />);
        expect(screen.queryByTestId('farm-search')).toBeNull();
        expect(screen.queryByTestId('farm-fold-g')).toBeNull();
        expect(screen.getByTestId('farm-grid-g').children.length).toBe(9);
    });

    it('15 plots of one crop: the grid stays open and there is no search box, as before', () => {
        const fifteen = [mk('g', 'द्राक्ष', 'Grapes', 'bg-green-500', 'G', 15)];
        render(<Harness crops={fifteen} />);
        expect(screen.getByTestId('farm-grid-g').children.length).toBe(15);
        expect(screen.queryByTestId('farm-search')).toBeNull();
        expect(screen.queryByTestId('farm-fold-g')).toBeNull();
    });

    it('a small crop on a folded page stays as chips (six chips are not a wall): no fold button for it', () => {
        const farm = [GRAPES, mk('o', 'कांदा', 'Onion', 'bg-amber-500', 'O', 4)];
        render(<Harness crops={farm} />);
        expect(screen.getByTestId('farm-plot-o1')).toHaveTextContent('O1');
        expect(screen.queryByTestId('farm-fold-o')).toBeNull();
        expect(screen.getByTestId('farm-fold-g')).toBeTruthy();
    });
});

describe('one search for every crop', () => {
    it('there is exactly one search box, above the crops, with the approved words', () => {
        render(<Harness />);
        const boxes = document.querySelectorAll('input[type="search"]');
        expect(boxes.length).toBe(1);
        const box = screen.getByTestId('farm-search') as HTMLInputElement;
        expect(box.placeholder).toBe('प्लॉट शोधा: नाव किंवा नंबर');
        expect(box.className).toContain('min-h-[46px]');
        expect(box.compareDocumentPosition(screen.getByTestId('farm-crop-header-g')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('typing "१७" shows G17, U17 and P17, each under its own crop header; a crop with no 17th plot is not drawn', () => {
        render(<Harness />);
        type('१७');
        expect(screen.getByTestId('farm-plot-g17')).toBeTruthy();
        expect(screen.getByTestId('farm-plot-u17')).toBeTruthy();
        expect(screen.getByTestId('farm-plot-p17')).toBeTruthy();
        expect(document.querySelectorAll('[data-testid^="farm-plot-"]').length).toBe(3);
        expect(screen.getByTestId('farm-crop-header-g').compareDocumentPosition(screen.getByTestId('farm-plot-g17')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByTestId('farm-crop-header-o')).toBeNull(); // onion has only 10 plots
        // a search shows the matching tiles itself: no fold button is needed while searching
        expect(screen.queryByTestId('farm-fold-g')).toBeNull();
    });

    it('a Latin digit searches the same as a Devanagari one, and a name works too', () => {
        render(<Harness />);
        type('17');
        expect(document.querySelectorAll('[data-testid^="farm-plot-"]').length).toBe(3);
        type('U2');
        expect([...document.querySelectorAll('[data-testid^="farm-plot-"]')].every(el => /farm-plot-u/.test(el.getAttribute('data-testid') ?? ''))).toBe(true);
    });

    it('one tap on a found tile shows only that plot, with "सगळे दाखवा"', () => {
        const onSel = vi.fn();
        render(<Harness onSel={onSel} />);
        type('१७');
        fireEvent.click(screen.getByTestId('farm-plot-u17'));
        expect(onSel).toHaveBeenLastCalledWith({ crop: 'all', plotIds: ['u17'] });
        expect(screen.getByTestId('farm-solo-line')).toHaveTextContent('फक्त U17 दिसतो');
        expect(screen.getByTestId('farm-solo-all')).toHaveTextContent('सगळे दाखवा');
    });

    it('nothing found says so once (not once per crop); clearing the search folds everything back', () => {
        render(<Harness />);
        type('९९९');
        expect(screen.getAllByText('असा प्लॉट सापडला नाही').length).toBe(1);
        expect(document.querySelectorAll('[data-testid^="farm-plot-"]').length).toBe(0);
        type('');
        expect(screen.queryByText('असा प्लॉट सापडला नाही')).toBeNull();
        expect(screen.getByTestId('farm-crop-header-g')).toBeTruthy();
        expect(screen.getByTestId('farm-crop-header-o')).toBeTruthy();
        expect(document.querySelectorAll('[data-testid^="farm-plot-"]').length).toBe(0);
    });

    it('the search also finds a plot of a small crop shown as chips', () => {
        const farm = [GRAPES, mk('o', 'कांदा', 'Onion', 'bg-amber-500', 'O', 4)];
        render(<Harness crops={farm} />);
        type('O3');
        expect(screen.getByTestId('farm-plot-o3')).toBeTruthy();
        expect(screen.queryByTestId('farm-plot-o1')).toBeNull();
    });
});
