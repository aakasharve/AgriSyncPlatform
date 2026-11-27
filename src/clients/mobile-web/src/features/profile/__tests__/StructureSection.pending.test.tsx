// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-1 item 5 (R2-A 10, founder 27 Nov, his word "red"): on पिकं आणि प्लॉट a plot that misses a required link carries a RED mark,
 * and a small "बाकी" list at the top names each such plot with its reasons; a tap opens that plot. Today's links: the plot's boundary
 * (हद्द) is drawn; the plot follows a schedule. The farmer no longer opens every plot to find what is missing.
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
import { setScheduleTemplatesFromReferenceData } from '../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE, TEMPLATE_ID } from '../../scheduler/schedulePage/__tests__/scheduleFixtures';
import type { CropProfile, Plot } from '../../../domain/types/farm.types';

const MAPPED = { geoData: { calculatedAreaAcres: 1 } as Plot['geoData'] };
const plot = (id: string, name: string, over: Partial<Plot> = {}): Plot => ({
    id, name, variety: '', startDate: '2026-01-01', createdAt: '2026-01-01',
    baseline: { totalArea: 2, unit: 'Acre' },
    ...over,
} as Plot);

/** Six grape plots that follow the crop's schedule; G2 and G5 have no boundary drawn. */
const sixPlots = (unmapped: string[] = ['g2', 'g5']): CropProfile => ({
    id: 'c1', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', activeScheduleId: TEMPLATE_ID,
    supportedTasks: ['General'], workflow: [], createdAt: '2026-01-01',
    plots: Array.from({ length: 6 }, (_, i) => plot(`g${i + 1}`, `G${i + 1}`, unmapped.includes(`g${i + 1}`) ? {} : MAPPED)),
} as CropProfile);

const props = (crops: CropProfile[]): React.ComponentProps<typeof StructureSection> => ({
    crops,
    isAddingCrop: false, setIsAddingCrop: vi.fn(),
    newCropData: {}, setNewCropData: vi.fn(),
    cropNameError: '', setCropNameError: vi.fn(),
    normalizeCropName: (n: string) => n.trim().toLowerCase(),
    normalizedNewCropName: '', isDuplicateCropName: false,
    handleAddCrop: vi.fn(), setMappingPlotId: vi.fn(), deletePlot: vi.fn(), setWizardCropId: vi.fn(),
    onOpenScheduleLibrary: vi.fn(), onOpenSchedule: vi.fn(),
});

const pendingRows = () => Array.from(document.querySelectorAll('[data-testid^="plots-pending-row-"]')).map(el => el.getAttribute('data-testid'));

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE]));
beforeEach(() => {
    state.choices = new Map();
    state.language = 'mr';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('पिकं आणि प्लॉट — what is still missing, at a glance', () => {
    it('6 plots, 2 without a boundary: the बाकी list names exactly those 2, and only they carry the red mark', () => {
        render(<StructureSection {...props([sixPlots()])} />);
        const box = screen.getByTestId('plots-pending');
        expect(box).toHaveTextContent('बाकी');
        expect(pendingRows()).toEqual(['plots-pending-row-g2', 'plots-pending-row-g5']);
        expect(screen.getByTestId('plots-pending-row-g2')).toHaveTextContent('G2');
        expect(screen.getByTestId('plots-pending-row-g2')).toHaveTextContent('हद्द आखायची बाकी');
        expect(screen.getByTestId('plots-pending-row-g2')).not.toHaveTextContent('शेड्यूल नाही');
        // the red mark sits on the plot's own tile, in the app's danger colour
        expect(within(screen.getByTestId('plot-pick-g2')).getByTestId('plot-pending-dot-g2').className).toContain('bg-rose-600');
        expect(within(screen.getByTestId('plot-pick-g5')).getByTestId('plot-pending-dot-g5')).toBeInTheDocument();
        for (const id of ['g1', 'g3', 'g4', 'g6']) expect(screen.queryByTestId(`plot-pending-dot-${id}`)).toBeNull();
    });

    it('every plot has its links: no list, no red mark', () => {
        render(<StructureSection {...props([sixPlots([])])} />);
        expect(screen.queryByTestId('plots-pending')).toBeNull();
        expect(document.querySelector('[data-testid^="plot-pending-dot-"]')).toBeNull();
    });

    it('a plot that follows no schedule is pending too; both reasons on one line', () => {
        const crop = { ...sixPlots(['g3']), activeScheduleId: null } as CropProfile;
        state.choices = new Map(['g1', 'g2', 'g4', 'g5', 'g6'].map(id => [id, { templateId: TEMPLATE_ID, referenceDate: null, pending: false, origin: 'Outside', isMain: true }]));
        render(<StructureSection {...props([crop])} />);
        expect(pendingRows()).toEqual(['plots-pending-row-g3']);
        const row = screen.getByTestId('plots-pending-row-g3');
        expect(row).toHaveTextContent('हद्द आखायची बाकी');
        expect(row).toHaveTextContent('शेड्यूल नाही');
    });

    it('a tap on a line opens that plot', () => {
        render(<StructureSection {...props([sixPlots()])} />);
        expect(screen.queryByTestId('plot-g5')).toBeNull();
        fireEvent.click(screen.getByTestId('plots-pending-row-g5'));
        expect(screen.getByTestId('plot-g5')).toBeInTheDocument();
        expect(screen.getByTestId('plot-map-g5')).toHaveTextContent('नकाशावर हद्द आखा');
    });

    it('a crop with up to 3 plots (one card each): the red mark is on the card', () => {
        const small = { ...sixPlots(), plots: [plot('g1', 'G1', MAPPED), plot('g2', 'G2')] } as CropProfile;
        render(<StructureSection {...props([small])} />);
        expect(pendingRows()).toEqual(['plots-pending-row-g2']);
        expect(within(screen.getByTestId('plot-g2')).getByTestId('plot-pending-dot-g2')).toBeInTheDocument();
        expect(within(screen.getByTestId('plot-g1')).queryByTestId('plot-pending-dot-g1')).toBeNull();
    });

    it('English mode reads English only', () => {
        state.language = 'en';
        render(<StructureSection {...props([sixPlots(['g2'])])} />);
        const box = screen.getByTestId('plots-pending');
        expect(box).toHaveTextContent('Pending');
        expect(box).toHaveTextContent('Boundary not drawn');
        expect(box.textContent ?? '').not.toMatch(/[ऀ-ॿ]/);
    });
});
