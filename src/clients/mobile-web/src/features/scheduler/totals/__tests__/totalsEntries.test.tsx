// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, phone half) - where the totals are reached: the button under the profile opens the screen; the library row says
 * "X शेतकरी फॉलो करतात" only when the server sent it (nothing at all when null, never a 0), never on a sample.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const language = { current: 'mr' as 'mr' | 'en' };
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: language.current }),
    useLanguage: () => ({ language: language.current, setLanguage: () => undefined, t: (k: string) => k }),
}));

import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import ScheduleLibraryView from '../../components/ScheduleLibraryView';
import { FollowTotalsSlot } from '../../schedulePage/ScheduleTabCards';
import { loadScheduleTotals } from '../scheduleTotalsStore';
import type { CropProfile } from '../../../../types';
import { FULL_ANSWER, NULL_ANSWER, SCHED_A, SCHED_B, json, setOnline } from './totalsFixtures';

const stages = [{ name: 'Post Pruning', startDay: 0, endDay: 12 }, { name: 'Canopy Build', startDay: 13, endDay: 40 }];
const activities = [{ name: 'Foliar Spray', category: 'Spraying', stageName: 'Canopy Build', startDay: 18, endDay: 40, frequencyMode: 'every_n_days', intervalDays: 7 }];
const row = (id: string, name: string) => ({
    id, name, cropType: 'Grapes', scope: 'Public', ownerType: 'INSTITUTION', createdBy: 'ICAR', hasStoredDays: true, stages, activities, totalDurationDays: 40,
    check: { state: 'Checked', isChecked: true, checkedBy: 'श्रमसफल कृषी तज्ज्ञ अनिल', checkedAtUtc: '2026-11-01T00:00:00Z' },
});
const grapes = { id: 'c1', name: 'Grapes', iconName: 'Grape', color: 'emerald', plots: [{ id: 'p1', name: 'G1' }] } as unknown as CropProfile;
const answers = (map: Record<string, unknown>) => (id: string) => loadScheduleTotals(id, json(200, map[id]));

beforeEach(async () => { language.current = 'mr'; setOnline(true); await getDatabase().referenceData.clear(); setScheduleTemplatesFromReferenceData([row(SCHED_A, 'Grapes A'), row(SCHED_B, 'Grapes B')] as never); });
afterEach(() => cleanup());

describe('the library row headline', () => {
    const library = (map: Record<string, unknown>) => render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={() => undefined} loadTotals={answers(map)} language="mr" />);
    it('shows "X शेतकरी फॉलो करतात" only on the row the server sent it for; a null row shows nothing at all, never a 0', async () => {
        library({ [SCHED_A]: FULL_ANSWER, [SCHED_B]: NULL_ANSWER });
        expect(await screen.findByTestId(`library-follow-${SCHED_A}`)).toHaveTextContent('३७ शेतकरी फॉलो करतात');
        await waitFor(() => expect(screen.getByTestId(`library-${SCHED_B}`)).toBeInTheDocument());
        await new Promise(r => setTimeout(r, 50));
        expect(screen.queryByTestId(`library-follow-${SCHED_B}`)).toBeNull();
        expect(screen.getByTestId(`library-${SCHED_B}`).textContent).not.toMatch(/फॉलो/);
    });
    it('a sample row never shows a number and is never asked for one', async () => {
        const asked: string[] = [];
        setScheduleTemplatesFromReferenceData([{ ...row(SCHED_A, 'Grapes A'), hasStoredDays: false, check: null }] as never);
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={() => undefined} loadTotals={async id => { asked.push(id); return loadScheduleTotals(id, json(200, FULL_ANSWER)); }} language="mr" />);
        await new Promise(r => setTimeout(r, 50));
        expect(screen.queryByTestId(`library-follow-${SCHED_A}`)).toBeNull();
        expect(asked).not.toContain(SCHED_A);
    });
    it('English mode says it in English', async () => {
        render(<ScheduleLibraryView crop={grapes} allCrops={[grapes]} onAdopt={() => undefined} loadTotals={answers({ [SCHED_A]: FULL_ANSWER, [SCHED_B]: NULL_ANSWER })} language="en" />);
        expect(await screen.findByTestId(`library-follow-${SCHED_A}`)).toHaveTextContent('37 farmers follow it');
    });
});

describe('the slot under the profile', () => {
    it('closed it shows the rule and no number; the button opens the screen; back closes it', async () => {
        render(<FollowTotalsSlot schedules={[{ templateId: SCHED_A }]} loadTotals={answers({ [SCHED_A]: FULL_ANSWER })} loadDetail={async () => ({ ok: false, reason: 'offline-no-copy' })} />);
        const slot = screen.getByTestId('follow-totals-slot');
        expect(slot).toHaveTextContent('कोणाची पद्धत किती फॉलो होते?');
        expect(slot.textContent).not.toMatch(/[0-9०-९]/);
        expect(screen.queryByTestId('follow-totals-screen')).toBeNull();
        fireEvent.click(slot);
        expect(screen.getByTestId('follow-totals-screen')).toBeInTheDocument();
        expect(await screen.findByTestId(`totals-following-${SCHED_A}`)).toHaveTextContent('३७ / ५२ शेतकरी फॉलो करतात');
        fireEvent.click(screen.getByTestId('totals-back'));
        expect(screen.queryByTestId('follow-totals-screen')).toBeNull();
    });
});
