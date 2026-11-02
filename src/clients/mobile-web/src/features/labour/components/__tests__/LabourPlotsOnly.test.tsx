// @vitest-environment jsdom
/**
 * spec: plr-d10 lane MU-4 fix pass 2 (M1 label; D-26, design §11.6) — on a seat with chosen plots every money figure on
 * the हजेरी page counts his plots' job cards, payouts and records only (the server says so: `scopedToPlots`). The page
 * says it in the founder's existing words, "तुमच्या प्लॉटचे", beside the window's tiles, the money card and the home
 * money cards; a seat on every plot (and an older server) shows nothing new. Real DTO mapper, real components.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockGet = vi.fn();
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: (...args: unknown[]) => mockGet(...args) } },
}));
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({ VerifyLogCommand: { enqueue: vi.fn() } }));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));

import LabourHub from '../LabourHub';
import WeeklyDashboard from '../WeeklyDashboard';
import { fetchLabourData, type LabourDataDto } from '../../data/labourClient';

const wire = (scopedToPlots?: boolean): LabourDataDto => ({
    topLevelIds: [],
    people: [],
    dashboard: {
        weekLabel: '', windowFrom: '2026-10-26', windowTo: '2026-11-01', insight: '', manDays: 4, manDaysTrend: 0,
        wages: 1212.12, advances: 0, owed: 0, logs: 2, pending: 0, plots: [],
        money: { recorded: 1212.12, paid: 1212.12, advance: 0, owed: 0 },
    },
    ledger: { weekLabel: '', days: [], rows: [], crewRows: [] },
    view: 'owner',
    home: { rojandariStated: 2400, ukteAgreed: null, onFarmToday: null, rojandariToday: null, ukteToday: null },
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
const dashboardProps = { onReview: noop, onLedger: noop, onToast: noop, timeWindow: 'week' as const, onTimeWindowChange: noop };
const hubProps = { onOpenMukadam: noop, onOpenPerson: noop, onAttendance: noop, onNoWorkAttendance: noop, onDashboard: noop,
    onLedger: noop, onReview: noop, onGoToLog: noop, anchor: { state: 'no-anchor' } as never };

afterEach(() => { cleanup(); mockGet.mockReset(); });

describe('the हजेरी page says when its money is his plots\' only', () => {
    it('the mapper carries the server\'s word; absent = the whole farm\'s', async () => {
        expect((await load(wire(true))).scopedToPlots).toBe(true);
        expect((await load(wire())).scopedToPlots).toBe(false);
    });

    it('a seat on chosen plots: the window\'s tiles and the money card read "तुमच्या प्लॉटचे"', async () => {
        render(<WeeklyDashboard data={await load(wire(true))} {...dashboardProps} />);
        expect(screen.getByTestId('labour-plots-only').textContent).toContain('तुमच्या प्लॉटचे');
        expect(screen.getByTestId('labour-money-plots-only').textContent).toContain('तुमच्या प्लॉटचे');
    });

    it('…and so do the home money cards', async () => {
        render(<LabourHub data={await load(wire(true))} {...hubProps} />);
        expect(screen.getByTestId('labour-home-plots-only').textContent).toBe('तुमच्या प्लॉटचे');
    });

    it('a seat on every plot, or an older server: nothing new is said', async () => {
        render(<WeeklyDashboard data={await load(wire(false))} {...dashboardProps} />);
        expect(screen.queryByTestId('labour-plots-only')).toBeNull();
        expect(screen.queryByTestId('labour-money-plots-only')).toBeNull();
        cleanup();
        render(<LabourHub data={await load(wire())} {...hubProps} />);
        expect(screen.queryByTestId('labour-home-plots-only')).toBeNull();
    });
});
