// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 7; founder 2026-11-21) - Setup "पिकं आणि प्लॉट":
 *   - per crop the photo once and "<N> प्लॉट" in Marathi digits;
 *   - one schedule sentence COUNTED FROM THE PLOTS ("१५ पैकी १३ प्लॉटवर शेड्यूल") + "शेड्यूल बघा" (opens the schedule tab on this crop), or the
 *     orange "शेड्यूल नाही" + "निवडा" when no plot follows one; never the old crop-level box, never "वेळापत्रक";
 *   - from 4 plots the shared plot grid with the tapped plot's card (map, remove) under it; up to 3 plots keep one card each.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const state = vi.hoisted(() => ({ choices: new Map<string, unknown>(), language: 'mr' as 'mr' | 'en' }));
vi.mock('../../scheduler/schedulePage/usePlotScheduleChoices', () => ({ usePlotScheduleChoices: () => state.choices }));
vi.mock('../../../i18n/LanguageContext', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: state.language }),
}));

import StructureSection from '../sections/StructureSection';
import { plotsFollowingCount, scheduleLineText } from '../sections/cropScheduleLine';
import { setScheduleTemplatesFromReferenceData } from '../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE, TEMPLATE_ID } from '../../scheduler/schedulePage/__tests__/scheduleFixtures';
import type { CropProfile, Plot } from '../../../domain/types/farm.types';

const TODAY = '2026-10-26';

const plot = (id: string, name: string, over: Partial<Plot> = {}): Plot => ({
    id, name, variety: '', startDate: '2026-01-01', createdAt: '2026-01-01',
    baseline: { totalArea: 2, unit: 'Acre' },
    ...over,
} as Plot);

const grapes = (count: number, over: Partial<CropProfile> = {}): CropProfile => ({
    id: 'c1', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', activeScheduleId: null,
    supportedTasks: ['General'], workflow: [], createdAt: '2026-01-01',
    plots: Array.from({ length: count }, (_, i) => plot(`g${i + 1}`, `G${i + 1}`)),
    ...over,
} as CropProfile);

/** What `usePlotScheduleChoices` hands over: a plot -> the schedule the server says it follows. */
const follow = (...plotIds: string[]) => {
    state.choices = new Map(plotIds.map(id => [id, { templateId: TEMPLATE_ID, referenceDate: null, pending: false, origin: 'Outside', isMain: true }]));
};

const props = (crops: CropProfile[], over: Partial<React.ComponentProps<typeof StructureSection>> = {}): React.ComponentProps<typeof StructureSection> => ({
    crops,
    isAddingCrop: false, setIsAddingCrop: vi.fn(),
    newCropData: {}, setNewCropData: vi.fn(),
    cropNameError: '', setCropNameError: vi.fn(),
    normalizeCropName: (n: string) => n.trim().toLowerCase(),
    normalizedNewCropName: '', isDuplicateCropName: false,
    handleAddCrop: vi.fn(), setMappingPlotId: vi.fn(), deletePlot: vi.fn(), setWizardCropId: vi.fn(),
    onOpenScheduleLibrary: vi.fn(), onOpenSchedule: vi.fn(),
    ...over,
});

const text = (id: string) => screen.getByTestId(id).textContent ?? '';

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE]));
beforeEach(() => {
    state.choices = new Map();
    state.language = 'mr';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the schedule sentence is counted from the plots', () => {
    it('15 plots, 13 follow a schedule: "१५ पैकी १३ प्लॉटवर शेड्यूल", in Marathi digits, with "शेड्यूल बघा"', () => {
        follow(...Array.from({ length: 13 }, (_, i) => `g${i + 1}`));
        render(<StructureSection {...props([grapes(15)])} />);
        expect(text('schedule-line-c1')).toBe('१५ पैकी १३ प्लॉटवर शेड्यूल');
        expect(screen.getByTestId('schedule-see-c1')).toHaveTextContent('शेड्यूल बघा');
        expect(screen.queryByTestId('schedule-missing-c1')).toBeNull();
    });

    it('the number follows the plots, not a crop-level field: the crop says one thing, the plots another, and the plots win', () => {
        // The crop-level field names a schedule this phone does not hold -> it is no schedule for anyone; two plots follow one on the server.
        follow('g1', 'g2');
        render(<StructureSection {...props([grapes(15, { activeScheduleId: 'no-such-schedule' })])} />);
        expect(text('schedule-line-c1')).toBe('१५ पैकी २ प्लॉटवर शेड्यूल');
    });

    it('a crop-level field that names a real schedule is what the tab shows for every plot of it, so it counts the same way as the tab (all plots)', () => {
        render(<StructureSection {...props([grapes(15, { activeScheduleId: TEMPLATE_ID })])} />);
        expect(text('schedule-line-c1')).toBe('१५ पैकी १५ प्लॉटवर शेड्यूल');
    });

    it('no plot follows one: the orange "शेड्यूल नाही" with "निवडा", which opens the schedule library on this crop; no sentence, no "शेड्यूल बघा"', () => {
        const p = props([grapes(15)]);
        render(<StructureSection {...p} />);
        const box = screen.getByTestId('schedule-missing-c1');
        expect(box).toHaveTextContent('शेड्यूल नाही');
        expect(box.className).toContain('bg-orange-50');
        expect(screen.getByTestId('schedule-open-c1')).toHaveTextContent('निवडा');
        expect(screen.queryByTestId('schedule-line-c1')).toBeNull();
        expect(screen.queryByTestId('schedule-see-c1')).toBeNull();
        fireEvent.click(screen.getByTestId('schedule-open-c1'));
        expect(p.onOpenScheduleLibrary).toHaveBeenCalledWith('c1');
    });

    it('a crop with no plot yet: the orange "शेड्यूल नाही" too (nothing follows one), and its count says there is no plot', () => {
        render(<StructureSection {...props([grapes(0)])} />);
        expect(screen.getByTestId('schedule-missing-c1')).toHaveTextContent('शेड्यूल नाही');
        expect(text('crop-count-c1')).toBe('प्लॉट नाही');
    });

    it('"शेड्यूल बघा" opens the schedule tab on that crop (onOpenSchedule), not the library', () => {
        follow('g1');
        const p = props([grapes(15)]);
        render(<StructureSection {...p} />);
        fireEvent.click(screen.getByTestId('schedule-see-c1'));
        expect(p.onOpenSchedule).toHaveBeenCalledWith('c1');
        expect(p.onOpenScheduleLibrary).not.toHaveBeenCalled();
    });

    it('where the page gives no schedule door of its own, "शेड्यूल बघा" uses the nearest one it has (the library door, same crop)', () => {
        follow('g1');
        const p = props([grapes(15)], { onOpenSchedule: undefined });
        render(<StructureSection {...p} />);
        fireEvent.click(screen.getByTestId('schedule-see-c1'));
        expect(p.onOpenScheduleLibrary).toHaveBeenCalledWith('c1');
    });

    it('two crops are counted separately, each from its own plots', () => {
        follow('g1', 'g2', 'g3', 'g4', 'u1');
        const cane = grapes(3, { id: 'c2', name: 'Sugarcane', iconName: 'Sugarcane', color: 'bg-pink-500', plots: [plot('u1', 'U1'), plot('u2', 'U2'), plot('u3', 'U3')] });
        render(<StructureSection {...props([grapes(15), cane])} />);
        expect(text('schedule-line-c1')).toBe('१५ पैकी ४ प्लॉटवर शेड्यूल');
        expect(text('schedule-line-c2')).toBe('३ पैकी १ प्लॉटवर शेड्यूल');
    });
});

describe('what the crop block says: Marathi digits, the word शेड्यूल, no old box', () => {
    it('"१५ प्लॉट" under the crop name, the crop photo once, and no Latin digit, no "वेळापत्रक", no English schedule name in the block', () => {
        follow('g1', 'g2');
        render(<StructureSection {...props([grapes(15)])} />);
        expect(text('crop-name-c1')).toBe('द्राक्ष');
        expect(text('crop-count-c1')).toBe('१५ प्लॉट');
        const header = screen.getByTestId('crop-header-c1');
        expect(header.querySelectorAll('[data-part="photo-column"]')).toHaveLength(1);
        const words = `${text('crop-count-c1')} ${text('schedule-c1')}`;
        expect(words).not.toMatch(/[0-9]/);
        expect(screen.getByTestId('crop-c1').textContent).not.toContain('वेळापत्रक');
        expect(screen.getByTestId('crop-c1').textContent).not.toContain('Standard Seasonal Template');
        expect(screen.getByTestId('crop-c1').textContent).not.toContain('पिकाचं');
    });

    it('the schedule line and its buttons are at least 44 px tall', () => {
        follow('g1');
        render(<StructureSection {...props([grapes(15)])} />);
        expect(screen.getByTestId('schedule-see-c1').className).toContain('min-h-[44px]');
    });

    it('English mode: English words and Latin digits ("13 of 15 plots have a schedule", "See schedule", "15 plots")', () => {
        state.language = 'en';
        follow(...Array.from({ length: 13 }, (_, i) => `g${i + 1}`));
        render(<StructureSection {...props([grapes(15)])} />);
        expect(text('schedule-line-c1')).toBe('13 of 15 plots have a schedule');
        expect(screen.getByTestId('schedule-see-c1')).toHaveTextContent('See schedule');
        expect(text('crop-count-c1')).toBe('15 plots');
        expect(text('crop-name-c1')).toBe('Grapes');
    });

    it('English mode, none follows: "No schedule" with "Choose"', () => {
        state.language = 'en';
        render(<StructureSection {...props([grapes(15)])} />);
        expect(screen.getByTestId('schedule-missing-c1')).toHaveTextContent('No schedule');
        expect(screen.getByTestId('schedule-open-c1')).toHaveTextContent('Choose');
    });
});

describe('15 plots: the shared grid, one card open under it', () => {
    it('a number box per plot in Marathi digits and natural order (G2 before G10); no plot card is drawn until a number is tapped, and a small note says how', () => {
        render(<StructureSection {...props([grapes(15)])} />);
        const grid = screen.getByTestId('plot-grid-c1');
        expect(within(grid).getAllByRole('button')).toHaveLength(15);
        expect(screen.getByTestId('plot-pick-g10').querySelector('[data-part="number"]')).toHaveTextContent('१०');
        expect(screen.getByTestId('plot-pick-g2').querySelector('[data-part="number"]')).toHaveTextContent('२');
        const order = within(grid).getAllByRole('button').map(b => b.getAttribute('data-testid'));
        expect(order.indexOf('plot-pick-g2')).toBeLessThan(order.indexOf('plot-pick-g10'));
        expect(screen.queryByTestId('plot-g1')).toBeNull();
        expect(screen.getByTestId('plot-hint-c1')).toHaveTextContent('एक नंबर दाबा: तो प्लॉट खाली उघडेल');
        expect(screen.queryByTestId('plot-pick-g1')?.getAttribute('aria-pressed')).toBe('false');
    });

    it('tapping a number opens THAT plot\'s card under the grid (area, map button, remove) and ticks the box; the number is its place among all 15', () => {
        render(<StructureSection {...props([grapes(15)])} />);
        fireEvent.click(screen.getByTestId('plot-pick-g12'));
        const box = screen.getByTestId('plot-pick-g12');
        expect(box).toHaveAttribute('aria-pressed', 'true');
        expect(box.className).toContain('bg-emerald-800');
        expect(box.querySelector('[data-part="tick"]')).toBeTruthy();
        const card = screen.getByTestId('plot-g12');
        expect(card).toHaveTextContent('G12');
        expect(card).toHaveTextContent('एकर');
        expect(screen.getByTestId('plot-map-g12')).toBeInTheDocument();
        expect(screen.getByTestId('plot-remove-g12')).toBeInTheDocument();
        expect(screen.getAllByTestId(/^plot-g\d+$/)).toHaveLength(1);
        // the card is under the grid, and the hint is gone
        expect(screen.getByTestId('plot-grid-c1').compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByTestId('plot-hint-c1')).toBeNull();
    });

    it('another number replaces the card; the same number again closes it', () => {
        render(<StructureSection {...props([grapes(15)])} />);
        fireEvent.click(screen.getByTestId('plot-pick-g3'));
        fireEvent.click(screen.getByTestId('plot-pick-g4'));
        expect(screen.queryByTestId('plot-g3')).toBeNull();
        expect(screen.getByTestId('plot-g4')).toBeInTheDocument();
        expect(screen.getByTestId('plot-pick-g3')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByTestId('plot-pick-g4'));
        expect(screen.queryByTestId('plot-g4')).toBeNull();
        expect(screen.getByTestId('plot-hint-c1')).toBeInTheDocument();
    });

    it('every action is still there: the map button reports the plot, remove asks first and then deletes', () => {
        const p = props([grapes(15, { plots: Array.from({ length: 15 }, (_, i) => plot(`g${i + 1}`, `G${i + 1}`, i === 4 ? { geoData: { calculatedAreaAcres: 1.5 } as Plot['geoData'] } : {})) })]);
        render(<StructureSection {...p} />);
        fireEvent.click(screen.getByTestId('plot-pick-g5'));
        expect(screen.getByTestId('plot-g5')).toHaveTextContent('नकाशावर आखलेला');
        expect(screen.getByTestId('plot-map-g5')).toHaveTextContent('हद्द पुन्हा आखा');
        fireEvent.click(screen.getByTestId('plot-map-g5'));
        expect(p.setMappingPlotId).toHaveBeenCalledWith({ cropId: 'c1', plotId: 'g5' });
        fireEvent.click(screen.getByTestId('plot-remove-g5'));
        expect(p.deletePlot).not.toHaveBeenCalled();
        expect(screen.getByTestId('plot-remove-confirm-g5')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('plot-remove-yes-g5'));
        expect(p.deletePlot).toHaveBeenCalledWith('c1', 'g5');
    });

    it('"या पिकात प्लॉट जोडा" stays under the grid and opens the wizard for the crop', () => {
        const p = props([grapes(15)]);
        render(<StructureSection {...p} />);
        fireEvent.click(screen.getByTestId('plot-add-c1'));
        expect(p.setWizardCropId).toHaveBeenCalledWith('c1');
    });

    it('the grid is far shorter than 15 cards: no card but the opened one', () => {
        render(<StructureSection {...props([grapes(15)])} />);
        expect(screen.queryAllByTestId(/^plot-g\d+$/)).toHaveLength(0);
        fireEvent.click(screen.getByTestId('plot-pick-g1'));
        expect(screen.queryAllByTestId(/^plot-g\d+$/)).toHaveLength(1);
    });

    it('4 plots: the photo is shown once and the plots are the shared selector (chips up to 6), the card opens on a tap', () => {
        render(<StructureSection {...props([grapes(4)])} />);
        expect(screen.getByTestId('plots-c1')).toBeInTheDocument();
        expect(screen.queryByTestId('plot-g1')).toBeNull();
        fireEvent.click(screen.getByTestId('plot-pick-g2'));
        expect(screen.getByTestId('plot-g2')).toBeInTheDocument();
        expect(text('crop-count-c1')).toBe('४ प्लॉट');
    });

    it('English mode: the box number is a Latin digit and the hint is in English', () => {
        state.language = 'en';
        render(<StructureSection {...props([grapes(15)])} />);
        expect(screen.getByTestId('plot-pick-g10').querySelector('[data-part="number"]')).toHaveTextContent('10');
        expect(screen.getByTestId('plot-hint-c1')).toHaveTextContent('Tap a number: that plot opens below');
    });
});

describe('up to 3 plots: one card each, exactly as before', () => {
    it('3 plots: all three cards are drawn, no grid, no hint; each card has its map button and its remove', () => {
        render(<StructureSection {...props([grapes(3)])} />);
        for (const id of ['g1', 'g2', 'g3']) {
            expect(screen.getByTestId(`plot-${id}`)).toBeInTheDocument();
            expect(screen.getByTestId(`plot-map-${id}`)).toBeInTheDocument();
            expect(screen.getByTestId(`plot-remove-${id}`)).toBeInTheDocument();
        }
        expect(screen.queryByTestId('plot-grid-c1')).toBeNull();
        expect(screen.queryByTestId('plot-hint-c1')).toBeNull();
        expect(screen.queryByTestId('plot-pick-g1')).toBeNull();
    });

    it('1 plot: its card, its count "१ प्लॉट", the schedule sentence "१ पैकी १ प्लॉटवर शेड्यूल"', () => {
        follow('g1');
        render(<StructureSection {...props([grapes(1)])} />);
        expect(screen.getByTestId('plot-g1')).toBeInTheDocument();
        expect(text('crop-count-c1')).toBe('१ प्लॉट');
        expect(text('schedule-line-c1')).toBe('१ पैकी १ प्लॉटवर शेड्यूल');
    });
});

describe('the count and its words (pure)', () => {
    it('plotsFollowingCount asks the tab\'s own rule: a subscription counts, a crop-level real schedule counts, the app\'s default and nothing do not', () => {
        const crop = grapes(4);
        expect(plotsFollowingCount(crop, new Map(), TODAY)).toBe(0);
        follow('g1', 'g3');
        expect(plotsFollowingCount(crop, state.choices as never, TODAY)).toBe(2);
        expect(plotsFollowingCount(grapes(4, { activeScheduleId: TEMPLATE_ID }), new Map(), TODAY)).toBe(4);
        expect(plotsFollowingCount(grapes(0), new Map(), TODAY)).toBe(0);
    });

    it('scheduleLineText: the total first, then how many follow one', () => {
        expect(scheduleLineText(15, 13, 'mr')).toBe('१५ पैकी १३ प्लॉटवर शेड्यूल');
        expect(scheduleLineText(15, 13, 'en')).toBe('13 of 15 plots have a schedule');
        expect(scheduleLineText(1, 1, 'en')).toBe('1 of 1 plot has a schedule');
    });
});

describe('the plot card\'s area and the form\'s reason in Marathi digits (UI-9a item 9)', () => {
    const sized = () => grapes(3, { plots: [plot('g1', 'G1'), plot('g2', 'G2', { baseline: { totalArea: 10, unit: 'Guntha' } }), plot('g3', 'G3', { baseline: { totalArea: 2.5, unit: 'Acre' } })] });

    it('"२ एकर", "१० गुंठे", "२.५ एकर" in Marathi; no Latin digit on the three cards', () => {
        render(<StructureSection {...props([sized()])} />);
        expect(screen.getByTestId('plot-g1')).toHaveTextContent('२ एकर');
        expect(screen.getByTestId('plot-g2')).toHaveTextContent('१० गुंठे');
        expect(screen.getByTestId('plot-g3')).toHaveTextContent('२.५ एकर');
        for (const id of ['plot-g1', 'plot-g2', 'plot-g3']) {
            // the plot's own name ("G1") is the farmer's and stays as he wrote it; only the number words are Devanagari
            expect((screen.getByTestId(id).textContent ?? '').replace(/G\d/g, '')).not.toMatch(/[0-9]/);
        }
    });

    it('English mode keeps Latin digits for the area', () => {
        state.language = 'en';
        render(<StructureSection {...props([sized()])} />);
        expect(screen.getByTestId('plot-g1')).toHaveTextContent('2');
        expect(screen.getByTestId('plot-g2')).toHaveTextContent('10');
        expect(screen.getByTestId('plot-g3')).toHaveTextContent('2.5');
        expect(screen.getByTestId('plot-g3').textContent).not.toMatch(/[०-९]/);
    });

    it('the "name needed" reason names its number in Marathi digits', () => {
        const p = props([grapes(1)], { isAddingCrop: true, newCropData: { name: 'x' }, normalizedNewCropName: 'x', cropNameError: 'Crop name must be at least 2 characters.' });
        render(<StructureSection {...p} />);
        expect(screen.getByTestId('crop-name-error')).toHaveTextContent('पिकाचं नाव लिहा (किमान २ अक्षरं).');
    });
});
