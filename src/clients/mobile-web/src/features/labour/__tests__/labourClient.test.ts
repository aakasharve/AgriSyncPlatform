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
// Mock the SHARED api client. BUG 1 (2026-08-10): labourClient no longer owns
// a private `fetch` + `authHeaders()` copy; it calls `agriSyncClient.http`,
// the one axios instance whose interceptors attach the access token and turn
// a 401 into refresh-once-and-replay. These tests therefore assert the CALL
// (path + that it goes through the shared client) and the DTO mapping; the
// auth header and the 401 retry are the shared client's own contract.
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: (...args: unknown[]) => mockGet(...args) } },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { fetchLabourData, labourDataPath, type LabourDataDto } from '../data/labourClient';

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
                status: 'Draft',
                points: { count: 4, shift: 'full', task: 'फवारणी', amount: null, names: ['रमेश'] },
            },
        ],
        attendance: { plot: '', headcount: 0, rows: [] },
    };
}

/** An axios-shaped success envelope. */
function mockOkResponse(body: unknown) {
    return { status: 200, data: body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('labourClient.fetchLabourData', () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    // BUG 1 lock (2026-08-10): the request MUST go through the shared
    // `agriSyncClient.http`. That instance is the one that attaches the
    // in-memory access token and, on a 401, refreshes the session once and
    // replays the request. A future hand-rolled `fetch()` here would
    // reintroduce the dead "माहिती आणता आली नाही" screen and fail this test.
    it('issues GET /shramsafal/farms/{farmId}/labour through the shared api client', async () => {
        mockGet.mockResolvedValueOnce(mockOkResponse(buildDto()));

        await fetchLabourData('farm-123');

        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockGet.mock.calls[0][0]).toBe('/shramsafal/farms/farm-123/labour');
        expect(labourDataPath('farm-123')).toBe('/shramsafal/farms/farm-123/labour');
    });

    it('maps the people LIST into a Record<id, LabourPerson> dict', async () => {
        mockGet.mockResolvedValueOnce(mockOkResponse(buildDto()));

        const data = await fetchLabourData('farm-123');

        expect(Object.keys(data.people).sort()).toEqual(['p1', 'p2']);
        expect(data.people['p1'].name).toBe('रमेश');
        expect(data.people['p2'].name).toBe('रोकडे');
        expect(data.topLevelIds).toEqual(['p1', 'p2']);
    });

    it('passes each person balance (recorded/paid/advance) through UNCHANGED', async () => {
        mockGet.mockResolvedValueOnce(mockOkResponse(buildDto()));

        const data = await fetchLabourData('farm-123');

        expect(data.people['p1'].balance).toEqual({ recorded: 5400.5, paid: 1200.25, advance: 2000 });
        expect(data.people['p2'].balance).toEqual({ recorded: 9500, paid: 3000, advance: 10000 });
    });

    it('passes dashboard.money through UNCHANGED (no re-rounding/re-derivation)', async () => {
        mockGet.mockResolvedValueOnce(mockOkResponse(buildDto()));

        const data = await fetchLabourData('farm-123');

        expect(data.dashboard.money).toEqual({ recorded: 16800.75, paid: 8400.25, advance: 3000, owed: 5400.5 });
        expect(data.dashboard.wages).toBe(8400);
        expect(data.dashboard.advances).toBe(3000);
        expect(data.dashboard.owed).toBe(5400);
    });

    // Task 1 (spec: 2026-08-28-labour-v2-release-1, P4) — a null
    // recordedWages/owed on the wire is an ABSENCE of job-card evidence, not
    // a zero. The mapper must pass `null` straight through — never `?? 0`,
    // which would silently reintroduce the exact fabrication this task fixes.
    it('passes a null recordedWages/owed straight through — never coerced to 0', async () => {
        const dto = buildDto();
        dto.people[0].recordedWages = null;
        dto.dashboard.owed = null;
        dto.dashboard.money.recorded = null;
        dto.dashboard.money.owed = null;
        mockGet.mockResolvedValueOnce(mockOkResponse(dto));

        const data = await fetchLabourData('farm-123');

        expect(data.people['p1'].balance.recorded).toBeNull();
        expect(data.dashboard.owed).toBeNull();
        expect(data.dashboard.money.recorded).toBeNull();
        expect(data.dashboard.money.owed).toBeNull();
    });

    it('populates review[].points and review[].status from the DTO', async () => {
        mockGet.mockResolvedValueOnce(mockOkResponse(buildDto()));

        const data = await fetchLabourData('farm-123');

        expect(data.review).toHaveLength(1);
        expect(data.review[0].status).toBe('Draft');
        expect(data.review[0].points).toEqual({
            count: 4,
            shift: 'full',
            task: 'फवारणी',
            amount: undefined,
            names: ['रमेश'],
        });
    });

    it('propagates a non-OK response so the caller can show an honest error (never mock money)', async () => {
        mockGet.mockRejectedValueOnce(new Error('Request failed with status code 403'));

        await expect(fetchLabourData('farm-123')).rejects.toThrow('403');
    });

    // BUG 1: the shared client's response interceptor turns a 401 into ONE
    // refresh + ONE replay, so by the time the rejection surfaces here the
    // recovery attempt is already spent. `fetchLabourData` must NOT add a
    // second retry of its own (that would double every request on a genuinely
    // dead session) — it just propagates.
    it('does not re-issue the request itself when the shared client finally rejects', async () => {
        mockGet.mockRejectedValueOnce(new Error('Request failed with status code 401'));

        await expect(fetchLabourData('farm-123')).rejects.toThrow('401');
        expect(mockGet).toHaveBeenCalledTimes(1);
    });
});
