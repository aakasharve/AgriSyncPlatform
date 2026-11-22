// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (UI-9a, redesign item 9; founder 2026-11-21: "Marathi digits on the schedule tab, library, editor and Setup").
 *
 * The library's counted lines - each schedule row's "एकूण दिवस N · स्टेज N" and the stages sheet's day ranges and "how often" lines - are in Devanagari
 * digits. Dates and money are not touched here.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ScheduleLibraryView from '../ScheduleLibraryView';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import type { CropProfile } from '../../../../types';

const CHECKED = '9a0b1c2d-0000-4000-8000-000000000001';
const stages = [{ name: 'Post Pruning', startDay: 0, endDay: 12 }, { name: 'Canopy Build', startDay: 13, endDay: 140 }];
const activities = [
    { name: 'Foliar Spray', category: 'Spraying', stageName: 'Canopy Build', startDay: 18, endDay: 140, frequencyMode: 'every_n_days', intervalDays: 7 },
    { name: 'Weeding', category: 'Activity', stageName: 'Canopy Build', startDay: 25, endDay: 140, frequencyMode: 'per_week', intervalDays: 2 },
    { name: 'Pruning', category: 'Activity', stageName: 'Post Pruning', startDay: 4, endDay: 4, frequencyMode: 'one_time', intervalDays: null },
];
const checkedGrape = {
    id: CHECKED, name: 'Grapes - University Schedule', cropType: 'Grapes', totalDays: 365, stages, activities, versionHash: 'h',
    ownerType: 'INSTITUTION', scope: 'Public', hasStoredDays: true,
    check: { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ अनिल', checkedAtUtc: '2026-11-08T05:00:00Z' },
};
const grapes: CropProfile = {
    id: 'c_11111111-1111-4111-8111-111111111111', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', plots: [], activeScheduleId: null, supportedTasks: [], workflow: [],
};

describe('the library writes its counts in Devanagari digits (item 9)', () => {
    afterEach(() => cleanup());

    it('a schedule row: total days and stage count (three-digit number)', () => {
        setScheduleTemplatesFromReferenceData([checkedGrape]);
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} />);
        const row = screen.getByTestId(`library-${CHECKED}`);
        expect(row).toHaveTextContent('एकूण दिवस ३६५ · स्टेज २');
        expect(row.textContent).not.toContain('365');
        // "Grapes - University Schedule" is a name a person wrote for it (scheduleNameMr leaves it alone), so it is shown as written
        expect(screen.getByTestId(`library-name-${CHECKED}`)).toHaveTextContent('Grapes - University Schedule');
    });

    it('the stages sheet: day ranges, "how often" and the one-time day, all in Marathi digits', () => {
        setScheduleTemplatesFromReferenceData([checkedGrape]);
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} />);
        fireEvent.click(screen.getByTestId(`library-view-${CHECKED}`));
        const sheet = screen.getByTestId('library-stages');
        const second = within(sheet).getByTestId('library-stage-2');
        expect(second).toHaveTextContent('दिवस १४–१४१');
        expect(second).toHaveTextContent('दर ७ दिवसांनी');
        expect(second).toHaveTextContent('आठवड्यातून २ वेळा');
        expect(within(sheet).getByTestId('library-stage-1')).toHaveTextContent('दिवस १–१३');
        expect(within(sheet).getByTestId('library-stage-1')).toHaveTextContent('दिवस ५'); // the one-time work's day
        expect(sheet.textContent).not.toMatch(/[0-9]/);
    });
});
