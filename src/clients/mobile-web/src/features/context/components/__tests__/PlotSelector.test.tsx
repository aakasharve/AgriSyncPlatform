// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a)
 *
 * The shared plot selector: chips up to 6 plots, a number grid with quick buttons from 7, a search box from 25; one chosen look; the
 * toggle that chooses and clears all; true quick buttons only; Marathi digits.
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PickedCountLine, PlotGroupHeader, PlotQuickRow, PlotSelector, type PlotSelectorProps } from '../PlotSelector';
import { buildQuickButtons } from '../plotSelectorRules';
import { toDevanagariDigits } from '../../../../shared/utils/marathiDigits';

afterEach(cleanup);

const part = (el: HTMLElement, name: string) => el.querySelector(`[data-part="${name}"]`);
const plotsOf = (n: number, prefix = 'G') => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `द्राक्ष ${prefix}${i + 1}` }));
const IDS = { plot: (id: string) => `pl-${id}`, all: 'pl-all', quick: (id: string) => `pl-q-${id}`, search: 'pl-search', grid: 'pl-grid' };

const Harness: React.FC<Partial<PlotSelectorProps> & { n: number; start?: string[]; onChanged?: (ids: string[]) => void }> = ({ n, start = [], onChanged, ...rest }) => {
    const [chosen, setChosen] = useState<string[]>(start);
    return <PlotSelector plots={plotsOf(n)} chosen={chosen} onChange={ids => { setChosen(ids); onChanged?.(ids); }} cropNames={['द्राक्ष']} color="bg-green-500" testIds={IDS} language="mr" {...rest} />;
};

describe('how many plots decide how they are drawn', () => {
    it('1 to 6 plots are chips with the crop\'s colour dot, as today (no grid, no toggle)', () => {
        render(<Harness n={6} />);
        expect(screen.getByTestId('pl-grid').parentElement).toHaveAttribute('data-mode', 'chips');
        expect(part(screen.getByTestId('pl-p1'), 'dot')?.className).toContain('bg-green-500');
        expect(screen.queryByTestId('pl-all')).toBeNull();
        expect(screen.queryByTestId('pl-search')).toBeNull();
    });

    it('7 plots are a number grid with the "सगळे निवडा" button', () => {
        render(<Harness n={7} />);
        expect(screen.getByTestId('pl-grid').parentElement).toHaveAttribute('data-mode', 'grid');
        expect(screen.getByTestId('pl-all')).toHaveTextContent('सगळे निवडा ७');
        expect(screen.queryByTestId('pl-search')).toBeNull();
    });

    it('24 plots have no search box, 25 do', () => {
        const { unmount } = render(<Harness n={24} />);
        expect(screen.queryByTestId('pl-search')).toBeNull();
        unmount();
        render(<Harness n={25} />);
        expect(screen.getByTestId('pl-search')).toBeTruthy();
    });
});

describe('natural number order: G2 before G10, in the grid and in the chips', () => {
    const shuffled = (n: number) => ['G10', 'G2', 'G1', 'G11', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'].slice(0, n).map((name, i) => ({ id: `s${i}`, name: `द्राक्ष ${name}` }));
    const idsInOrder = (testId: string) => [...screen.getByTestId(testId).children].map(c => c.getAttribute('data-testid'));

    it('the grid lists G1, G2, G3 ... G10, G11 and each box\'s number is its place in that order, so the name and the number agree (CTO ruling 2026-11-20)', () => {
        const plots = shuffled(11); // stored order: G10, G2, G1, G11, G3 ...
        render(<PlotSelector plots={plots} chosen={[]} onChange={vi.fn()} cropNames={['द्राक्ष']} testIds={IDS} language="mr" />);
        const names = [...screen.getByTestId('pl-grid').children].map(c => part(c as HTMLElement, 'name')?.textContent);
        expect(names).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11']);
        const numbers = [...screen.getByTestId('pl-grid').children].map(c => part(c as HTMLElement, 'number')?.textContent);
        expect(numbers).toEqual(['१', '२', '३', '४', '५', '६', '७', '८', '९', '१०', '११']);
        // G1 is the third plot of the STORED list but its box says १; G10 is stored first but its box says १०
        expect(part(screen.getByTestId('pl-s2'), 'number')).toHaveTextContent('१');
        expect(part(screen.getByTestId('pl-s0'), 'number')).toHaveTextContent('१०');
    });

    it('with 15 plots stored in a scrambled order every box reads G<n> with the number n, two-digit ones included (the CTO\'s G3 with १४ case)', () => {
        const order = [3, 4, 7, 14, 1, 9, 12, 2, 15, 5, 11, 6, 13, 10, 8]; // arbitrary stored order
        const plots = order.map(n => ({ id: `g${n}`, name: `द्राक्ष G${n}` }));
        render(<PlotSelector plots={plots} chosen={['g14', 'g11']} onChange={vi.fn()} cropNames={['द्राक्ष']} testIds={IDS} language="mr" />);
        for (let n = 1; n <= 15; n += 1) {
            const box = screen.getByTestId(`pl-g${n}`);
            expect(part(box, 'name')).toHaveTextContent(`G${n}`);
            expect(part(box, 'number')?.textContent).toBe(toDevanagariDigits(String(n)));
        }
    });

    it('English mode: the same numbers in Latin digits', () => {
        const plots = [{ id: 'a', name: 'G10' }, { id: 'b', name: 'G2' }, { id: 'c', name: 'G1' }, { id: 'd', name: 'G3' }, { id: 'e', name: 'G4' }, { id: 'f', name: 'G5' }, { id: 'g', name: 'G6' }];
        render(<PlotSelector plots={plots} chosen={[]} onChange={vi.fn()} testIds={IDS} language="en" />);
        expect(part(screen.getByTestId('pl-a'), 'number')?.textContent).toBe('7');
        expect(part(screen.getByTestId('pl-b'), 'number')?.textContent).toBe('2');
    });

    it('the chips are in number order too (full names, as before)', () => {
        const plots = [{ id: 'a', name: 'द्राक्ष G10' }, { id: 'b', name: 'द्राक्ष G2' }, { id: 'c', name: 'द्राक्ष G1' }];
        render(<PlotSelector plots={plots} chosen={[]} onChange={vi.fn()} testIds={IDS} language="mr" />);
        expect(idsInOrder('pl-grid')).toEqual(['pl-c', 'pl-b', 'pl-a']);
        expect(screen.getByTestId('pl-c')).toHaveTextContent('द्राक्ष G1');
    });

    it('plots with no digit in their name keep the order they were stored in, after the numbered ones', () => {
        const plots = [{ id: 'a', name: 'सोनाका' }, { id: 'b', name: 'G2' }, { id: 'c', name: 'थॉम्पसन' }, { id: 'd', name: 'G1' }];
        render(<PlotSelector plots={plots} chosen={[]} onChange={vi.fn()} testIds={IDS} language="mr" />);
        expect(idsInOrder('pl-grid')).toEqual(['pl-d', 'pl-b', 'pl-a', 'pl-c']);
    });

    it('a quick button and the toggle choose in the same order the plots are listed', () => {
        const onChange = vi.fn();
        render(<PlotSelector plots={shuffled(8)} chosen={[]} onChange={onChange} testIds={IDS} language="mr" />);
        fireEvent.click(screen.getByTestId('pl-all'));
        // stored: G10 G2 G1 G11 G3 G4 G5 G6 (s0..s7); listed: G1 G2 G3 G4 G5 G6 G10 G11. The chosen set follows the listed order.
        expect(onChange).toHaveBeenLastCalledWith(['s2', 's1', 's4', 's5', 's6', 's7', 's0', 's3']);
    });
});

describe('the number box', () => {
    it('shows the plot\'s place big in Devanagari digits and its own name small under it, without the crop word', () => {
        render(<Harness n={15} />);
        const box = screen.getByTestId('pl-p7');
        expect(part(box, 'number')).toHaveTextContent('७');
        expect(part(box, 'name')).toHaveTextContent('G7');
        expect(box.textContent).not.toMatch(/द्राक्ष/);
        expect(box.textContent).not.toMatch(/[0-9]{2}/);
    });

    it('tile A (founder 2026-11-20): no dot on any box; the number is 24 px, the name 13 px, the box 64 px tall - and a two-digit number reads whole, chosen or not', () => {
        render(<Harness n={15} start={['p10', 'p11', 'p14']} />);
        for (let n = 1; n <= 15; n++) expect(part(screen.getByTestId(`pl-p${n}`), 'dot')).toBeNull();
        const on = screen.getByTestId('pl-p10'); // two digits, chosen
        const off = screen.getByTestId('pl-p12'); // two digits, not chosen
        expect(part(on, 'number')?.textContent).toBe('१०'); // the tick adds no text, nothing covers the digits
        expect(part(off, 'number')?.textContent).toBe('१२');
        expect(part(screen.getByTestId('pl-p11'), 'number')?.textContent).toBe('११');
        expect(part(screen.getByTestId('pl-p14'), 'number')?.textContent).toBe('१४');
        for (const b of [on, off]) {
            expect(b.className).toContain('h-[64px]');
            expect(b.className).toContain('rounded-[14px]');
            expect(part(b, 'number')?.className).toContain('text-[24px]');
            expect(part(b, 'number')?.className).toContain('leading-[26px]');
            expect(part(b, 'name')?.className).toContain('text-[13px]');
        }
        expect(part(on, 'name')?.className).toContain('text-white'); // chosen: white letters
        expect(part(off, 'name')?.className).toContain('text-stone-900'); // not chosen: near black
        expect(part(off, 'tick')).toBeNull();
        expect(part(on, 'tick')).toBeTruthy();
        // the tick is NOT inside the number's text and owns the top-right corner
        expect(part(on, 'number')?.contains(part(on, 'tick') as Node)).toBe(false);
    });

    it('the tick and the number never touch: the tick (top 2 + 14 px) ends where the number\'s own glyph space begins (padding 15 px + half the 2 px line gap)', () => {
        render(<Harness n={15} start={['p10']} />);
        const box = screen.getByTestId('pl-p10');
        const px = (cls: string, re: RegExp) => Number(re.exec(cls)?.[1]);
        const tickCls = part(box, 'tick')!.className;
        const tickBottom = px(tickCls, /top-\[(\d+)px\]/) + px(tickCls, /h-\[(\d+)px\]/);
        const numCls = part(box, 'number')!.className;
        const glyphTop = px(box.className, /pt-\[(\d+)px\]/) + (px(numCls, /leading-\[(\d+)px\]/) - px(numCls, /text-\[(\d+)px\]/)) / 2;
        expect(tickBottom).toBeLessThanOrEqual(glyphTop);
        expect(px(tickCls, /h-\[(\d+)px\]/)).toBe(px(tickCls, /w-\[(\d+)px\]/)); // a round 14 px badge
        expect(tickCls).toContain('right-[2px]');
    });

    it('five boxes across (four below 340 px) - 49 px and 53 px wide, both above the 44 px thumb', () => {
        render(<Harness n={15} />);
        const grid = screen.getByTestId('pl-grid');
        expect(grid.className).toContain('grid-cols-5');
        expect(grid.className).toContain('max-[339px]:grid-cols-4');
        expect(grid.className).toContain('gap-2');
        // 277 px of card at 360 px: (277 - 4 x 8) / 5 = 49; 236 px at 320 px: (236 - 3 x 8) / 4 = 53
        expect((277 - 4 * 8) / 5).toBeGreaterThanOrEqual(44);
        expect((236 - 3 * 8) / 4).toBeGreaterThanOrEqual(44);
    });

    it('English keeps Latin digits', () => {
        render(<Harness n={8} language="en" />);
        expect(part(screen.getByTestId('pl-p7'), 'number')).toHaveTextContent('7');
        expect(screen.getByTestId('pl-all')).toHaveTextContent('Select all 8');
    });

    it('a box is at least 44 px tall and a chosen one is dark green with white letters and a white tick; never the crop colour', () => {
        render(<Harness n={8} start={['p2']} />);
        const on = screen.getByTestId('pl-p2');
        const off = screen.getByTestId('pl-p3');
        for (const b of [on, off]) expect(b.className).toMatch(/(^|\s)h-\[(4[4-9]|[5-9]\d)px\]/);
        expect(on).toHaveAttribute('aria-pressed', 'true');
        expect(on.className).toContain('bg-emerald-800');
        expect(on.className).toContain('text-white');
        expect(on.className).not.toContain('bg-green-500');
        expect(part(on, 'tick')).toBeTruthy();
        expect(off).toHaveAttribute('aria-pressed', 'false');
        expect(off.className).toContain('bg-white');
        expect(off.className).toContain('border-stone-400');
        expect(part(off, 'tick')).toBeNull();
    });

    it('the chip\'s chosen look is the same dark green with a white tick', () => {
        render(<Harness n={3} start={['p1']} />);
        expect(screen.getByTestId('pl-p1').className).toContain('bg-emerald-800');
        expect(screen.getByTestId('pl-p1').className).toContain('text-white');
        expect(part(screen.getByTestId('pl-p1'), 'tick')?.getAttribute('class')).toContain('text-white');
        expect(screen.getByTestId('pl-p2').className).toContain('bg-white');
    });

    it('a mark (Sathi\'s tag) shows on the plot and chooses nothing', () => {
        render(<Harness n={8} mark={id => (id === 'p4' ? <span data-testid="the-mark">आत्ता इथे</span> : undefined)} />);
        expect(screen.getByTestId('pl-p4')).toContainElement(screen.getByTestId('the-mark'));
        expect(screen.getByTestId('pl-p4')).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('choosing', () => {
    it('a tap adds a plot, a second tap takes it off, and onChange hears the whole new set', () => {
        const onChanged = vi.fn();
        render(<Harness n={8} onChanged={onChanged} />);
        fireEvent.click(screen.getByTestId('pl-p3'));
        expect(onChanged).toHaveBeenLastCalledWith(['p3']);
        fireEvent.click(screen.getByTestId('pl-p5'));
        expect(onChanged).toHaveBeenLastCalledWith(['p3', 'p5']);
        fireEvent.click(screen.getByTestId('pl-p3'));
        expect(onChanged).toHaveBeenLastCalledWith(['p5']);
    });

    it('a page with its own tap rule hears the tap and nothing else changes', () => {
        const onTapPlot = vi.fn();
        const onChange = vi.fn();
        render(<PlotSelector plots={plotsOf(8)} chosen={[]} onChange={onChange} onTapPlot={onTapPlot} testIds={IDS} language="mr" />);
        fireEvent.click(screen.getByTestId('pl-p2'));
        expect(onTapPlot).toHaveBeenCalledWith('p2');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('the one toggle chooses all, then reads "सगळे निवडले" and clears all on the next tap', () => {
        render(<Harness n={8} start={['p1']} />);
        expect(screen.getByTestId('pl-all')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByTestId('pl-all'));
        expect(screen.getByTestId('pl-all')).toHaveTextContent('सगळे निवडले');
        expect(screen.getByTestId('pl-all')).toHaveAttribute('aria-pressed', 'true');
        for (let i = 1; i <= 8; i++) expect(screen.getByTestId(`pl-p${i}`)).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('pl-all'));
        expect(screen.getByTestId('pl-all')).toHaveTextContent('सगळे निवडा');
        for (let i = 1; i <= 8; i++) expect(screen.getByTestId(`pl-p${i}`)).toHaveAttribute('aria-pressed', 'false');
    });

    it('for a page that is never empty the toggle ("select") chooses all and then does nothing', () => {
        const onChange = vi.fn();
        render(<PlotSelector plots={plotsOf(8)} chosen={plotsOf(8).map(p => p.id)} onChange={onChange} allToggle="select" testIds={IDS} language="mr" />);
        expect(screen.getByTestId('pl-all')).toHaveTextContent('सगळे निवडले');
        fireEvent.click(screen.getByTestId('pl-all'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('allToggle="none" draws no toggle', () => {
        render(<Harness n={8} allToggle="none" />);
        expect(screen.queryByTestId('pl-all')).toBeNull();
    });
});

describe('quick buttons are true facts only', () => {
    const ids = plotsOf(15).map(p => p.id);
    const quick = (yesterday: string[], today: string[]) => buildQuickButtons({ plotIds: ids, kinds: ['yesterday', 'todayLeft'], language: 'mr', facts: { yesterday: new Set(yesterday), today: new Set(today) } });

    it('"कालचेच ४" and "आज बाकी ६" are drawn with their real counts, and a tap chooses exactly those plots', () => {
        const onChanged = vi.fn();
        render(<Harness n={15} quickButtons={quick(['p3', 'p4', 'p7', 'p8'], ids.slice(0, 9))} onChanged={onChanged} />);
        expect(screen.getByTestId('pl-q-yesterday')).toHaveTextContent('कालचेच ४');
        expect(screen.getByTestId('pl-q-todayLeft')).toHaveTextContent('आज बाकी ६');
        fireEvent.click(screen.getByTestId('pl-q-yesterday'));
        expect(onChanged).toHaveBeenLastCalledWith(['p3', 'p4', 'p7', 'p8']);
        expect(screen.getByTestId('pl-q-yesterday')).toHaveAttribute('aria-pressed', 'true');
        for (const id of ['p3', 'p4', 'p7', 'p8']) expect(screen.getByTestId(`pl-${id}`)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('pl-p1')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByTestId('pl-q-todayLeft'));
        expect(onChanged).toHaveBeenLastCalledWith(['p10', 'p11', 'p12', 'p13', 'p14', 'p15']);
    });

    it('a button whose count is ० is not drawn, and there is no "अलीकडचे" and no late tag at all', () => {
        render(<Harness n={15} quickButtons={quick([], ids)} />);
        expect(screen.queryByTestId('pl-q-yesterday')).toBeNull();
        expect(screen.queryByTestId('pl-q-todayLeft')).toBeNull();
        expect(screen.getByTestId('pl-all')).toBeTruthy(); // the toggle is a fact about the plots themselves
        expect(document.body.textContent).not.toMatch(/अलीकडचे|उशीर/);
    });

    it('named groups are an extension point: drawn as extra quick buttons, and nothing is drawn when none are given', () => {
        const { unmount } = render(<Harness n={10} />);
        expect(document.querySelectorAll('[data-testid^="pl-q-group"]').length).toBe(0);
        unmount();
        const onChanged = vi.fn();
        render(<Harness n={10} groups={[{ name: 'पूर्व', plotIds: ['p1', 'p2', 'p3'] }, { name: 'रिकामा', plotIds: [] }]} onChanged={onChanged} />);
        expect(screen.getByTestId('pl-q-group:पूर्व')).toHaveTextContent('पूर्व ३');
        expect(screen.queryByTestId('pl-q-group:रिकामा')).toBeNull();
        fireEvent.click(screen.getByTestId('pl-q-group:पूर्व'));
        expect(onChanged).toHaveBeenLastCalledWith(['p1', 'p2', 'p3']);
    });
});

describe('search (25 plots and more)', () => {
    it('finds by number in either script, by name, and says so when nothing is found; the chosen plots stay chosen', () => {
        render(<Harness n={30} start={['p9']} />);
        const input = screen.getByTestId('pl-search');
        fireEvent.change(input, { target: { value: '७' } });
        expect(screen.getByTestId('pl-p7')).toBeTruthy();
        expect(screen.queryByTestId('pl-p17')).toBeNull();
        expect(screen.queryByTestId('pl-p1')).toBeNull();
        fireEvent.change(input, { target: { value: '7' } });
        expect(screen.getByTestId('pl-p7')).toBeTruthy();
        expect(screen.queryByTestId('pl-p17')).toBeNull();
        fireEvent.change(input, { target: { value: 'g2' } });
        expect(screen.getByTestId('pl-p2')).toBeTruthy();
        expect(screen.getByTestId('pl-p20')).toBeTruthy();
        expect(screen.queryByTestId('pl-p3')).toBeNull();
        fireEvent.change(input, { target: { value: 'zzz' } });
        expect(screen.getByTestId('pl-search-empty')).toHaveTextContent('असा प्लॉट सापडला नाही');
        fireEvent.change(input, { target: { value: '' } });
        expect(screen.getByTestId('pl-p9')).toHaveAttribute('aria-pressed', 'true');
    });
});

describe('the count line and the header', () => {
    it('the count line is one sentence in Devanagari digits', () => {
        render(<PickedCountLine total={15} picked={4} testId="cnt" language="mr" />);
        expect(screen.getByTestId('cnt')).toHaveTextContent('१५ पैकी ४ निवडले');
    });

    it('the header says the crop once, in his language; its colour is a thin strip UNDER the photo, not a bar at the far end (CTO defect 4, header A)', () => {
        render(<PlotGroupHeader crop={{ name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500' }} sub="१५ पैकी २ निवडले" testId="hd" language="mr" />);
        const hd = screen.getByTestId('hd');
        expect(hd).toHaveTextContent('द्राक्ष');
        expect(hd).toHaveTextContent('१५ पैकी २ निवडले');
        expect(part(hd, 'accent')).toBeNull(); // the floating bar is gone
        const strip = part(hd, 'strip');
        expect(strip?.className).toContain('bg-purple-500');
        expect(strip?.className).toMatch(/(^|\s)h-1(\s|$)/); // 4 px
        // the strip sits in the photo's own column, the FIRST part of the header; the words are the last part and carry no colour
        expect(hd.firstElementChild).toBe(part(hd, 'photo-column'));
        expect(part(hd, 'photo-column')?.contains(strip as Node)).toBe(true);
        expect(hd.lastElementChild?.innerHTML).not.toContain('bg-purple-500');
        expect(hd.lastElementChild?.querySelector('span')).not.toBeNull();
    });

    it('the crop name is 18 px and the count line 14 px in the darker grey; the row lines the words up with the photo', () => {
        render(<PlotGroupHeader crop={{ name: 'Grapes', iconName: 'Grape' }} sub="१५ पैकी २ निवडले" testId="hd" language="mr" />);
        const hd = screen.getByTestId('hd');
        expect(hd.className).toContain('items-start');
        const words = hd.lastElementChild as HTMLElement;
        expect(words.className).toContain('min-h-[40px]');
        const [name, sub] = [...words.children] as HTMLElement[];
        expect(name.className).toContain('text-[18px]');
        expect(sub.className).toContain('text-[14px]');
        expect(sub.className).toContain('text-stone-700');
        expect(sub.className).not.toMatch(/text-\[12/);
    });

    it('what a caller puts in `right` is the last thing in the header', () => {
        render(<PlotGroupHeader crop={{ name: 'Grapes', iconName: 'Grape' }} right={<b data-testid="r">x</b>} testId="hd" language="mr" />);
        expect(screen.getByTestId('hd').lastElementChild).toBe(screen.getByTestId('r'));
    });

    it('a quick row with nothing to draw draws nothing', () => {
        const { container } = render(<PlotQuickRow plotIds={['a']} chosen={[]} onChange={vi.fn()} allToggle="toggle" language="mr" />);
        expect(container).toBeEmptyDOMElement();
    });
});
