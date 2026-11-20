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

describe('the number box', () => {
    it('shows the plot\'s place big in Devanagari digits and its own name small under it, without the crop word', () => {
        render(<Harness n={15} />);
        const box = screen.getByTestId('pl-p7');
        expect(part(box, 'number')).toHaveTextContent('७');
        expect(part(box, 'name')).toHaveTextContent('G7');
        expect(box.textContent).not.toMatch(/द्राक्ष/);
        expect(box.textContent).not.toMatch(/[0-9]{2}/);
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
        for (const b of [on, off]) expect(b.className).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/);
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

    it('the header says the crop once, in his language, with its colour', () => {
        render(<PlotGroupHeader crop={{ name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500' }} sub="१५ पैकी २ निवडले" testId="hd" language="mr" />);
        expect(screen.getByTestId('hd')).toHaveTextContent('द्राक्ष');
        expect(screen.getByTestId('hd')).toHaveTextContent('१५ पैकी २ निवडले');
        expect(part(screen.getByTestId('hd'), 'accent')?.className).toContain('bg-purple-500');
    });

    it('a quick row with nothing to draw draws nothing', () => {
        const { container } = render(<PlotQuickRow plotIds={['a']} chosen={[]} onChange={vi.fn()} allToggle="toggle" language="mr" />);
        expect(container).toBeEmptyDOMElement();
    });
});
