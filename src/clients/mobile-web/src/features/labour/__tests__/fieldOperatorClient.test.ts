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
const mockPost = vi.fn();
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: {
        http: {
            get: (...args: unknown[]) => mockGet(...args),
            post: (...args: unknown[]) => mockPost(...args),
        },
    },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import {
    attachFieldOperator,
    attachFieldOperatorPath,
    createFieldOperator,
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
        mockPost.mockReset();
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

/*
 * Task 13 (spec: 2026-07-13-labour-attendance-approval-design) — the two
 * WRITE calls the farmer-facing picker makes. Same transport contract as the
 * read above (shared client, no private fetch, no second retry).
 */
describe('fieldOperatorClient.createFieldOperator', () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it('POSTs the trimmed display name to the farm-scoped route and narrows the reply to FieldOperator', async () => {
        mockPost.mockResolvedValueOnce({
            status: 201,
            data: {
                id: 'fo-9',
                displayName: 'बाळू',
                fullName: null,
                originatingFarmId: 'farm-123',
                createdByUserId: 'user-1',
                createdAtUtc: '2026-08-11T10:00:00Z',
                isActive: true,
            },
        });

        const created = await createFieldOperator('farm-123', '  बाळू  ');

        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(mockPost.mock.calls[0][0]).toBe('/shramsafal/farms/farm-123/labour/field-operators');
        expect(mockPost.mock.calls[0][1]).toEqual({ displayName: 'बाळू' });
        // The write-side DTO's provenance fields do not leak into the UI shape.
        expect(created).toEqual({ id: 'fo-9', displayName: 'बाळू', fullName: undefined, isActive: true });
    });

    it('omits fullName entirely when it is blank (the column is nullable, "" is not a name)', async () => {
        mockPost.mockResolvedValueOnce({
            status: 201,
            data: { id: 'fo-9', displayName: 'बाळू', fullName: null, originatingFarmId: 'f', createdByUserId: 'u', createdAtUtc: 'x', isActive: true },
        });

        await createFieldOperator('farm-123', 'बाळू', '   ');

        expect(mockPost.mock.calls[0][1]).toEqual({ displayName: 'बाळू' });
    });

    it('sends fullName when the caller supplies a real one', async () => {
        mockPost.mockResolvedValueOnce({
            status: 201,
            data: { id: 'fo-9', displayName: 'बाळू', fullName: 'बाळू शिंदे', originatingFarmId: 'f', createdByUserId: 'u', createdAtUtc: 'x', isActive: true },
        });

        const created = await createFieldOperator('farm-123', 'बाळू', 'बाळू शिंदे');

        expect(mockPost.mock.calls[0][1]).toEqual({ displayName: 'बाळू', fullName: 'बाळू शिंदे' });
        expect(created.fullName).toBe('बाळू शिंदे');
    });

    // B2: two real people may be called बाळू. A "helpful" pre-check that
    // reused an existing id would merge them — the exact identity bug this
    // feature exists to prevent.
    it('never looks for an existing same-named operator before posting', async () => {
        mockPost.mockResolvedValueOnce({
            status: 201,
            data: { id: 'fo-9', displayName: 'बाळू', fullName: null, originatingFarmId: 'f', createdByUserId: 'u', createdAtUtc: 'x', isActive: true },
        });

        await createFieldOperator('farm-123', 'बाळू');

        expect(mockGet).not.toHaveBeenCalled();
    });
});

describe('fieldOperatorClient.attachFieldOperator', () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it('POSTs the labourAssignmentId to /field-operators/{id}/attach', async () => {
        mockPost.mockResolvedValueOnce({
            status: 200,
            data: { fieldOperatorId: 'fo-1', labourAssignmentId: 'la-1', alreadyAttached: false },
        });

        const result = await attachFieldOperator('farm-123', 'fo-1', 'la-1');

        expect(mockPost.mock.calls[0][0]).toBe('/shramsafal/farms/farm-123/labour/field-operators/fo-1/attach');
        expect(attachFieldOperatorPath('farm-123', 'fo-1')).toBe('/shramsafal/farms/farm-123/labour/field-operators/fo-1/attach');
        expect(mockPost.mock.calls[0][1]).toEqual({ labourAssignmentId: 'la-1' });
        expect(result.alreadyAttached).toBe(false);
    });

    // Task 11.5 — attach is idempotent BY INTENT. A retry is a 200 carrying
    // alreadyAttached: true, and this client must surface it as the success
    // it is rather than turning it into a thrown error.
    it('returns alreadyAttached: true as a successful outcome, not an error', async () => {
        mockPost.mockResolvedValueOnce({
            status: 200,
            data: { fieldOperatorId: 'fo-1', labourAssignmentId: 'la-1', alreadyAttached: true },
        });

        await expect(attachFieldOperator('farm-123', 'fo-1', 'la-1'))
            .resolves.toEqual({ fieldOperatorId: 'fo-1', labourAssignmentId: 'la-1', alreadyAttached: true });
    });

    it('propagates a genuine failure without a second attempt of its own', async () => {
        mockPost.mockRejectedValueOnce(new Error('Request failed with status code 403'));

        await expect(attachFieldOperator('farm-123', 'fo-1', 'la-1')).rejects.toThrow('403');
        expect(mockPost).toHaveBeenCalledTimes(1);
    });
});
