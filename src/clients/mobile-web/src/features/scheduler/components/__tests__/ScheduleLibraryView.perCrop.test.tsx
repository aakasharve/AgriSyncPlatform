// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane L8b-1F Task 4 (register F114; founder D-82 note, D-91 = 1).
 *
 * The library offers a plot only what it may follow: for a crop with NO checked schedule the sample is listed, choosable, and marked
 * with its line; for a crop WITH one the sample is not listed at all (no disabled card) and the checked one can be chosen; the
 * farm's own schedules (Team / Private) stay hidden until SCH-OWN opens that branch; another crop's samples stay.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ScheduleLibraryView, { libraryTemplates } from '../ScheduleLibraryView';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { SC } from '../../schedulePage/scheduleCopy';
import type { CropProfile } from '../../../../types';

const GRAPE_SAMPLE = 'f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77301';
const POMEGRANATE_SAMPLE = 'f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77302';
const CHECKED = '9a0b1c2d-0000-4000-8000-000000000001';
const OWN_TEAM = '9a0b1c2d-0000-4000-8000-000000000009';
const WITHDRAWN = '9a0b1c2d-0000-4000-8000-000000000008';

const stages = [{ name: 'Post Pruning', startDay: 0, endDay: 12 }, { name: 'Canopy Build', startDay: 13, endDay: 40 }];
const activities = [{ name: 'Foliar Spray', category: 'Spraying', stageName: 'Canopy Build', startDay: 18, endDay: 40, frequencyMode: 'every_n_days', intervalDays: 7 }];
const row = (id: string, name: string, cropType: string, extra: Record<string, unknown> = {}) =>
    ({ id, name, cropType, totalDays: 41, stages, activities, versionHash: 'h', ...extra });

const grapeSample = row(GRAPE_SAMPLE, 'Grapes - Standard Seasonal Template', 'Grapes', { check: { state: 'NotChecked' } });
const pomegranateSample = row(POMEGRANATE_SAMPLE, 'Pomegranate - Mrig Bahar Template', 'Pomegranate', { check: { state: 'NotChecked' } });
const checkedGrape = row(CHECKED, 'Grapes - University Schedule', 'Grapes', {
    ownerType: 'INSTITUTION', scope: 'Public', hasStoredDays: true,
    check: { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ अनिल', checkedAtUtc: '2026-11-08T05:00:00Z' },
});
const ownTeamGrape = row(OWN_TEAM, 'Grapes - our farm schedule', 'Grapes', { scope: 'Team', check: { state: 'NotChecked' } });
const withdrawnGrape = row(WITHDRAWN, 'Grapes - Withdrawn Schedule', 'Grapes', { scope: 'Public', hasStoredDays: true, check: { state: 'Withdrawn', note: 'wrong dose' } });

const crop = (name: string, id: string): CropProfile => ({
    id, name, iconName: 'Grape', color: 'bg-purple-500', plots: [], activeScheduleId: null, supportedTasks: [], workflow: [],
});
const grapes = crop('Grapes', 'c_11111111-1111-4111-8111-111111111111');
const pomegranate = crop('Pomegranate', 'c_22222222-2222-4222-8222-222222222222');

const ids = () => libraryTemplates([grapes, pomegranate]).map(t => t.id);

describe('the library offers a plot only what it may follow (L8b-1F, F114)', () => {
    afterEach(() => cleanup());

    it('a crop with no checked schedule lists its sample, choosable, marked with its line', () => {
        setScheduleTemplatesFromReferenceData([grapeSample, pomegranateSample]);
        const onAdopt = vi.fn();
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes, pomegranate]} onAdopt={onAdopt} />);

        expect(screen.getByTestId(`library-${GRAPE_SAMPLE}`)).toBeInTheDocument();
        expect(screen.getByTestId(`library-check-${GRAPE_SAMPLE}`)).toHaveAttribute('data-check-state', 'NotChecked');
        expect(screen.getByTestId(`library-sample-line-${GRAPE_SAMPLE}`)).toHaveTextContent(SC.sampleWillHide('द्राक्ष'));
        expect(SC.sampleWillHide('द्राक्ष')).toBe('द्राक्षसाठी पहिलं तपासलेलं शेड्यूल आलं की नवीन निवडीसाठी हे दिसणार नाही. आधीपासून पाळत असाल तर तसंच राहील.');
        fireEvent.click(screen.getByTestId(`library-adopt-${GRAPE_SAMPLE}`));
        expect(onAdopt).toHaveBeenCalledWith(GRAPE_SAMPLE);
    });

    it('a crop with a checked schedule does not list its sample at all (no disabled card); the checked one can be chosen', () => {
        setScheduleTemplatesFromReferenceData([grapeSample, pomegranateSample, checkedGrape]);
        const onAdopt = vi.fn();
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes, pomegranate]} onAdopt={onAdopt} />);

        expect(screen.queryByTestId(`library-${GRAPE_SAMPLE}`)).toBeNull();
        expect(screen.getByTestId(`library-check-${CHECKED}`)).toHaveAttribute('data-check-state', 'Checked');
        expect(screen.queryByTestId(`library-sample-line-${CHECKED}`)).toBeNull();
        fireEvent.click(screen.getByTestId(`library-adopt-${CHECKED}`));
        expect(onAdopt).toHaveBeenCalledWith(CHECKED);
        // Another crop's sample stays.
        expect(screen.getByTestId(`library-${POMEGRANATE_SAMPLE}`)).toBeInTheDocument();
    });

    it('the farm\'s own schedules stay hidden until SCH-OWN, whatever they are named', () => {
        setScheduleTemplatesFromReferenceData([grapeSample, ownTeamGrape]);
        expect(ids()).toEqual([GRAPE_SAMPLE]);
        setScheduleTemplatesFromReferenceData([grapeSample, checkedGrape, ownTeamGrape]);
        expect(ids()).toEqual([CHECKED]);
    });

    it('a withdrawn schedule is never offered for a new choice, and does not hide the sample', () => {
        setScheduleTemplatesFromReferenceData([grapeSample, withdrawnGrape]);
        expect(ids()).toEqual([GRAPE_SAMPLE]);
    });

    it('an unchecked row that STORES its days (it arrives only because a plot follows it) is never offered as a card or a sample', () => {
        const followedStored = row('9a0b1c2d-0000-4000-8000-00000000000a', 'Grapes - waiting schedule', 'Grapes', {
            scope: 'Public', hasStoredDays: true, check: { state: 'NotChecked' },
        });
        setScheduleTemplatesFromReferenceData([grapeSample, followedStored]);
        expect(ids()).toEqual([GRAPE_SAMPLE]);
        // ... and with no sample beside it, nothing is offered for the crop (it still resolves for the plot that follows it).
        setScheduleTemplatesFromReferenceData([followedStored]);
        expect(ids()).toEqual([]);
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} />);
        expect(screen.queryByTestId('library-9a0b1c2d-0000-4000-8000-00000000000a')).toBeNull();
    });

    it('a sample is listed while another crop has the checked one', () => {
        setScheduleTemplatesFromReferenceData([grapeSample, pomegranateSample, checkedGrape]);
        expect(ids().sort()).toEqual([CHECKED, POMEGRANATE_SAMPLE].sort());
    });
});
