// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, founder pick Log A "number grid with quick buttons")
 *
 * The log's "which plot did the work" step for an owner with many plots of one crop (also planning, the task-done sheet and the place
 * picker, which draw this same stepper): a number grid from 7 plots, the "सगळे" toggle also for ONE crop, true quick buttons only, one count
 * line above the mic, the crop's photo once in a header when several crops are on screen. 1 to 6 plots look and behave as before.
 */
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CropSelector from '../CropSelector';
import type { StepperExtras } from '../CropPlotStepper';
import type { CropProfile } from '../../../../types';
import { getTodayKey, getYesterdayKey } from '../../../../core/domain/services/DateKeyService';
import { toDevanagariDigits } from '../../../../shared/utils/marathiDigits';

// The phone's work records: the test decides what the date index returns (or that it cannot be read).
const store: { byDate: Record<string, unknown[]>; broken: boolean } = { byDate: {}, broken: false };
vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => {
        if (store.broken) throw new Error('no database');
        return { logs: { where: () => ({ equals: ([date]: [string, number]) => ({ toArray: async () => store.byDate[date] ?? [] }) }) } };
    },
}));

const crop = (id: string, name: string, iconName: string, color: string, plots: string[]) =>
    ({ id, name, iconName, color, plots: plots.map((n, i) => ({ id: `${id}-${i + 1}`, name: n })) }) as unknown as CropProfile;
const grapes = (n: number) => crop('grape', 'द्राक्ष', 'Grape', 'bg-green-500', Array.from({ length: n }, (_, i) => `द्राक्ष G${i + 1}`));
const cane = (n: number) => crop('cane', 'ऊस', 'Sugarcane', 'bg-pink-500', Array.from({ length: n }, (_, i) => `ऊस S${i + 1}`));
const record = (date: string, plotIds: string[]) => ({ date, isDeleted: 0, log: { date, context: { selection: [{ cropId: 'grape', selectedPlotIds: plotIds }] } } });

beforeEach(() => { store.byDate = {}; store.broken = false; });
afterEach(cleanup);

const Harness: React.FC<{ crops: CropProfile[]; first: string[]; onChange?: (c: string[], p: Record<string, string[]>) => void; stepper?: StepperExtras; plots?: Record<string, string[]> }> = ({ crops, first, onChange, stepper, plots: startPlots }) => {
    const [sel, setSel] = useState<string[]>(first);
    const [plots, setPlots] = useState<Record<string, string[]>>(startPlots ?? Object.fromEntries(first.map(id => [id, []])));
    return (
        <CropSelector mode="log" layout="stepper" crops={crops} selectedCrops={sel} selectedPlots={plots}
            onSelectionChange={(c, p) => { setSel(c); setPlots(p); onChange?.(c, p); }}
            stepper={{ footer: <div data-testid="the-mic" />, labels: { selectedCrop: 'CHOSEN-CROP', addCrop: 'ADD', allPlots: 'ALL-PLOTS' }, ...stepper }} />
    );
};
const part = (el: HTMLElement, name: string) => el.querySelector(`[data-part="${name}"]`);
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

describe('one crop with many plots: the number grid, and the "सगळे" button that used to be hidden for one crop', () => {
    it('15 plots are a grid of numbers in Devanagari digits with the plot\'s own short name under each; the crop word is dropped', async () => {
        render(<Harness crops={[grapes(15)]} first={['grape']} stepper={{ workFacts: null }} />);
        await flush();
        expect(screen.getByTestId('flow-plot-list')).toHaveAttribute('data-layout', 'sections');
        const box = screen.getByTestId('flow-plot-grape-7');
        expect(part(box, 'number')).toHaveTextContent('७');
        expect(part(box, 'name')).toHaveTextContent('G7');
        expect(box.textContent).not.toMatch(/द्राक्ष/);
        expect(part(box, 'number')?.textContent).not.toMatch(/[0-9]/); // the number is Devanagari; "G7" is the plot's own stored name, shown as it is
        // 15 boxes in one grid, none of them carrying a crop photo
        expect(screen.getByTestId('flow-plot-grid').children.length).toBe(15);
        expect(screen.getByTestId('flow-plot-grid').querySelector('img')).toBeNull();
    });

    it('with ONE crop and 7 or more plots the "all" button shows (it was hidden for one crop), and it chooses all and then clears all', async () => {
        const onChange = vi.fn();
        render(<Harness crops={[grapes(15)]} first={['grape']} onChange={onChange} stepper={{ workFacts: null }} />);
        await flush();
        const all = screen.getByTestId('flow-plots-all');
        expect(all).toHaveTextContent('सगळे निवडा १५');
        fireEvent.click(all);
        expect(onChange).toHaveBeenLastCalledWith(['grape'], { grape: Array.from({ length: 15 }, (_, i) => `grape-${i + 1}`) });
        expect(screen.getByTestId('flow-plots-all')).toHaveTextContent('सगळे निवडले');
        expect(screen.getByTestId('the-mic')).toBeTruthy();
        fireEvent.click(screen.getByTestId('flow-plots-all'));
        expect(onChange).toHaveBeenLastCalledWith(['grape'], { grape: [] });
        expect(screen.queryByTestId('the-mic')).toBeNull();
    });

    it('a tap reports the same selection shape as before (crops, plots by crop, in tap order) and the chosen box is dark green with a white tick', async () => {
        const onChange = vi.fn();
        render(<Harness crops={[grapes(15)]} first={['grape']} onChange={onChange} stepper={{ workFacts: null }} />);
        await flush();
        fireEvent.click(screen.getByTestId('flow-plot-grape-9'));
        fireEvent.click(screen.getByTestId('flow-plot-grape-3'));
        expect(onChange).toHaveBeenLastCalledWith(['grape'], { grape: ['grape-9', 'grape-3'] });
        const on = screen.getByTestId('flow-plot-grape-9');
        expect(on).toHaveAttribute('aria-pressed', 'true');
        expect(on.className).toContain('bg-emerald-800');
        expect(part(on, 'tick')).toBeTruthy();
        expect(screen.getByTestId('flow-plot-grape-1')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByTestId('flow-plot-grape-9'));
        expect(onChange).toHaveBeenLastCalledWith(['grape'], { grape: ['grape-3'] });
    });

    it('one count sentence "१५ पैकी ४ निवडले" sits above the mic and follows the taps', async () => {
        render(<Harness crops={[grapes(15)]} first={['grape']} plots={{ grape: ['grape-1', 'grape-2', 'grape-3', 'grape-4'] }} stepper={{ workFacts: null }} />);
        await flush();
        expect(screen.getByTestId('flow-picked-count')).toHaveTextContent('१५ पैकी ४ निवडले');
        fireEvent.click(screen.getByTestId('flow-plot-grape-5'));
        expect(screen.getByTestId('flow-picked-count')).toHaveTextContent('१५ पैकी ५ निवडले');
        const mic = screen.getByTestId('flow-mic-slot');
        expect(screen.getByTestId('flow-picked-count').compareDocumentPosition(mic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('Sathi\'s mark ("आत्ता इथे") stays as a small tag on the box, and nothing is chosen for him', async () => {
        render(<Harness crops={[grapes(15)]} first={['grape']} stepper={{ workFacts: null, marked: { plotIds: ['grape-4'], label: 'आत्ता इथे' } }} />);
        await flush();
        expect(screen.getByTestId('flow-plot-grape-4')).toContainElement(screen.getByTestId('flow-plot-mark-grape-4'));
        expect(screen.getByTestId('flow-plot-mark-grape-4')).toHaveTextContent('आत्ता इथे');
        expect(screen.getByTestId('flow-plot-grape-4')).toHaveAttribute('aria-pressed', 'false');
    });

    it('25 plots add a search box that finds a plot by a Devanagari or a Latin digit', async () => {
        render(<Harness crops={[grapes(30)]} first={['grape']} stepper={{ workFacts: null }} />);
        await flush();
        const search = screen.getByTestId('flow-plot-search');
        fireEvent.change(search, { target: { value: '१२' } });
        expect(screen.getByTestId('flow-plot-grape-12')).toBeTruthy();
        expect(screen.queryByTestId('flow-plot-grape-1')).toBeNull();
        fireEvent.change(search, { target: { value: '12' } });
        expect(screen.getByTestId('flow-plot-grape-12')).toBeTruthy();
        expect(screen.queryByTestId('flow-plot-grape-2')).toBeNull();
    });
});

describe('natural number order (G2 before G10) on the log\'s plot step', () => {
    const scrambled = (n: number) => crop('grape', 'द्राक्ष', 'Grape', 'bg-green-500', ['G10', 'G2', 'G1', 'G11', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G12', 'G13', 'G14', 'G15'].slice(0, n).map(g => `द्राक्ष ${g}`));

    it('the number grid lists the plots in number order and every box reads G<n> with the number n (the CTO\'s G3 with १४ case), two-digit ones included', async () => {
        render(<Harness crops={[scrambled(15)]} first={['grape']} stepper={{ workFacts: null }} />);
        await flush();
        const boxes = [...screen.getByTestId('flow-plot-grid').children] as HTMLElement[];
        const names = boxes.map(c => part(c, 'name')?.textContent);
        expect(names.slice(0, 4)).toEqual(['G1', 'G2', 'G3', 'G4']);
        expect(names.slice(-3)).toEqual(['G13', 'G14', 'G15']);
        expect(names.indexOf('G10')).toBe(9);
        boxes.forEach((box, i) => {
            expect(part(box, 'name')).toHaveTextContent(`G${i + 1}`);
            expect(part(box, 'number')?.textContent).toBe(toDevanagariDigits(String(i + 1)));
        });
        expect(part(screen.getByTestId('flow-plot-grape-3'), 'number')).toHaveTextContent('१'); // G1 is stored third but reads १
    });

    it('the chips of a small crop (flat list) are in number order too, with the full names as before', () => {
        render(<Harness crops={[crop('grape', 'द्राक्ष', 'Grape', 'bg-green-500', ['द्राक्ष G10', 'द्राक्ष G2', 'द्राक्ष G1'])]} first={['grape']} />);
        const order = [...screen.getByTestId('flow-plot-list').children].map(c => c.textContent);
        expect(order).toEqual(['द्राक्ष G1', 'द्राक्ष G2', 'द्राक्ष G10']);
    });

    it('compare\'s classic look keeps the farm\'s own order until its lane', () => {
        render(<Harness crops={[crop('grape', 'द्राक्ष', 'Grape', 'bg-green-500', ['द्राक्ष G10', 'द्राक्ष G2', 'द्राक्ष G1'])]} first={['grape']} stepper={{ look: 'classic' }} />);
        const order = [...screen.getByTestId('flow-plot-list').children].map(c => c.textContent);
        expect(order).toEqual(['द्राक्ष G10', 'द्राक्ष G2', 'द्राक्ष G1']);
    });
});

describe('small crops look and behave as before', () => {
    it('6 plots of one crop are chips as before: no grid, no "all" button, no count line, full names', () => {
        render(<Harness crops={[grapes(6)]} first={['grape']} />);
        expect(screen.getByTestId('flow-plot-list')).not.toHaveAttribute('data-layout');
        expect(screen.queryByTestId('flow-plots-all')).toBeNull();
        expect(screen.queryByTestId('flow-picked-count')).toBeNull();
        expect(screen.getByTestId('flow-plot-grape-3')).toHaveTextContent('द्राक्ष G3');
        expect(part(screen.getByTestId('flow-plot-grape-3'), 'dot')?.className).toContain('bg-green-500');
        expect(screen.getByTestId('flow-plot-grape-3').className).toMatch(/min-h-\[5\dpx\]/);
    });

    it('7 plots are the smallest grid; 6 are not (the threshold is the module\'s)', async () => {
        const { unmount } = render(<Harness crops={[grapes(7)]} first={['grape']} stepper={{ workFacts: null }} />);
        await flush();
        expect(screen.getByTestId('flow-plots-all')).toBeTruthy();
        unmount();
        render(<Harness crops={[grapes(6)]} first={['grape']} />);
        expect(screen.queryByTestId('flow-plots-all')).toBeNull();
    });
});

describe('quick buttons: only what the phone knows', () => {
    it('"कालचेच ४" and "आज बाकी ६" from the facts given, each choosing exactly its plots', async () => {
        const onChange = vi.fn();
        const ids = Array.from({ length: 15 }, (_, i) => `grape-${i + 1}`);
        render(<Harness crops={[grapes(15)]} first={['grape']} onChange={onChange}
            stepper={{ workFacts: { yesterday: new Set(['grape-3', 'grape-4', 'grape-7', 'grape-8']), today: new Set(ids.slice(0, 9)) } }} />);
        await flush();
        expect(screen.getByTestId('flow-quick-yesterday')).toHaveTextContent('कालचेच ४');
        expect(screen.getByTestId('flow-quick-todayLeft')).toHaveTextContent('आज बाकी ६');
        fireEvent.click(screen.getByTestId('flow-quick-yesterday'));
        expect(onChange).toHaveBeenLastCalledWith(['grape'], { grape: ['grape-3', 'grape-4', 'grape-7', 'grape-8'] });
        fireEvent.click(screen.getByTestId('flow-quick-todayLeft'));
        expect(onChange).toHaveBeenLastCalledWith(['grape'], { grape: ids.slice(9) });
    });

    it('a button whose count is ० is not drawn, "अलीकडचे" is never drawn, and nothing says "उशीर"', async () => {
        render(<Harness crops={[grapes(15)]} first={['grape']} stepper={{ workFacts: { yesterday: new Set<string>(), today: new Set(Array.from({ length: 15 }, (_, i) => `grape-${i + 1}`)) } }} />);
        await flush();
        expect(screen.queryByTestId('flow-quick-yesterday')).toBeNull();
        expect(screen.queryByTestId('flow-quick-todayLeft')).toBeNull();
        expect(screen.getByTestId('flow-plots-all')).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/अलीकडचे|उशीर/);
    });

    it('with no facts given the stepper reads the phone\'s own records by date (yesterday and today), and counts only this crop\'s plots', async () => {
        store.byDate[getYesterdayKey()] = [record(getYesterdayKey(), ['grape-2', 'grape-5']), record(getYesterdayKey(), ['grape-5', 'other-plot'])];
        store.byDate[getTodayKey()] = [record(getTodayKey(), ['grape-1'])];
        render(<Harness crops={[grapes(15)]} first={['grape']} />);
        await waitFor(() => expect(screen.getByTestId('flow-quick-yesterday')).toBeTruthy());
        expect(screen.getByTestId('flow-quick-yesterday')).toHaveTextContent('कालचेच २');
        expect(screen.getByTestId('flow-quick-todayLeft')).toHaveTextContent('आज बाकी १४');
    });

    it('records that cannot be read draw no quick button at all (never a guess), and the grid and "सगळे" still work', async () => {
        store.broken = true;
        render(<Harness crops={[grapes(15)]} first={['grape']} />);
        await flush();
        expect(screen.queryByTestId('flow-quick-yesterday')).toBeNull();
        expect(screen.queryByTestId('flow-quick-todayLeft')).toBeNull();
        expect(screen.getByTestId('flow-plots-all')).toBeTruthy();
        expect(screen.getByTestId('flow-plot-grape-1')).toBeTruthy();
    });

    it('a small crop never reads the records at all', async () => {
        store.byDate[getTodayKey()] = [record(getTodayKey(), ['grape-1'])];
        render(<Harness crops={[grapes(5)]} first={['grape']} />);
        await flush();
        expect(screen.queryByTestId('flow-quick-todayLeft')).toBeNull();
    });
});

describe('several crops on one log: the photo once per big crop', () => {
    it('15 grape plots get one header with the crop photo, count and a grid; 3 cane plots stay chips that keep their small crop photo', async () => {
        render(<Harness crops={[grapes(15), cane(3)]} first={['grape', 'cane']} plots={{ grape: ['grape-1', 'grape-2'], cane: ['cane-1'] }} stepper={{ workFacts: null }} />);
        await flush();
        const header = screen.getByTestId('flow-crop-header-grape');
        expect(header.querySelector('img, svg')).toBeTruthy();
        expect(header).toHaveTextContent('द्राक्ष');
        expect(screen.getByTestId('flow-crop-count-grape')).toHaveTextContent('१५ पैकी २ निवडले');
        // the grape boxes carry no photo and no crop word
        expect(screen.getByTestId('flow-plot-grid-grape').querySelector('img')).toBeNull();
        expect(part(screen.getByTestId('flow-plot-grape-7'), 'name')).toHaveTextContent('G7');
        // cane: 3 plots, no header, chips with the small crop photo and the full name, as before
        expect(screen.getByTestId('flow-crop-section-cane')).toHaveAttribute('data-header', 'no');
        expect(screen.queryByTestId('flow-crop-header-cane')).toBeNull();
        expect(screen.getByTestId('flow-plot-cane-1')).toHaveTextContent('ऊस S1');
        expect(screen.getByTestId('flow-plot-cane-1').querySelector('img, svg:not([data-part="tick"])')).toBeTruthy();
        // one total count line above the mic
        expect(screen.getByTestId('flow-picked-count')).toHaveTextContent('१८ पैकी ३ निवडले');
        // the per-crop toggle has its own id (the multi-crop "all plots" button keeps its own)
        expect(screen.getByTestId('flow-plots-all-grape')).toBeTruthy();
    });

    it('a crop of 4 to 6 plots next to another crop gets the header and plain chips without a photo each', async () => {
        render(<Harness crops={[grapes(5), cane(3)]} first={['grape', 'cane']} plots={{ grape: ['grape-1'], cane: [] }} />);
        await flush();
        expect(screen.getByTestId('flow-crop-header-grape')).toBeTruthy();
        const chip = screen.getByTestId('flow-plot-grape-2');
        expect(chip).toHaveTextContent('G2');
        expect(chip.querySelector('img')).toBeNull();
        expect(screen.queryByTestId('flow-plot-grid-grape')?.children.length).toBe(5);
        // no number grid for 5 plots: chips
        expect(screen.queryByTestId('flow-plots-all-grape')).toBeNull();
    });
});
