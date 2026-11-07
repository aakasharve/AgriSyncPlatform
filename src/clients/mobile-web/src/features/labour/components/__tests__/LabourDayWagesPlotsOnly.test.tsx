// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25, lane MU-1 (founder D-70 option 2, register F124) — a seat that covers
 * only SOME plots sees NO day wages: the हजेरी page's home draws the job-work (उक्ते काम) card and one line that says the
 * day wages are not shown to him, and never the "दिवसाच्या हिशोबाने · नोंदलेली" card (the server also sends that figure
 * blank, so the card would read "—" and look like "nothing stated"). A seat on every plot, and an older server, draw both
 * cards exactly as before. Marathi and English twins. Real DTO mapper, real component.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const h = vi.hoisted(() => ({ lang: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => k }),
}));

const mockGet = vi.fn();
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: (...args: unknown[]) => mockGet(...args) } },
}));
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({ VerifyLogCommand: { enqueue: vi.fn() } }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));

import LabourHub from '../LabourHub';
import { fetchLabourData, type LabourDataDto } from '../../data/labourClient';
import { plotScopeCopy } from '../../../profile/team/plotScopeCopy';

const wire = (scopedToPlots: boolean | undefined, rojandariStated: number | null): LabourDataDto => ({
    topLevelIds: [],
    people: [],
    dashboard: {
        weekLabel: '', windowFrom: '2026-10-26', windowTo: '2026-11-01', insight: '', manDays: 4, manDaysTrend: 0,
        wages: 1212.12, advances: 0, owed: 0, logs: 2, pending: 0, plots: [],
        money: { recorded: 1212.12, paid: 1212.12, advance: 0, owed: 0 },
    },
    ledger: { weekLabel: '', days: [], rows: [], crewRows: [] },
    view: 'owner',
    home: { rojandariStated, ukteAgreed: 5000, onFarmToday: null, rojandariToday: null, ukteToday: null },
    review: [],
    attendance: { plot: '', headcount: null, rows: [] },
    canManageLabour: true,
    ...(scopedToPlots === undefined ? {} : { scopedToPlots }),
} as unknown as LabourDataDto);

const load = async (dto: LabourDataDto) => {
    mockGet.mockResolvedValue({ data: dto });
    return fetchLabourData('farm-1');
};

const noop = () => {};
const hubProps = { onOpenMukadam: noop, onOpenPerson: noop, onAttendance: noop, onNoWorkAttendance: noop, onDashboard: noop,
    onLedger: noop, onReview: noop, onGoToLog: noop, anchor: { state: 'no-anchor' } as never };

afterEach(() => { cleanup(); mockGet.mockReset(); h.lang = 'mr'; });

describe('D-70 option 2: the home of the हजेरी page for a seat on chosen plots', () => {
    it('draws the job-work card and the note, never the day-wage card', async () => {
        render(<LabourHub data={await load(wire(true, null))} {...hubProps} />);
        expect(screen.queryByText('दिवसाच्या हिशोबाने')).toBeNull();
        expect(screen.getAllByText('उक्ते काम').length).toBeGreaterThan(0);
        expect(screen.getByText('₹5,000')).toBeInTheDocument();
        expect(screen.getByTestId('labour-home-day-wages-note').textContent).toBe(plotScopeCopy('mr').dayWagesNote);
        expect(plotScopeCopy('mr').dayWagesNote).toMatch(/[ऀ-ॿ]/);
    });

    it('English mode: the note is the English twin, with no Marathi in it', async () => {
        h.lang = 'en';
        render(<LabourHub data={await load(wire(true, null))} {...hubProps} />);
        const note = screen.getByTestId('labour-home-day-wages-note').textContent ?? '';
        expect(note).toBe(plotScopeCopy('en').dayWagesNote);
        expect(note).not.toMatch(/[ऀ-ॿ]/);
        expect(note.length).toBeGreaterThan(10);
    });

    it('a seat on every plot (or an older server) draws both cards and no note, as before', async () => {
        render(<LabourHub data={await load(wire(false, 2400))} {...hubProps} />);
        expect(screen.getByText('दिवसाच्या हिशोबाने')).toBeInTheDocument();
        expect(screen.getAllByText('उक्ते काम').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('labour-home-day-wages-note')).toBeNull();
        cleanup();
        render(<LabourHub data={await load(wire(undefined, 2400))} {...hubProps} />);
        expect(screen.getByText('दिवसाच्या हिशोबाने')).toBeInTheDocument();
        expect(screen.queryByTestId('labour-home-day-wages-note')).toBeNull();
    });
});
