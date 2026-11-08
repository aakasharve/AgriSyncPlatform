// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2 Task 0 item 6, founder D-24c, D-26) - the assignee list: the phone client of
 * `GET /shramsafal/farms/{farmId}/planned-work/assignees`, kept per person and farm in `appMeta` (no Dexie version), read from there when
 * there is no net, and never handed to another person on the same phone.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { http: { get: h.get } } }));

import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { PlannedWorkAssigneeDto } from '../../../infrastructure/api/plannedWorkDtos';
import { assigneesMetaKey, assigneesPath, loadAssignees, readCachedAssignees } from '../data/plannedWorkAssignees';

const FARM = '55555555-5555-4555-8555-555555555551';
const OTHER_FARM = '55555555-5555-4555-8555-555555555552';
const ME = '22222222-2222-4222-8222-222222222222';
const OTHER_USER = '22222222-2222-4222-8222-222222222223';
const LIST: PlannedWorkAssigneeDto[] = [
    { userId: '11111111-1111-4111-8111-111111111112', displayName: 'शंकर', role: 'Mukadam', plotScope: 'AllPlots', plotIds: [] },
    { userId: '11111111-1111-4111-8111-111111111111', displayName: 'राजू', role: 'Worker', plotScope: 'ChosenPlots', plotIds: ['44444444-4444-4444-8444-444444444441'] },
];

const setOnline = (online: boolean) => Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });

beforeEach(async () => {
    h.get.mockReset();
    setOnline(true);
    await resetDatabase();
    await getDatabase().appMeta.clear();
});
afterEach(() => setOnline(true));

describe('the assignee list', () => {
    it('is the server\'s route under /shramsafal, asked with the farm', async () => {
        h.get.mockResolvedValue({ data: LIST });
        expect(assigneesPath(FARM)).toBe(`/shramsafal/farms/${FARM}/planned-work/assignees`);
        const list = await loadAssignees(ME, FARM);
        expect(h.get).toHaveBeenCalledWith(`/shramsafal/farms/${FARM}/planned-work/assignees`);
        expect(list).toMatchObject({ source: 'server', assignees: LIST });
    });

    it('the answer is kept in appMeta per person and farm', async () => {
        h.get.mockResolvedValue({ data: LIST });
        await loadAssignees(ME, FARM);
        const row = await getDatabase().appMeta.get(assigneesMetaKey(ME, FARM));
        expect((row?.value as { assignees: unknown[] }).assignees).toEqual(LIST);
        expect(await readCachedAssignees(ME, OTHER_FARM)).toBeNull();
        expect(await readCachedAssignees(OTHER_USER, FARM)).toBeNull();
    });

    it('is read from the appMeta cache when offline - the server is not asked', async () => {
        h.get.mockResolvedValue({ data: LIST });
        await loadAssignees(ME, FARM);
        h.get.mockClear();
        setOnline(false);
        const list = await loadAssignees(ME, FARM);
        expect(h.get).not.toHaveBeenCalled();
        expect(list.source).toBe('cache');
        expect(list.assignees).toEqual(LIST);
        expect(list.receivedAtUtc).toEqual(expect.any(String));
    });

    it('is read from the cache when the net is on but the call fails', async () => {
        h.get.mockResolvedValueOnce({ data: LIST });
        await loadAssignees(ME, FARM);
        h.get.mockRejectedValueOnce(new Error('Network Error'));
        const list = await loadAssignees(ME, FARM);
        expect(list).toMatchObject({ source: 'cache', assignees: LIST });
    });

    it('offline with nothing kept: an empty list, not a made-up one', async () => {
        setOnline(false);
        expect(await loadAssignees(ME, FARM)).toEqual({ assignees: [], source: 'none', receivedAtUtc: null });
    });

    it('a 403 (this seat may not hand work over) is an empty list and keeps nothing new', async () => {
        h.get.mockRejectedValue({ response: { status: 403 } });
        expect(await loadAssignees(ME, FARM)).toEqual({ assignees: [], source: 'none', receivedAtUtc: null });
        expect(await readCachedAssignees(ME, FARM)).toBeNull();
    });

    it('a 403 clears the kept list of that person for that farm: a later offline read is empty, not the old list (P006)', async () => {
        h.get.mockResolvedValueOnce({ data: LIST });
        await loadAssignees(ME, FARM);
        expect((await readCachedAssignees(ME, FARM))?.assignees).toEqual(LIST);
        h.get.mockRejectedValueOnce({ response: { status: 403 } });
        expect((await loadAssignees(ME, FARM)).assignees).toEqual([]);
        expect(await readCachedAssignees(ME, FARM)).toBeNull();
        setOnline(false);
        expect(await loadAssignees(ME, FARM)).toEqual({ assignees: [], source: 'none', receivedAtUtc: null });
    });

    it('a 403 for one farm leaves the list of the same person for another farm', async () => {
        h.get.mockResolvedValue({ data: LIST });
        await loadAssignees(ME, OTHER_FARM);
        h.get.mockRejectedValueOnce({ response: { status: 403 } });
        await loadAssignees(ME, FARM);
        expect((await readCachedAssignees(ME, OTHER_FARM))?.assignees).toEqual(LIST);
    });

    it('another person on the same phone never reads this person\'s kept list', async () => {
        h.get.mockResolvedValue({ data: LIST });
        await loadAssignees(ME, FARM);
        setOnline(false);
        expect((await loadAssignees(OTHER_USER, FARM)).assignees).toEqual([]);
    });
});
