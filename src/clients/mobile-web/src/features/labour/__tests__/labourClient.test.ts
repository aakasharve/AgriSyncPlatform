/**
 * labourClient tests — Task 1.4, spec: 2026-07-13-labour-attendance-approval-design
 *
 * Locks the DTO→LabourData mapping for `fetchLabourData`:
 *   - `people` (a DTO LIST) maps to a `Record<id, LabourPerson>` dict.
 *   - Each person's Option-3 wage-book balance (`recordedWages, paid, advance`)
 *     passes through UNCHANGED as `balance.{recorded, paid, advance}` — no
 *     re-rounding, no re-derivation.
 *   - `dashboard.money` passes through unchanged.
 *   - `review[].points` populate from the DTO's `points` object.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock AuthTokenStore — labourClient reads getAuthSession() for the bearer token.
// ---------------------------------------------------------------------------

vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ accessToken: 'tok-test', userId: 'user-1', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof global.fetch;

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { fetchLabourData, type LabourDataDto } from '../data/labourClient';

// ---------------------------------------------------------------------------
// Fixture — a LabourDataDto JSON as the backend (Task 1.3) would serve it.
// ---------------------------------------------------------------------------

function buildDto(): LabourDataDto {
    return {
        topLevelIds: ['p1', 'p2'],
        people: [
            {
                id: 'p1',
                name: 'रमेश',
                initial: 'र',
                tone: 'or',
                role: 'worker',
                verified: true,
                temporary: false,
                taskScope: null,
                appointedById: null,
                recordedWages: 5400.5,
                paid: 1200.25,
                advance: 2000,
                todayStatus: 'present',
                daysThisWeek: 6,
                memberIds: null,
                trust: 82,
                access: 'review',
                daysActive: 27,
                cleanRecord: true,
            },
            {
                id: 'p2',
                name: 'रोकडे',
                initial: 'रो',
                tone: 'vi',
                role: 'mukadam',
                verified: true,
                temporary: false,
                taskScope: null,
                appointedById: null,
                recordedWages: 9500,
                paid: 3000,
                advance: 10000,
                todayStatus: null,
                daysThisWeek: null,
                memberIds: ['p1'],
                trust: null,
                access: 'review',
                daysActive: 40,
                cleanRecord: null,
            },
        ],
        dashboard: {
            weekLabel: '2026-07-06',
            insight: '',
            manDays: 28,
            manDaysTrend: 0,
            wages: 8400,
            advances: 3000,
            owed: 5400,
            logs: 12,
            pending: 3,
            plots: [{ name: 'द्राक्ष-२', days: 18, pct: 82 }],
            money: { recorded: 16800.75, paid: 8400.25, advance: 3000, owed: 5400.5 },
        },
        ledger: {
            weekLabel: '2026-07-06',
            days: ['सो', 'मं'],
            rows: [
                { personId: 'p1', name: 'रमेश', initial: 'र', tone: 'or', cells: ['present', 'half'], total: 6 },
            ],
            dailyTotals: [3, 4],
            weekTotal: 28,
        },
        review: [
            {
                id: 'r1',
                who: 'रमेश',
                initial: 'र',
                tone: 'or',
                detail: 'द्राक्ष-२ · आज',
                points: { count: 4, shift: 'full', task: 'फवारणी', amount: null, names: ['रमेश'] },
            },
        ],
        attendance: { plot: '', headcount: 0, rows: [] },
    };
}

function mockOkResponse(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
    } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('labourClient.fetchLabourData', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });

    it('calls GET /shramsafal/farms/{farmId}/labour with a bearer auth header', async () => {
        mockFetch.mockResolvedValueOnce(mockOkResponse(buildDto()));

        await fetchLabourData('farm-123');

        const call = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(call[0]).toBe('http://localhost:5048/shramsafal/farms/farm-123/labour');
        const headers = call[1].headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer tok-test');
    });

    it('maps the people LIST into a Record<id, LabourPerson> dict', async () => {
        mockFetch.mockResolvedValueOnce(mockOkResponse(buildDto()));

        const data = await fetchLabourData('farm-123');

        expect(Object.keys(data.people).sort()).toEqual(['p1', 'p2']);
        expect(data.people['p1'].name).toBe('रमेश');
        expect(data.people['p2'].name).toBe('रोकडे');
        expect(data.topLevelIds).toEqual(['p1', 'p2']);
    });

    it('passes each person balance (recorded/paid/advance) through UNCHANGED', async () => {
        mockFetch.mockResolvedValueOnce(mockOkResponse(buildDto()));

        const data = await fetchLabourData('farm-123');

        expect(data.people['p1'].balance).toEqual({ recorded: 5400.5, paid: 1200.25, advance: 2000 });
        expect(data.people['p2'].balance).toEqual({ recorded: 9500, paid: 3000, advance: 10000 });
    });

    it('passes dashboard.money through UNCHANGED (no re-rounding/re-derivation)', async () => {
        mockFetch.mockResolvedValueOnce(mockOkResponse(buildDto()));

        const data = await fetchLabourData('farm-123');

        expect(data.dashboard.money).toEqual({ recorded: 16800.75, paid: 8400.25, advance: 3000, owed: 5400.5 });
        expect(data.dashboard.wages).toBe(8400);
        expect(data.dashboard.advances).toBe(3000);
        expect(data.dashboard.owed).toBe(5400);
    });

    it('populates review[].points from the DTO points object', async () => {
        mockFetch.mockResolvedValueOnce(mockOkResponse(buildDto()));

        const data = await fetchLabourData('farm-123');

        expect(data.review).toHaveLength(1);
        expect(data.review[0].points).toEqual({
            count: 4,
            shift: 'full',
            task: 'फवारणी',
            amount: undefined,
            names: ['रमेश'],
        });
    });

    it('throws on a non-OK response', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

        await expect(fetchLabourData('farm-123')).rejects.toThrow('403');
    });
});
