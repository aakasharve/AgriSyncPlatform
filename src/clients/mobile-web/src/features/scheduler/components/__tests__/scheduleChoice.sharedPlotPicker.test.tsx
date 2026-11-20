// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 4; founder 2026-11-21)
 *
 * Choosing a schedule: the library's step 1 and the editor ask "which plot?" with the shared pieces - the crop row (each crop's photo once) and
 * the plot selector (chips for 1 to 6 plots, a number grid from 7, every number the plot's place among ALL the crop's plots, Marathi digits) -
 * and the chosen schedule row is THE one chosen look (dark green, white letters, a white tick) in both views. Rendered directly over a farm of
 * 15 grape plots (stored in a scrambled order) and 3 sugarcane plots, so the grid and the chips are both in view; the same views over the real
 * page are pinned in `SchedulerPage.libraryThreeSteps.test.tsx` and `SchedulerPage.keptFeatures.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import ScheduleLibraryView, { type LibraryPlotOption } from '../ScheduleLibraryView';
import ScheduleMaker from '../ScheduleMaker';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import type { CropProfile } from '../../../../types';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, SPRAY_TEMPLATE_ID, TEMPLATE_ID, crop as cropFixture, plot as plotFixture } from '../../schedulePage/__tests__/scheduleFixtures';

beforeEach(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));
afterEach(cleanup);

const part = (el: HTMLElement, name: string) => el.querySelector(`[data-part="${name}"]`);
const STORED_ORDER = [10, 3, 15, 1, 12, 7, 2, 14, 5, 9, 11, 4, 13, 6, 8]; // the farm stored the grape plots in no particular order
const DEVANAGARI = ['१', '२', '३', '४', '५', '६', '७', '८', '९', '१०', '११', '१२', '१३', '१४', '१५'];

// ── the library ──────────────────────────────────────────────────────────────────────────────────────

const GRAPE = { cropId: 'crop-g', cropName: 'द्राक्ष', cropRawName: 'Grapes', iconName: 'grape', color: 'bg-purple-500' };
const CANE = { cropId: 'crop-u', cropName: 'ऊस', cropRawName: 'Sugarcane', iconName: 'sugarcane', color: 'bg-pink-500' };
const grapeOptions: LibraryPlotOption[] = STORED_ORDER.map(n => ({ ...GRAPE, id: `g${n}`, name: `G${n}` }));
const caneOptions: LibraryPlotOption[] = [1, 2, 3].map(n => ({ ...CANE, id: `u${n}`, name: `U${n}` }));
const profile = (c: typeof GRAPE): CropProfile => ({ id: c.cropId, name: c.cropRawName, iconName: c.iconName, color: c.color, plots: [], activeScheduleId: null, supportedTasks: [], workflow: [] } as CropProfile);

const Library: React.FC<{ farm?: 'both' | 'grapes'; start: string; onPick?: (cropId: string, plotId: string) => void; language?: 'mr' | 'en' }> = ({ farm = 'both', start, onPick, language = 'mr' }) => {
    const [plotId, setPlotId] = useState(start);
    const options = farm === 'grapes' ? grapeOptions : [...grapeOptions, ...caneOptions];
    const allCrops = farm === 'grapes' ? [profile(GRAPE)] : [profile(GRAPE), profile(CANE)];
    const active = options.find(o => o.id === plotId);
    return (
        <ScheduleLibraryView crop={allCrops.find(c => c.id === active?.cropId)} allCrops={allCrops} onAdopt={vi.fn()} plots={options} plotId={plotId} language={language}
            onPickPlot={(cropId, id) => { onPick?.(cropId, id); setPlotId(id); }} />
    );
};

const gridNumbers = () => [...screen.getByTestId('library-plot-grid').children].map(c => part(c as HTMLElement, 'number')?.textContent);

describe('library step 1: the crop row and the shared plot selector', () => {
    it('each crop is drawn ONCE in the crop row (not one photo per plot); 15 grape plots are a number grid and only the chosen crop\'s plots show', () => {
        render(<Library start="g1" />);
        const row = screen.getByTestId('library-crops');
        expect(within(row).getAllByRole('button')).toHaveLength(2); // grapes and sugarcane, one tile each - 18 plots, 2 photos
        expect(screen.getByTestId('library-crop-crop-g')).toHaveTextContent('द्राक्ष');
        expect(screen.getByTestId('library-crop-crop-u')).toHaveTextContent('ऊस');
        expect(screen.getByTestId('library-plot-grid').parentElement).toHaveAttribute('data-mode', 'grid');
        expect(screen.getByTestId('library-plot-grid').children).toHaveLength(15);
        expect(screen.queryByTestId('library-plot-u1')).toBeNull();
        // the old one-chip-per-plot "द्राक्ष · G1" text is gone
        expect(screen.getByTestId('library-plots').textContent).not.toContain('द्राक्ष · G');
        expect(screen.queryByTestId('library-crop-header')).toBeNull(); // the row already says the crop
    });

    it('every number is the plot\'s place among ALL the crop\'s plots, in Marathi digits, two-digit numbers whole - whatever order the farm stored them in', () => {
        render(<Library start="g1" />);
        expect(gridNumbers()).toEqual(DEVANAGARI);
        for (let n = 1; n <= 15; n++) {
            const box = screen.getByTestId(`library-plot-g${n}`); // the test id the page and its tests already use
            expect(part(box, 'name')).toHaveTextContent(`G${n}`);
            expect(part(box, 'number')?.textContent).toBe(DEVANAGARI[n - 1]);
        }
    });

    it('the plot the page is on is the ONE chosen box - dark green, white letters, a white tick; a tap reports (crop id, plot id) and the choice moves', () => {
        const onPick = vi.fn();
        render(<Library start="g3" onPick={onPick} />);
        const on = screen.getByTestId('library-plot-g3');
        expect(on).toHaveAttribute('aria-pressed', 'true');
        expect(on.className).toContain('bg-emerald-800');
        expect(on.className).toContain('text-white');
        expect(part(on, 'tick')).toBeTruthy();
        expect(screen.getByTestId('library-plot-g4').className).toContain('bg-white');
        fireEvent.click(screen.getByTestId('library-plot-g12'));
        expect(onPick).toHaveBeenLastCalledWith('crop-g', 'g12');
        expect(screen.getByTestId('library-plot-g12')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('library-plot-g3')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('library-plots').querySelectorAll('[data-testid^="library-plot-g"][aria-pressed="true"]')).toHaveLength(1);
    });

    it('a tap on another crop picks that crop\'s first plot in number order (G1, not the stored first G10); 3 plots are chips, with the same test ids', () => {
        const onPick = vi.fn();
        render(<Library start="u2" onPick={onPick} />);
        expect(screen.getByTestId('library-plot-grid').parentElement).toHaveAttribute('data-mode', 'chips');
        for (const id of ['u1', 'u2', 'u3']) expect(screen.getByTestId(`library-plot-${id}`)).toBeTruthy();
        expect(screen.getByTestId('library-plot-u2')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('library-plot-g1')).toBeNull();
        fireEvent.click(screen.getByTestId('library-crop-crop-g'));
        expect(onPick).toHaveBeenLastCalledWith('crop-g', 'g1');
        expect(screen.getByTestId('library-plot-g1')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('library-crop-crop-g')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('library-plot-u2')).toBeNull();
    });

    it('a tap on the crop that is already chosen keeps its plot', () => {
        const onPick = vi.fn();
        render(<Library start="g7" onPick={onPick} />);
        fireEvent.click(screen.getByTestId('library-crop-crop-g'));
        expect(onPick).not.toHaveBeenCalled();
        expect(screen.getByTestId('library-plot-g7')).toHaveAttribute('aria-pressed', 'true');
    });

    it('with ONE crop on the farm there is no crop row to choose from: its photo and name stand once in a header with "१५ प्लॉट"', () => {
        render(<Library farm="grapes" start="g1" />);
        expect(screen.queryByTestId('library-crops')).toBeNull();
        const header = screen.getByTestId('library-crop-header');
        expect(header).toHaveTextContent('द्राक्ष');
        expect(header).toHaveTextContent('१५ प्लॉट');
        expect(gridNumbers()).toEqual(DEVANAGARI);
    });

    it('English mode: Latin digits and English words, the same layout', () => {
        render(<Library farm="grapes" start="g1" language="en" />);
        expect(screen.getByTestId('library-crop-header')).toHaveTextContent('Grapes');
        expect(screen.getByTestId('library-crop-header')).toHaveTextContent('15 plots');
        expect(gridNumbers()[11]).toBe('12');
    });
});

describe('library step 2: the picked schedule row is the one chosen look', () => {
    it('dark green, white letters (the small lines too), a white tick; a row not picked stays white with its grey border; no blue ring or blue dot', () => {
        render(<Library start="g1" />);
        const first = screen.getByTestId(`library-${TEMPLATE_ID}`);
        const second = screen.getByTestId(`library-${SPRAY_TEMPLATE_ID}`);
        for (const row of [first, second]) {
            expect(row).toHaveAttribute('data-picked', 'no');
            expect(row.className).toContain('border-stone-200');
            expect(row.className).toContain('bg-white');
            expect(part(row, 'tick')).toBeNull();
        }
        fireEvent.click(screen.getByTestId(`library-pick-${TEMPLATE_ID}`));
        expect(first).toHaveAttribute('data-picked', 'yes');
        expect(first.className).toContain('border-emerald-800');
        expect(first.className).toContain('bg-emerald-800');
        expect(first.className).toContain('text-white');
        expect(first.className).not.toMatch(/1448E6|blue-50|bg-white/);
        expect(part(first, 'tick')?.querySelector('svg')?.getAttribute('class')).toContain('text-white');
        expect(part(first, 'tick')?.className).toContain('border-white');
        // every line of words inside the chosen row is white, the small ones included
        // (the name, "कोणी बनवलं", the days line and the sample line; ShramSafal's check badge brings its own dark-green tone)
        const lines = [...first.querySelectorAll('label span.block')] as HTMLElement[];
        expect(lines.length).toBeGreaterThanOrEqual(4);
        for (const line of lines) expect(line.className).toContain('text-white');
        expect(screen.getByTestId(`library-name-${TEMPLATE_ID}`).className).toContain('text-white');
        expect(screen.getByTestId(`library-name-${TEMPLATE_ID}`).className).not.toContain('text-stone-900');
        // the other row did not change
        expect(second.className).toContain('bg-white');
        expect(part(second, 'tick')).toBeNull();
        // picking the other one moves the look
        fireEvent.click(screen.getByTestId(`library-pick-${SPRAY_TEMPLATE_ID}`));
        expect(second.className).toContain('bg-emerald-800');
        expect(first.className).toContain('bg-white');
        expect(part(first, 'tick')).toBeNull();
    });

    it('the "पाहा" button inside a chosen row stays a white button with dark letters (it is a button, not a line of words)', () => {
        render(<Library start="g1" />);
        fireEvent.click(screen.getByTestId(`library-pick-${TEMPLATE_ID}`));
        const view = screen.getByTestId(`library-view-${TEMPLATE_ID}`);
        expect(view.className).toContain('bg-white');
        expect(view.className).toContain('text-stone-800');
    });
});

// ── the editor ───────────────────────────────────────────────────────────────────────────────────────

const edPlot = (id: string, name: string) => plotFixture({ id, name, startDate: REF, schedule: { ...plotFixture().schedule, id: `sch-${id}`, plotId: id } });
const grapeCrop = (): CropProfile => cropFixture(STORED_ORDER.map(n => edPlot(`p${n}`, `G${n}`)), { id: 'crop-1', name: 'Grapes', color: 'bg-purple-500', activeScheduleId: TEMPLATE_ID });
const caneCrop = (): CropProfile => cropFixture([1, 2, 3].map(n => edPlot(`c${n}`, `U${n}`)), { id: 'crop-2', name: 'Sugarcane', iconName: 'sugarcane', color: 'bg-pink-500', activeScheduleId: null });
const plotNameLine = () => screen.getByTestId('editor-plot-name').textContent;

const Editor: React.FC<{ crops: CropProfile[]; cropId?: string; plotId?: string }> = ({ crops, cropId = crops[0].id, plotId = crops[0].plots[0].id }) => (
    <ScheduleMaker crops={crops} initialCropId={cropId} initialPlotId={plotId} todayKey="2026-10-26" onSave={vi.fn()} />
);

describe('the editor: the crop row and the shared plot selector', () => {
    it('two crops: the crop row, then the chosen crop\'s 15 plots as a number grid with Marathi digits; every plot keeps its editor-plot-<id> test id', () => {
        render(<Editor crops={[grapeCrop(), caneCrop()]} plotId="p9" />);
        expect(within(screen.getByTestId('editor-plot-card')).getAllByTestId(/^editor-crop-crop-/)).toHaveLength(2); // one tile per crop
        expect(screen.getByTestId('editor-plot-grid').parentElement).toHaveAttribute('data-mode', 'grid');
        const numbers = [...screen.getByTestId('editor-plot-grid').children].map(c => part(c as HTMLElement, 'number')?.textContent);
        expect(numbers).toEqual(DEVANAGARI);
        for (let n = 1; n <= 15; n++) expect(screen.getByTestId(`editor-plot-p${n}`)).toBeTruthy();
        expect(screen.queryByTestId('editor-plot-c1')).toBeNull(); // the other crop's plots are not drawn
        expect(screen.getByTestId('editor-plot-p9')).toHaveAttribute('aria-pressed', 'true');
        expect(plotNameLine()).toBe('द्राक्ष · G9');
    });

    it('a tap on a plot makes it the one chosen plot (dark green, white tick) and the plot line follows', () => {
        render(<Editor crops={[grapeCrop(), caneCrop()]} plotId="p9" />);
        fireEvent.click(screen.getByTestId('editor-plot-p12'));
        expect(plotNameLine()).toBe('द्राक्ष · G12');
        const on = screen.getByTestId('editor-plot-p12');
        expect(on).toHaveAttribute('aria-pressed', 'true');
        expect(on.className).toContain('bg-emerald-800');
        expect(part(on, 'tick')).toBeTruthy();
        expect(screen.getByTestId('editor-plot-p9')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('editor-plot-card').querySelectorAll('[data-testid^="editor-plot-p"][aria-pressed="true"]')).toHaveLength(1);
    });

    it('a tap on another crop picks that crop\'s first plot in number order and shows its 3 plots as chips; back on grapes it is G1, not the stored first G10', () => {
        render(<Editor crops={[grapeCrop(), caneCrop()]} plotId="p9" />);
        fireEvent.click(screen.getByTestId('editor-crop-crop-2'));
        expect(plotNameLine()).toBe('ऊस · U1');
        expect(screen.getByTestId('editor-plot-grid').parentElement).toHaveAttribute('data-mode', 'chips');
        for (const id of ['c1', 'c2', 'c3']) expect(screen.getByTestId(`editor-plot-${id}`)).toBeTruthy();
        expect(screen.getByTestId('editor-plot-c1')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('editor-crop-crop-1'));
        expect(plotNameLine()).toBe('द्राक्ष · G1');
        expect(screen.getByTestId('editor-plot-p1')).toHaveAttribute('aria-pressed', 'true');
    });

    it('a tap on the crop that is already chosen keeps its plot', () => {
        render(<Editor crops={[grapeCrop(), caneCrop()]} plotId="p7" />);
        fireEvent.click(screen.getByTestId('editor-crop-crop-1'));
        expect(plotNameLine()).toBe('द्राक्ष · G7');
        expect(screen.getByTestId('editor-plot-p7')).toHaveAttribute('aria-pressed', 'true');
    });

    it('ONE crop with many plots: no crop row, its photo once in a header with "१५ प्लॉट", then the number grid', () => {
        render(<Editor crops={[grapeCrop()]} plotId="p4" />);
        expect(screen.queryByTestId('editor-crop-crop-1')).toBeNull();
        const header = screen.getByTestId('editor-crop-header');
        expect(header).toHaveTextContent('द्राक्ष');
        expect(header).toHaveTextContent('१५ प्लॉट');
        expect(screen.getByTestId('editor-plot-grid').children).toHaveLength(15);
        expect(screen.getByTestId('editor-plot-p4')).toHaveAttribute('aria-pressed', 'true');
    });

    it('ONE crop with two plots (the small farm): just its two chips, as before - no header, no crop row', () => {
        render(<Editor crops={[cropFixture([edPlot('plot-1', 'A'), edPlot('plot-2', 'B')])]} />);
        expect(screen.queryByTestId('editor-crop-header')).toBeNull();
        expect(screen.getByTestId('editor-plot-grid').parentElement).toHaveAttribute('data-mode', 'chips');
        expect(screen.getByTestId('editor-plot-plot-1')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('editor-plot-plot-2'));
        expect(plotNameLine()).toBe('द्राक्ष · B');
    });

    it('ONE crop with ONE plot: nothing to choose, so nothing is drawn (the plot line still says it)', () => {
        render(<Editor crops={[cropFixture([edPlot('plot-1', 'A')])]} />);
        expect(screen.queryByTestId('editor-plot-grid')).toBeNull();
        expect(screen.queryByTestId('editor-crop-header')).toBeNull();
        expect(plotNameLine()).toBe('द्राक्ष · A');
    });
});

describe('the editor: the chosen schedule row is the one chosen look', () => {
    it('dark green, white letters, a white tick - in place of the green ring and the green "निवडलं" chip; the other row is white with the grey ring', () => {
        render(<Editor crops={[grapeCrop(), caneCrop()]} plotId="p1" />);
        const on = screen.getByTestId(`editor-schedule-${TEMPLATE_ID}`); // the schedule G1 follows now
        const off = screen.getByTestId(`editor-schedule-${SPRAY_TEMPLATE_ID}`);
        expect(on).toHaveAttribute('aria-pressed', 'true');
        expect(on.className).toContain('bg-emerald-800');
        expect(on.className).toContain('text-white');
        expect(on.className).not.toMatch(/ring-emerald-600|bg-white/);
        expect(part(on, 'tick')?.querySelector('svg')?.getAttribute('class')).toContain('text-white');
        expect(part(on, 'tick')?.className).toContain('border-white');
        for (const line of [...on.querySelectorAll('span.block')]) expect(line.className).toContain('text-white'); // the name and both small lines
        expect(on.querySelector('span.block')?.className).not.toContain('text-stone-900');
        // the green chip with its word is gone: the word is only for a screen reader, inside the tick
        expect(on.querySelector('.bg-emerald-100, .bg-emerald-50')).toBeNull();
        expect(on.querySelector('.sr-only')).toHaveTextContent('निवडलं');
        expect(off).toHaveAttribute('aria-pressed', 'false');
        expect(off.className).toContain('bg-white');
        expect(off.className).toContain('ring-stone-300');
        expect(part(off, 'tick')).toBeNull();
        expect(off.textContent).not.toContain('निवडलं');
    });

    it('picking the other schedule moves the chosen look to it (and the "only this plot" line shows for the plot it would change)', () => {
        render(<Editor crops={[grapeCrop(), caneCrop()]} plotId="p1" />);
        fireEvent.click(screen.getByTestId(`editor-schedule-${SPRAY_TEMPLATE_ID}`));
        const now = screen.getByTestId(`editor-schedule-${SPRAY_TEMPLATE_ID}`);
        expect(now.className).toContain('bg-emerald-800');
        expect(part(now, 'tick')).toBeTruthy();
        const before = screen.getByTestId(`editor-schedule-${TEMPLATE_ID}`);
        expect(before.className).toContain('bg-white');
        expect(part(before, 'tick')).toBeNull();
        expect(screen.getByTestId('editor-this-plot-only')).toBeTruthy();
    });
});
