/**
 * fieldOperatorClient tests — Task 12, spec: 2026-07-13-labour-attendance-approval-design
 *
 * Locks the DTO -> FieldOperator[] mapping for `fetchFieldOperators`:
 *   - issues GET through the SHARED api client (same transport contract as
 *     labourClient — BUG 1, 2026-08-10 — no private fetch()/authHeaders()).
 *   - `fullName: null` maps to `fullName: undefined` (labourClient's
 *     null -> undefined convention for optional fields).
 *   - `isActive` passes through unchanged, including `false`.
 *   - a rejected response propagates (no mock fallback, no silent retry —
 *     the shared client's response interceptor already spent its one
 *     refresh + replay by the time a rejection reaches here).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the SHARED api client — same pattern as labourClient.test.ts.
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: (...args: unknown[]) => mockGet(...args) } },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import {
    fetchFieldOperators,
    fieldOperatorsPath,
    type FieldOperatorSummaryDto,
} from '../data/fieldOperatorClient';

// ---------------------------------------------------------------------------
// Fixture — a FieldOperatorSummaryDto[] JSON as the backend (Task 12) would
// serve it.
// ---------------------------------------------------------------------------

function buildDtos(): FieldOperatorSummaryDto[] {
    return [
        { id: 'fo-1', displayName: 'बाळू', fullName: 'Balu Shinde', isActive: true },
        { id: 'fo-2', displayName: 'गणेश', fullName: null, isActive: false },
    ];
}

/** An axios-shaped success envelope. */
function mockOkResponse(body: unknown) {
    return { status: 200, data: body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fieldOperatorClient.fetchFieldOperators', () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it('issues GET /shramsafal/farms/{farmId}/labour/field-operators through the shared api client', async () => {
        mockGet.mockResolvedValueOnce(mockOkResponse(buildDtos()));

        await fetchFieldOperators('farm-123');

        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockGet.mock.calls[0][0]).toBe('/shramsafal/farms/farm-123/labour/field-operators');
        expect(fieldOperatorsPath('farm-123')).toBe(
            '/shramsafal/farms/farm-123/labour/field-operators',
        );
    });

    it('maps the DTO list into FieldOperator[] field-for-field', async () => {
        mockGet.mockResolvedValueOnce(mockOkResponse(buildDtos()));

        const operators = await fetchFieldOperators('farm-123');

        expect(operators).toHaveLength(2);
        expect(operators[0]).toEqual({
            id: 'fo-1',
            displayName: 'बाळू',
            fullName: 'Balu Shinde',
            isActive: true,
        });
    });

    it('maps a null fullName to undefined (labourClient convention)', async () => {
        mockGet.mockResolvedValueOnce(mockOkResponse(buildDtos()));

        const operators = await fetchFieldOperators('farm-123');

        expect(operators[1].fullName).toBeUndefined();
    });

    it('passes isActive through unchanged, including false', async () => {
        mockGet.mockResolvedValueOnce(mockOkResponse(buildDtos()));

        const operators = await fetchFieldOperators('farm-123');

        expect(operators[0].isActive).toBe(true);
        expect(operators[1].isActive).toBe(false);
    });

    it('returns an empty array for a farm with no field operators (not an error)', async () => {
        mockGet.mockResolvedValueOnce(mockOkResponse([]));

        const operators = await fetchFieldOperators('farm-123');

        expect(operators).toEqual([]);
    });

    it('propagates a non-OK response so the caller can show an honest error (never mock data)', async () => {
        mockGet.mockRejectedValueOnce(new Error('Request failed with status code 403'));

        await expect(fetchFieldOperators('farm-123')).rejects.toThrow('403');
    });

    // Same BUG 1 lock as labourClient: the shared client's response
    // interceptor turns a 401 into ONE refresh + ONE replay, so by the time
    // the rejection surfaces here the recovery attempt is already spent.
    // fetchFieldOperators must NOT add a second retry of its own.
    it('does not re-issue the request itself when the shared client finally rejects', async () => {
        mockGet.mockRejectedValueOnce(new Error('Request failed with status code 401'));

        await expect(fetchFieldOperators('farm-123')).rejects.toThrow('401');
        expect(mockGet).toHaveBeenCalledTimes(1);
    });
});
