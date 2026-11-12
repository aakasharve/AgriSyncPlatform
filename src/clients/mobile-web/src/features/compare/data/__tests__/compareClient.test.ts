// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D2 Task 3; D-68, D-81, R33; P4, P9, P10, P11)
 *
 * The phone client of `GET /shramsafal/farms/{farmId}/compare`, over a fake-indexeddb phone database with the answer put at the phone's own
 * HTTP door: the answer is read as a WHOLE or not at all; it is kept per farm with the time the server gave it and tagged with the signed-in
 * user; with no net the kept answer of THIS farm and THIS user comes back with its time; another farm's or another user's is never shown; a
 * refusal draws nothing and forgets what was kept; a bad answer draws nothing and never throws into a page.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agriSyncClient } from '../../../../infrastructure/api/AgriSyncClient';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { setAuthSession, clearAuthSession } from '../../../../infrastructure/storage/AuthTokenStore';
import { farmComparePath, loadFarmCompare } from '../compareClient';
import { compareMetaKey } from '../compareStore';
import { parseFarmCompare } from '../compareDtos';

const FARM = '11111111-1111-4111-8111-111111111111';
const OTHER_FARM = '22222222-2222-4222-8222-222222222222';
const PLOT = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER = 'bbbbbbbb-0000-4000-8000-000000000001';
const OTHER_USER = 'bbbbbbbb-0000-4000-8000-000000000002';

const counts = {
    asked: 4, done: 1, notYet: 3, saidNotDone: 0, moreThanAsked: 0,
    parts: [{ part: 'spray', items: [{ activityId: 'a0000000-0000-4000-8000-000000000001', title: 'बुरशीनाशक फवारणी', asked: 4, done: 1, notYet: 3, saidNotDone: 0, moreThanAsked: 0 }] }],
};
const ANSWER = {
    serverTimeUtc: '2026-11-12T06:30:00Z',
    plots: [{
        plotId: PLOT, cropCycleId: 'cccccccc-0000-4000-8000-000000000001', inTrial: false, day: 20, totalDays: 99,
        stages: [
            { name: 'Post Pruning', state: 'passed', startDay: 0, endDay: 12, daysLeft: null },
            { name: 'Canopy Build', state: 'current', startDay: 13, endDay: 40, daysLeft: 20 },
            { name: 'Berry Development', state: 'ahead', startDay: 41, endDay: 99, daysLeft: null },
        ],
        schedules: [{
            subscriptionId: 'dddddddd-0000-4000-8000-00000000000a', templateId: '10000000-0000-4000-8000-000000000002', name: 'द्राक्ष विद्यापीठ शेड्यूल',
            check: { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null },
            slot: 1, origin: 'Outside', isMain: true, stages: [{ ...counts, asked: 2, done: 2, notYet: 0 }, counts, null],
            order: [{ firstTitle: 'घड विरळणी', thenTitle: 'जीए (संजीवक) बुडवणी', firstDay: 46, thenDay: 44 }],
        }],
        ownWork: [{ dailyLogId: 'eeeeeeee-0000-4000-8000-000000000001', workKey: 'work:op_tying', day: 19, stageName: 'Canopy Build', part: 'work', title: 'वेली बांधणी', matchedWords: ['बांधणी'], reason: null }],
        notRecognised: [],
    }],
    recogniserVersions: { vocabulary: 'work-vocab-1', catalog: 'input-catalog-1' },
};

const asResponse = (data: unknown) => ({ data, status: 200 });
const serves = (data: unknown) => vi.spyOn(agriSyncClient.http, 'get').mockResolvedValue(asResponse(data) as never);
const refuses = (status: number) => vi.spyOn(agriSyncClient.http, 'get').mockRejectedValue({ response: { status } });
const noNet = () => vi.spyOn(agriSyncClient.http, 'get').mockRejectedValue(new Error('Network Error'));
const signIn = (userId: string) => setAuthSession({ userId, accessToken: 'test-token', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });

describe('the तुलना client (CMP-D2)', () => {
    beforeEach(async () => {
        await resetDatabase();
        await getDatabase().appMeta.clear();
        signIn(USER);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        clearAuthSession();
    });

    it('asks the farm compare route and reads the whole answer', async () => {
        const get = serves(ANSWER);

        const result = await loadFarmCompare(FARM);

        expect(get).toHaveBeenCalledWith(farmComparePath(FARM));
        expect(farmComparePath(FARM)).toBe(`/shramsafal/farms/${FARM}/compare`);
        expect(result.kind).toBe('compare');
        if (result.kind !== 'compare') return;
        expect(result.source).toBe('server');
        expect(result.asOfUtc).toBe('2026-11-12T06:30:00Z');
        const stages = result.compare.plots[0].schedules[0].stages;
        expect(stages[1]?.asked).toBe(4);
        expect(stages[2]).toBeNull();
        expect(result.compare.plots[0].ownWork[0].title).toBe('वेली बांधणी');
    });

    it('an answer with one field wrong draws nothing at all (whole or nothing) and never throws', () => {
        const bad = JSON.parse(JSON.stringify(ANSWER));
        bad.plots[0].schedules[0].stages[1].done = 'one';
        expect(parseFarmCompare(bad)).toBeNull();
        const missingStage = JSON.parse(JSON.stringify(ANSWER));
        missingStage.plots[0].schedules[0].stages.pop(); // numbers would be drawn under the wrong stage
        expect(parseFarmCompare(missingStage)).toBeNull();
        expect(parseFarmCompare(null)).toBeNull();
        expect(parseFarmCompare('nope')).toBeNull();
        expect(parseFarmCompare({})).toBeNull();
    });

    it('a bad answer from the server draws nothing and does not replace what was kept', async () => {
        serves(ANSWER);
        await loadFarmCompare(FARM);
        const bad = JSON.parse(JSON.stringify(ANSWER));
        bad.plots[0].stages[0].state = 'amber';
        serves(bad);

        expect(await loadFarmCompare(FARM)).toEqual({ kind: 'none' });

        noNet();
        const kept = await loadFarmCompare(FARM);
        expect(kept.kind).toBe('compare');
    });

    it('offline returns the kept answer with the time the server gave it', async () => {
        serves(ANSWER);
        await loadFarmCompare(FARM);

        noNet();
        const result = await loadFarmCompare(FARM);

        expect(result.kind).toBe('compare');
        if (result.kind !== 'compare') return;
        expect(result.source).toBe('cache');
        expect(result.asOfUtc).toBe('2026-11-12T06:30:00Z');
        expect(result.compare.plots[0].plotId).toBe(PLOT);
    });

    it('the device saying it is offline answers from the cache without asking the server', async () => {
        serves(ANSWER);
        await loadFarmCompare(FARM);
        const get = vi.spyOn(agriSyncClient.http, 'get').mockClear();
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

        const result = await loadFarmCompare(FARM);

        expect(get).not.toHaveBeenCalled();
        expect(result.kind).toBe('compare');
    });

    it('offline with nothing kept says offline, not an empty answer', async () => {
        noNet();
        expect(await loadFarmCompare(FARM)).toEqual({ kind: 'offline' });
    });

    it("another farm's kept answer is never shown", async () => {
        serves(ANSWER);
        await loadFarmCompare(FARM);

        noNet();
        expect(await loadFarmCompare(OTHER_FARM)).toEqual({ kind: 'offline' });
        const row = await getDatabase().appMeta.get(compareMetaKey(OTHER_FARM));
        expect(row).toBeUndefined();
    });

    it("another user's kept answer on the same phone and farm is never shown", async () => {
        serves(ANSWER);
        await loadFarmCompare(FARM);

        signIn(OTHER_USER);
        noNet();
        expect(await loadFarmCompare(FARM)).toEqual({ kind: 'offline' });

        signIn(USER);
        expect((await loadFarmCompare(FARM)).kind).toBe('compare'); // the first user's own answer is still his
    });

    it('with no user known nothing is kept and nothing kept is read', async () => {
        clearAuthSession();
        serves(ANSWER);
        const online = await loadFarmCompare(FARM);
        expect(online.kind).toBe('compare');
        expect(await getDatabase().appMeta.get(compareMetaKey(FARM))).toBeUndefined();

        signIn(USER);
        serves(ANSWER);
        await loadFarmCompare(FARM);
        clearAuthSession();
        noNet();
        expect(await loadFarmCompare(FARM)).toEqual({ kind: 'offline' });
    });

    it.each([403, 404])('a %i draws nothing and forgets what was kept', async status => {
        serves(ANSWER);
        await loadFarmCompare(FARM);
        expect(await getDatabase().appMeta.get(compareMetaKey(FARM))).toBeDefined();

        refuses(status);
        expect(await loadFarmCompare(FARM)).toEqual({ kind: 'none' });
        expect(await getDatabase().appMeta.get(compareMetaKey(FARM))).toBeUndefined();
    });

    it('any other server error draws nothing and keeps what was kept', async () => {
        serves(ANSWER);
        await loadFarmCompare(FARM);

        refuses(500);
        expect(await loadFarmCompare(FARM)).toEqual({ kind: 'none' });
        expect(await getDatabase().appMeta.get(compareMetaKey(FARM))).toBeDefined();
    });

    it('no farm is not asked at all', async () => {
        const get = serves(ANSWER);
        expect(await loadFarmCompare(null)).toEqual({ kind: 'none' });
        expect(await loadFarmCompare(undefined)).toEqual({ kind: 'none' });
        expect(get).not.toHaveBeenCalled();
    });

    it('the answer carries no amber, partial or day-changed word (R33)', () => {
        const names = new Set<string>();
        const walk = (v: unknown) => {
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { names.add(k); walk(x); }
        };
        walk(parseFarmCompare(ANSWER));
        expect([...names].filter(n => /amber|partial|differ|changed|^ok$|^miss$/i.test(n))).toEqual([]);
    });
});
