// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, founder pick overview C "number grid in place")
 *
 * The overview's "शेताची स्थिती" for an owner with 15 plots of one crop: the number grid in place under the crop cards, with every plot
 * picked ONE tap on a number shows only that plot ("फक्त G7 दिसतो" + "सगळे दाखवा"), no "none" button (the page is never empty), true quick
 * buttons only ("आज सांगितलेले", "आज बाकी", never a count of ०). A small farm keeps its chips and the tap it always had.
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FarmStatus } from '../overview/FarmStatus';
import { selectAll, type ReflectSelection } from '../overview/reflectSelection';
import { CANE, CROPS, crop, plot } from './reflectFixtures';

afterEach(cleanup);

const GRAPES = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', Array.from({ length: 15 }, (_, i) => plot(`g${i + 1}`, `द्राक्ष G${i + 1}`)));
const CANE3 = crop('cane', 'ऊस', 'Sugarcane', 'bg-pink-500', [plot('c1', 'ऊस S1'), plot('c2', 'ऊस S2'), plot('c3', 'ऊस S3')]);
const FARM = [GRAPES, CANE3];

const Harness: React.FC<{ crops: typeof FARM; told?: ReadonlySet<string> | null; start?: (c: typeof FARM) => ReflectSelection; onSel?: (s: ReflectSelection) => void }> = ({ crops, told, start, onSel }) => {
    const [sel, setSel] = useState<ReflectSelection>(() => (start ? start(crops) : selectAll(crops)));
    return <FarmStatus crops={crops} sel={sel} onSel={s => { setSel(s); onSel?.(s); }} toldTodayPlotIds={told} />;
};
const part = (el: HTMLElement, name: string) => el.querySelector(`[data-part="${name}"]`);
const pressed = (id: string) => screen.getByTestId(id).getAttribute('aria-pressed');
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

describe('the overview picker with 15 plots', () => {
    it('draws the 15 grape plots as a number grid in place (Devanagari numbers, "G7" under each), under the crop cards', () => {
        render(<Harness crops={FARM} />);
        const grid = screen.getByTestId('farm-grid-grape');
        expect(grid.children.length).toBe(15);
        expect(part(screen.getByTestId('farm-plot-g7'), 'number')).toHaveTextContent('७');
        expect(part(screen.getByTestId('farm-plot-g7'), 'name')).toHaveTextContent('G7');
        expect(screen.getByTestId('farm-crop-grape').compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // everything starts chosen, in the one dark-green look
        for (const id of ids('g', 15)) expect(pressed(`farm-plot-${id}`)).toBe('true');
        expect(screen.getByTestId('farm-plot-g7').className).toContain('bg-emerald-800');
    });

    it('with two crops the big crop has one header with its photo, its boxes carry no photo; the 3-plot crop stays chips with full names', () => {
        render(<Harness crops={FARM} />);
        expect(screen.getByTestId('farm-crop-header-grape').querySelector('img, svg')).toBeTruthy();
        expect(screen.getByTestId('farm-grid-grape').querySelector('img')).toBeNull();
        expect(screen.queryByTestId('farm-crop-header-cane')).toBeNull();
        expect(screen.getByTestId('farm-plot-c1')).toHaveTextContent('ऊस S1');
        expect(part(screen.getByTestId('farm-plot-c1'), 'dot')?.className).toContain('bg-pink-500');
    });

    it('with one crop in view the crop card above is the header: no second header, short names in the grid', () => {
        render(<Harness crops={[GRAPES]} />);
        expect(screen.queryByTestId('farm-crop-header-grape')).toBeNull();
        expect(part(screen.getByTestId('farm-plot-g3'), 'name')).toHaveTextContent('G3');
    });

    it('there is no "none" button on the overview (the page is never empty), and no word for it', () => {
        render(<Harness crops={FARM} />);
        expect(document.body.textContent).not.toMatch(/एकही नाही/);
        // the one toggle can only choose all: with everything chosen it reads "सगळे निवडले" and does nothing
        const all = screen.getByTestId('farm-plots-all');
        expect(all).toHaveTextContent('सगळे निवडले');
        fireEvent.click(all);
        for (const id of ids('g', 15)) expect(pressed(`farm-plot-${id}`)).toBe('true');
    });
});

describe('one tap on a number shows only that plot', () => {
    it('with all chosen a tap on ७ shows ONLY G7, says so, and "सगळे दाखवा" brings every plot back', () => {
        render(<Harness crops={FARM} />);
        fireEvent.click(screen.getByTestId('farm-plot-g7'));
        expect(pressed('farm-plot-g7')).toBe('true');
        for (const id of ids('g', 15).filter(x => x !== 'g7')) expect(pressed(`farm-plot-${id}`)).toBe('false');
        expect(pressed('farm-plot-c1')).toBe('false');
        expect(screen.getByTestId('farm-solo-line')).toHaveTextContent('फक्त G7 दिसतो');
        expect(screen.getByTestId('farm-solo-all')).toHaveTextContent('सगळे दाखवा');
        expect(screen.queryByTestId('farm-picked-count')).toBeNull();
        fireEvent.click(screen.getByTestId('farm-solo-all'));
        for (const id of [...ids('g', 15), ...ids('c', 3)]) expect(pressed(`farm-plot-${id}`)).toBe('true');
        expect(screen.queryByTestId('farm-solo-line')).toBeNull();
        expect(screen.getByTestId('farm-tap-hint')).toHaveTextContent('एक नंबर दाबा: फक्त तो प्लॉट दिसेल');
    });

    it('after that first tap, taps add and remove, and the count line counts in Devanagari digits', () => {
        render(<Harness crops={FARM} />);
        fireEvent.click(screen.getByTestId('farm-plot-g7'));
        fireEvent.click(screen.getByTestId('farm-plot-g9'));
        expect(pressed('farm-plot-g7')).toBe('true');
        expect(pressed('farm-plot-g9')).toBe('true');
        expect(screen.queryByTestId('farm-solo-line')).toBeNull();
        expect(screen.getByTestId('farm-picked-count')).toHaveTextContent('१८ पैकी २ निवडले');
        fireEvent.click(screen.getByTestId('farm-plot-g7'));
        expect(screen.getByTestId('farm-solo-line')).toHaveTextContent('फक्त G9 दिसतो');
    });

    it('taking the only chosen plot off puts every plot back, never an empty page', () => {
        render(<Harness crops={FARM} />);
        fireEvent.click(screen.getByTestId('farm-plot-g7'));
        fireEvent.click(screen.getByTestId('farm-plot-g7'));
        for (const id of ids('g', 15)) expect(pressed(`farm-plot-${id}`)).toBe('true');
    });

    it('the solo line names the plot as the grid does; the other crop\'s plot shows as its full name', () => {
        render(<Harness crops={FARM} start={() => ({ crop: 'all', plotIds: ['c2'] })} />);
        expect(screen.getByTestId('farm-solo-line')).toHaveTextContent('फक्त ऊस S2 दिसतो');
    });

    it('picking one crop first keeps the rule: the crop\'s plots are all chosen and one tap shows one plot', () => {
        render(<Harness crops={FARM} />);
        fireEvent.click(screen.getByTestId('farm-crop-grape'));
        expect(screen.queryByTestId('farm-plot-c1')).toBeNull();
        fireEvent.click(screen.getByTestId('farm-plot-g12'));
        expect(screen.getByTestId('farm-solo-line')).toHaveTextContent('फक्त G12 दिसतो');
        expect(pressed('farm-plot-g1')).toBe('false');
    });
});

describe('quick buttons are true facts only', () => {
    const told9 = new Set(ids('g', 9));

    it('"आज सांगितलेले ९" and "आज बाकी ९" come from the plots told today; a tap picks exactly those plots', () => {
        render(<Harness crops={FARM} told={told9} />);
        expect(screen.getByTestId('farm-quick-toldToday')).toHaveTextContent('आज सांगितलेले ९');
        expect(screen.getByTestId('farm-quick-todayLeft')).toHaveTextContent('आज बाकी ९');
        fireEvent.click(screen.getByTestId('farm-quick-toldToday'));
        for (const id of ids('g', 9)) expect(pressed(`farm-plot-${id}`)).toBe('true');
        for (const id of [...ids('g', 15).slice(9), ...ids('c', 3)]) expect(pressed(`farm-plot-${id}`)).toBe('false');
        expect(pressed('farm-quick-toldToday')).toBe('true');
        expect(screen.getByTestId('farm-picked-count')).toHaveTextContent('१८ पैकी ९ निवडले');
        fireEvent.click(screen.getByTestId('farm-quick-todayLeft'));
        expect(pressed('farm-plot-g1')).toBe('false');
        expect(pressed('farm-plot-g10')).toBe('true');
        expect(pressed('farm-plot-c3')).toBe('true');
    });

    it('a button whose count is ० is not drawn (everything told: no "आज बाकी"; nothing told: no "आज सांगितलेले")', () => {
        const { unmount } = render(<Harness crops={FARM} told={new Set([...ids('g', 15), ...ids('c', 3)])} />);
        expect(screen.getByTestId('farm-quick-toldToday')).toHaveTextContent('आज सांगितलेले १८');
        expect(screen.queryByTestId('farm-quick-todayLeft')).toBeNull();
        unmount();
        render(<Harness crops={FARM} told={new Set<string>()} />);
        expect(screen.queryByTestId('farm-quick-toldToday')).toBeNull();
        expect(screen.getByTestId('farm-quick-todayLeft')).toHaveTextContent('आज बाकी १८');
    });

    it('on any day but today (no facts given) neither "today" button is drawn, and nothing invented takes their place', () => {
        render(<Harness crops={FARM} told={null} />);
        expect(screen.queryByTestId('farm-quick-toldToday')).toBeNull();
        expect(screen.queryByTestId('farm-quick-todayLeft')).toBeNull();
        expect(screen.getByTestId('farm-plots-all')).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/अलीकडचे|उशीर|कालचेच/);
    });
});

describe('small farms look and behave as before', () => {
    it('2 plots and 1 plot: chips with full names, no quick row, no solo line, and a tap with all chosen takes that plot OFF', () => {
        render(<Harness crops={CROPS} told={new Set(['g1'])} />);
        expect(screen.getByTestId('farm-plots')).toHaveAttribute('data-many', 'no');
        expect(screen.queryByTestId('farm-plots-all')).toBeNull();
        expect(screen.queryByTestId('farm-quick-toldToday')).toBeNull();
        expect(screen.getByTestId('farm-plot-g1')).toHaveTextContent('सोनाका');
        expect(screen.getByTestId('farm-plot-c1')).toHaveTextContent('ऊस १');
        fireEvent.click(screen.getByTestId('farm-plot-g1'));
        expect(pressed('farm-plot-g1')).toBe('false');
        expect(pressed('farm-plot-g2')).toBe('true');
        expect(screen.queryByTestId('farm-solo-line')).toBeNull();
        expect(screen.queryByTestId('farm-picked-count')).toBeNull();
    });

    it('the one-plot crop on its own: its plot is chosen, nothing to choose between', () => {
        render(<Harness crops={[CANE]} />);
        expect(pressed('farm-plot-c1')).toBe('true');
    });
});
