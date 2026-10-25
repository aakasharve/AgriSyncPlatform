// @vitest-environment node
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places), review B001 / B003 — the tests client
 * against the server's REAL wire shapes.
 *
 *   - B001: `POST /test-instances/{id}/report` answers `{ testInstanceId, status, recommendations }` where
 *     each recommendation is `TestRecommendationDto` in camelCase — `recommendationId`, not `id`. The client
 *     maps it to the phone's row (`id`) in one place and keeps the SERVER's `createdAtUtc`.
 *   - B003: a failure carries its HTTP status and the server's `{ error }` code, so the page can tell
 *     "not allowed" (403, an empty `Forbid()`) from "already moved on" (400 `ShramSafal.TestInvalidState`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({ getAuthSession: () => null }));

import { TestsApiError, mapApiRecommendationToDexie, markCollected, recordResult, addRecommendationToPlan } from '../testsClient';

const SERVER_REC = {
    recommendationId: '6f1c2b9e-0a4d-4c55-9f61-2d7e3a9b1c01',
    testInstanceId: 'ti-1',
    ruleCode: 'soil.n.low.apply-urea',
    titleEn: 'Nitrogen low — schedule urea',
    titleMr: 'नायट्रोजन कमी — युरिया नियोजन करा',
    suggestedActivityName: 'Urea application',
    suggestedOffsetDays: 3,
    createdAtUtc: '2026-10-25T05:59:58.123Z',
};

const reply = (status: number, body?: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
        if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return body;
    },
});

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); });

describe('B001 — recommendations, from the server\'s shape to the phone\'s row', () => {
    it('maps recommendationId → id and keeps every other field, the server\'s time included', () => {
        expect(mapApiRecommendationToDexie(SERVER_REC)).toEqual({
            id: SERVER_REC.recommendationId,
            testInstanceId: 'ti-1',
            ruleCode: 'soil.n.low.apply-urea',
            titleEn: 'Nitrogen low — schedule urea',
            titleMr: 'नायट्रोजन कमी — युरिया नियोजन करा',
            suggestedActivityName: 'Urea application',
            suggestedOffsetDays: 3,
            createdAtUtc: '2026-10-25T05:59:58.123Z',
        });
    });

    it('recordResult hands every caller rows keyed by id', async () => {
        fetchMock.mockResolvedValue(reply(200, { testInstanceId: 'ti-1', status: 'Reported', recommendations: [SERVER_REC] }));
        const res = await recordResult('ti-1', [{ parameterCode: 'N', parameterValue: '140', unit: 'kg/ha' }], ['att-1']);
        expect(res.testInstanceId).toBe('ti-1');
        expect(res.status).toBe('Reported');
        expect(res.recommendations).toEqual([mapApiRecommendationToDexie(SERVER_REC)]);
        expect(res.recommendations[0].id).toBe(SERVER_REC.recommendationId);
        expect(res.recommendations[0]).not.toHaveProperty('recommendationId');
    });

    it('recordResult with no recommendations returns an empty list', async () => {
        fetchMock.mockResolvedValue(reply(200, { testInstanceId: 'ti-1', status: 'Reported', recommendations: [] }));
        expect((await recordResult('ti-1', [], ['att-1'])).recommendations).toEqual([]);
    });
});

describe('B003 — a failure says what the server said', () => {
    it('403 (Forbid, no body): status 403, no code', async () => {
        fetchMock.mockResolvedValue(reply(403));
        const err = await markCollected('ti-1').catch(e => e);
        expect(err).toBeInstanceOf(TestsApiError);
        expect(err).toMatchObject({ status: 403, code: undefined, message: 'markCollected failed (403)' });
    });

    it('400 with the server\'s { error } body: the code is kept', async () => {
        fetchMock.mockResolvedValue(reply(400, { error: 'ShramSafal.TestInvalidState', message: 'Test instance is not in a valid state for this action.' }));
        const err = await recordResult('ti-1', [], []).catch(e => e);
        expect(err).toMatchObject({ status: 400, code: 'ShramSafal.TestInvalidState' });
        expect(err.message).toBe('recordResult failed (400) ShramSafal.TestInvalidState');
    });

    it('every call uses it — addRecommendationToPlan too', async () => {
        fetchMock.mockResolvedValue(reply(500, { error: 'ShramSafal.Unexpected' }));
        await expect(addRecommendationToPlan({
            cropCycleId: 'c', farmId: 'f', activityName: 'a', stage: 's', plannedDate: '2026-10-29', reason: 'r',
        })).rejects.toMatchObject({ name: 'TestsApiError', status: 500, code: 'ShramSafal.Unexpected' });
    });
});
