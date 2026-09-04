/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * labourClient — the adjustable time window (Task 11, spec:
 * 2026-08-28-labour-v2-release-1; server half landed in `da07f668`).
 *
 * `GET /shramsafal/farms/{farmId}/labour` gained an OPTIONAL
 * `?window=alltime|today|week|month` (`LabourTimeWindow.Resolve`). These tests
 * lock the CLIENT half of that contract: which value leaves the device for
 * each of the four windows, and that the default is the founder-chosen
 * आजपर्यंत (all time).
 *
 * WHY THE PARAMETER IS ALWAYS SENT, never omitted for the default. The server
 * treats an OMITTED window as all-time, so `alltime` could ride on silence —
 * but silence is what a client that predates the parameter also sends
 * (`LabourTimeWindow.Resolve`'s own doc says so). A request that states its
 * window says which question was asked; one that omits it is indistinguishable
 * from a request that never knew the question existed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: (...args: unknown[]) => mockGet(...args) } },
}));

import { fetchLabourData, type LabourDataDto } from '../data/labourClient';
import { LABOUR_WINDOW_ORDER, DEFAULT_LABOUR_WINDOW } from '../labourWindow';

/** The smallest DTO `fetchLabourData`'s mapper will accept. */
function buildDto(): LabourDataDto {
    return {
        topLevelIds: [],
        people: [],
        dashboard: {
            weekLabel: '',
            insight: '',
            manDays: null,
            manDaysTrend: 0,
            wages: 0,
            advances: 0,
            owed: null,
            logs: 0,
            pending: 0,
            plots: [],
            money: { recorded: null, paid: 0, advance: 0, owed: null },
        },
        ledger: { weekLabel: '', days: [], rows: [], crewRows: [] },
        review: [],
        attendance: { plot: '', headcount: 0, rows: [] },
        view: 'owner',
        home: { rojandariStated: null, ukteAgreed: null, onFarmToday: null, rojandariToday: null, ukteToday: null },
    };
}

const okResponse = () => ({ data: buildDto() });

describe('labourClient — adjustable time window', () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it('defaults to आजपर्यंत (alltime) when no window is asked for', async () => {
        mockGet.mockResolvedValueOnce(okResponse());

        await fetchLabourData('farm-123');

        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockGet.mock.calls[0][0]).toBe('/shramsafal/farms/farm-123/labour');
        expect(mockGet.mock.calls[0][1]).toEqual({ params: { window: 'alltime' } });
        // Read off the shared constant, not a second literal — the default the
        // hook opens on and the default this client sends must be ONE fact.
        expect(DEFAULT_LABOUR_WINDOW).toBe('alltime');
    });

    it.each(LABOUR_WINDOW_ORDER)('sends the exact wire value the server resolves for %s', async (window) => {
        mockGet.mockResolvedValueOnce(okResponse());

        await fetchLabourData('farm-123', window);

        expect(mockGet.mock.calls[0][1]).toEqual({ params: { window } });
    });

    it('sends the four wire values LabourTimeWindow.Resolve accepts — no fifth, no rename', () => {
        // Mirrors the backend constants (`LabourTimeWindow.AllTime/Today/Week/
        // Month`). A rename on either side must break here rather than silently
        // fall into the server's "unrecognised window" 400.
        expect([...LABOUR_WINDOW_ORDER]).toEqual(['alltime', 'today', 'week', 'month']);
    });

    it('still maps the response the same way whichever window was asked for', async () => {
        mockGet.mockResolvedValueOnce(okResponse());

        const data = await fetchLabourData('farm-123', 'month');

        // Absence stays absence under every window (P4/Ruling R8).
        expect(data.dashboard.manDays).toBeNull();
        expect(data.dashboard.money).toEqual({ recorded: null, paid: 0, advance: 0, owed: null });
    });
});
