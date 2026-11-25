// @vitest-environment jsdom
/**
 * spec: plr-d10-final-polish - in English mode every label on a library row has its English twin (no Devanagari); Marathi mode keeps its Marathi.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ScheduleLibraryView from '../ScheduleLibraryView';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import type { CropProfile } from '../../../../types';

const CHECKED_ID = '9a0b1c2d-0000-4000-8000-000000000011';
const SAMPLE_ID = 'f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77311';
const stages = [{ name: 'Post Pruning', startDay: 0, endDay: 12 }, { name: 'Canopy Build', startDay: 13, endDay: 40 }];
const activities = [{ name: 'Foliar Spray', category: 'Spraying', stageName: 'Canopy Build', startDay: 18, endDay: 40, frequencyMode: 'every_n_days', intervalDays: 7 }];
const checkedRow = {
    id: CHECKED_ID, name: 'Grapes - University Schedule', cropType: 'grape', totalDays: 41, stages, activities, versionHash: 'h',
    ownerType: 'INSTITUTION', sourceLabel: 'Test University',
    check: { state: 'Checked', checkerDisplayName: 'Anil Kumar', checkedAtUtc: '2026-11-08T05:00:00Z', note: null }, rowVersionTag: 'v1', hasStoredDays: true,
};
const sampleRow = { id: SAMPLE_ID, name: 'Grapes - Standard Seasonal Template', cropType: 'Grapes', totalDays: 150, stages, activities, versionHash: 'h', check: null, ownerType: null };
const grapes: CropProfile = { id: 'c_11111111-1111-4111-8111-111111111111', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', plots: [], activeScheduleId: null, supportedTasks: [], workflow: [] };
const DEVANAGARI = /[ऀ-ॿ]/;

describe('ScheduleLibraryView rows by language', () => {
    afterEach(() => cleanup());

    it('English mode: the rows (checked and sample) carry no Devanagari and say the English labels', () => {
        setScheduleTemplatesFromReferenceData([checkedRow]);
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} language="en" />);
        const row = screen.getByTestId(`library-${CHECKED_ID}`).textContent ?? '';
        expect(row).not.toMatch(DEVANAGARI);
        expect(row).toContain('Made by');
        expect(row).toContain('Total days 41');
        expect(row).toContain('Checked by ShramSafal');
        cleanup();
        setScheduleTemplatesFromReferenceData([sampleRow]);
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} language="en" />);
        const sample = screen.getByTestId(`library-${SAMPLE_ID}`).textContent ?? '';
        expect(sample).not.toMatch(DEVANAGARI);
        expect(sample).toContain('Not yet checked by ShramSafal');
    });

    it('English mode: the whole library has no Devanagari', () => {
        setScheduleTemplatesFromReferenceData([checkedRow, sampleRow]);
        const view = render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} language="en" onMakeOwn={vi.fn()} />);
        expect(view.container.textContent ?? '').not.toMatch(DEVANAGARI);
    });

    it('English mode: the stages sheet ("View") has no Devanagari and says the English words; Marathi mode keeps Marathi', () => {
        setScheduleTemplatesFromReferenceData([checkedRow]);
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} language="en" />);
        fireEvent.click(screen.getByTestId(`library-view-${CHECKED_ID}`));
        const sheet = screen.getByTestId('library-stages');
        expect(sheet.textContent ?? '').not.toMatch(DEVANAGARI);
        expect(sheet.getAttribute('aria-label') ?? '').not.toMatch(DEVANAGARI);
        expect(screen.getByTestId('library-stages-back').getAttribute('aria-label') ?? '').not.toMatch(DEVANAGARI);
        expect(sheet.textContent).toContain('Back');
        expect(sheet.textContent).toContain('Post Pruning');
        expect(sheet.textContent).toContain('Day 1–13');
        expect(sheet.textContent).toContain('Every 7 days');
        cleanup();
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} />);
        fireEvent.click(screen.getByTestId(`library-view-${CHECKED_ID}`));
        expect(screen.getByTestId('library-stages').textContent).toContain('मागे');
        expect(screen.getByTestId('library-stages').textContent).toContain('दर ');
    });

    it('Marathi mode keeps its Marathi labels', () => {
        setScheduleTemplatesFromReferenceData([checkedRow]);
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} />);
        const row = screen.getByTestId(`library-${CHECKED_ID}`).textContent ?? '';
        expect(row).toContain('कोणी बनवलं');
        expect(row).toContain('एकूण दिवस');
        expect(row).toContain('श्रमसफलने तपासलेलं');
    });
});
beforeEach(() => undefined);
