// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-A Task 5 (founder D-74, L8-R): ShramSafal's check on the phone.
 *
 * A checked schedule shows who checked it and when; an unchecked one the grey words; a built-in sample is never checked; the
 * server's owner type reaches `ownerType` (it used to be a hard-coded SYSTEM_DEFAULT); and the demo "x/100" and "followers"
 * are gone from the library and from the add-plot wizard (P4: every real schedule carries 0 there).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ScheduleLibraryView from '../ScheduleLibraryView';
import { ScheduleCheckBadge } from '../ScheduleCheckBadge';
import AddPlotWizard from '../../../profile/components/AddPlotWizard';
import { getAllTemplates, setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { SC } from '../../schedulePage/scheduleCopy';
import type { CropProfile, FarmerProfile } from '../../../../types';

const CHECKED_ID = '9a0b1c2d-0000-4000-8000-000000000001';
const SAMPLE_ID = 'f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77301';
const THIN_ID = '9a0b1c2d-0000-4000-8000-000000000003';
const CHECKER = 'श्रमसफल कृषी तज्ज्ञ अनिल';

const stages = [
    { name: 'Post Pruning', startDay: 0, endDay: 12 },
    { name: 'Canopy Build', startDay: 13, endDay: 40 },
];
const activities = [
    { name: 'Foliar Spray', category: 'Spraying', stageName: 'Canopy Build', startDay: 18, endDay: 40, frequencyMode: 'every_n_days', intervalDays: 7 },
];

/** The server's own shape for a checked row: the old fields, then the new ones appended at the end. */
const checkedRow = {
    id: CHECKED_ID,
    name: 'Grapes - University Schedule',
    cropType: 'grape',
    totalDays: 41,
    stages,
    activities,
    versionHash: 'h',
    ownerType: 'INSTITUTION',
    sourceLabel: 'Test University recommendation',
    check: { state: 'Checked', checkerDisplayName: CHECKER, checkedAtUtc: '2026-11-08T05:00:00Z', note: null },
    rowVersionTag: 'v1',
    hasStoredDays: true,
};
/** A row made before the lane: no new fields at all (also what 1.0.17's server sent). */
const thinRow = { id: THIN_ID, name: 'Grapes - Old Row', cropType: 'Grapes', totalDays: 60, stages, activities, versionHash: 'h' };
/** The built-in sample: no owner type, no check. */
const sampleRow = { id: SAMPLE_ID, name: 'Grapes - Standard Seasonal Template', cropType: 'Grapes', totalDays: 150, stages, activities, versionHash: 'h', check: null, ownerType: null };

const grapes: CropProfile = {
    id: 'c_11111111-1111-4111-8111-111111111111',
    name: 'Grapes',
    iconName: 'Grape',
    color: 'bg-purple-500',
    plots: [],
    activeScheduleId: null,
    supportedTasks: [],
    workflow: [],
};

describe('ScheduleLibraryView - ShramSafal check badge (SCH-A)', () => {
    beforeEach(() => setScheduleTemplatesFromReferenceData([checkedRow, thinRow, sampleRow]));
    afterEach(() => cleanup());

    it('a checked schedule shows the checker and the date', () => {
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} />);

        const badge = screen.getByTestId(`library-check-${CHECKED_ID}`);
        expect(badge).toHaveAttribute('data-check-state', 'Checked');
        expect(within(badge).getByText(SC.checkedByShramSafal)).toBeInTheDocument();
        const who = screen.getByTestId(`library-check-${CHECKED_ID}-who`).textContent ?? '';
        expect(who).toContain(CHECKER);
        expect(who).toMatch(/2026/);
        expect(who).toMatch(/8|०८/); // the day of 2026-11-08
    });

    it('an unchecked schedule, a row made before the lane and a built-in sample show the grey words', () => {
        // L8b-1F (D-91 = 1): the samples are offered only while their crop has no checked schedule, so the checked row is left out here.
        setScheduleTemplatesFromReferenceData([thinRow, sampleRow]);
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} />);

        for (const id of [THIN_ID, SAMPLE_ID]) {
            const badge = screen.getByTestId(`library-check-${id}`);
            expect(badge).toHaveAttribute('data-check-state', 'NotChecked');
            expect(within(badge).getByText(SC.notCheckedByShramSafal)).toBeInTheDocument();
            expect(screen.queryByTestId(`library-check-${id}-who`)).toBeNull();
        }
        expect(SC.notCheckedByShramSafal).toBe('श्रमसफलने अजून तपासलेलं नाही');
        expect(SC.checkedByShramSafal).toBe('श्रमसफलने तपासलेलं');
    });

    it('a schedule whose approval was taken back or sent back reads "not checked", never "checked"', () => {
        setScheduleTemplatesFromReferenceData([
            { ...checkedRow, check: { state: 'Withdrawn', checkerDisplayName: CHECKER, checkedAtUtc: '2026-11-08T05:00:00Z', note: 'source revised' } },
        ]);
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} />);

        // L8b-1F: a withdrawn schedule is no longer OFFERED in the library (see ScheduleLibraryView.perCrop.test.tsx); the badge a plot
        // that follows it shows still reads "not checked", never "checked".
        const withdrawn = getAllTemplates().find(t => t.id === CHECKED_ID)!;
        cleanup();
        render(<ScheduleCheckBadge template={withdrawn} testId="followed-badge" />);
        expect(screen.getByTestId('followed-badge')).toHaveAttribute('data-check-state', 'NotChecked');
        expect(screen.queryByText(SC.checkedByShramSafal)).toBeNull();
    });

    it('a server row\'s INSTITUTION reaches ownerType, and the built-in sample stays SYSTEM_DEFAULT', () => {
        const byId = new Map(getAllTemplates().map(t => [t.id, t]));

        expect(byId.get(CHECKED_ID)?.ownerType).toBe('INSTITUTION');
        expect(byId.get(CHECKED_ID)?.sourceLabel).toBe('Test University recommendation');
        expect(byId.get(CHECKED_ID)?.check?.state).toBe('Checked');
        expect(byId.get(CHECKED_ID)?.check?.checkerName).toBe(CHECKER);
        expect(byId.get(THIN_ID)?.ownerType).toBe('SYSTEM_DEFAULT');
        expect(byId.get(THIN_ID)?.check).toBeUndefined();
        expect(byId.get(SAMPLE_ID)?.ownerType).toBe('SYSTEM_DEFAULT');
        expect(byId.get(SAMPLE_ID)?.check).toBeUndefined();
    });

    it('an unreadable owner type or check is left out, never guessed', () => {
        setScheduleTemplatesFromReferenceData([
            { ...checkedRow, ownerType: 'WIZARD', check: { state: 'Approved-ish' } },
            { ...thinRow, id: '9a0b1c2d-0000-4000-8000-000000000004', check: 'yes', ownerType: 7 },
        ]);

        for (const t of getAllTemplates()) {
            expect(t.ownerType).toBe('SYSTEM_DEFAULT');
            expect(t.check).toBeUndefined();
        }
    });

    it('shows no "/100" and no "followers" text', () => {
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={vi.fn()} />);

        const text = document.body.textContent ?? '';
        expect(text).not.toContain('/100');
        expect(text.toLowerCase()).not.toContain('followers');
        expect(text).not.toContain('Adoption');
    });
});

describe('AddPlotWizard - no demo scores (SCH-A)', () => {
    beforeEach(() => setScheduleTemplatesFromReferenceData([checkedRow, thinRow]));
    afterEach(() => cleanup());

    it('the schedule choice shows no "/100" and no "followers"', () => {
        const profile = { name: 'T', village: '', phone: '', language: 'mr', operators: [], activeOperatorId: '', waterResources: [], motors: [], machineries: [] } as unknown as FarmerProfile;
        render(<AddPlotWizard crop={grapes} profile={profile} onSave={vi.fn()} onCancel={vi.fn()} />);

        fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'नवीन बाग' } });
        fireEvent.change(screen.getByTestId('plot-area'), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: /profile\.nextStep/ }));
        // step 2: a variety is enough with seeds when a quantity is given
        const boxes = screen.getAllByRole('textbox');
        fireEvent.change(boxes[0], { target: { value: 'Thompson' } });
        const spin = screen.getAllByRole('spinbutton');
        fireEvent.change(spin[0], { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: /profile\.nextStep/ }));

        expect(screen.getByText(/Choose Schedule/)).toBeInTheDocument();
        const text = document.body.textContent ?? '';
        expect(text).toContain('Grapes - University Schedule');
        expect(text).not.toContain('/100');
        expect(text.toLowerCase()).not.toContain('followers');
        expect(text).not.toContain('Adoption');
    });
});
