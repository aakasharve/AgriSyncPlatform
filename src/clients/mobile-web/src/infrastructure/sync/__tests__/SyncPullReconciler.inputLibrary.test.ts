// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 4, fix pass 1) - the product library is asked for AFTER a
 * successful pull and OUTSIDE its Dexie transaction, and a download that fails in any way never fails the pull.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../reference/TemplateCatalog', () => ({
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));

const step = vi.hoisted(() => ({ run: vi.fn(), seenInsideTransaction: [] as boolean[] }));

vi.mock('../../../features/sync/pull/reconcilers/inputLibraryDownload', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../features/sync/pull/reconcilers/inputLibraryDownload')>()),
    runInputLibraryStep: step.run,
}));

import { reconcileSyncPull } from '../../../features/sync/pull/SyncPullReconciler';
import {
    INPUT_LIBRARY_PATH,
    INPUT_LIBRARY_POLL_MS,
    resetInputLibraryThrottle,
} from '../../../features/sync/pull/reconcilers/inputLibraryDownload';
import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import type { SyncPullResponse } from '../../api/AgriSyncClient';

const pull = (): SyncPullResponse => ({
    serverTimeUtc: '2026-05-01T12:00:00.000Z',
    nextCursorUtc: '2026-05-01T12:00:00.000Z',
    farms: [{
        id: 'farm-1', name: 'Test Farm', ownerUserId: 'user-1',
        createdAtUtc: '2026-04-01T00:00:00.000Z', modifiedAtUtc: '2026-05-01T00:00:00.000Z',
    }],
    plots: [],
    cropCycles: [],
    dailyLogs: [],
    attachments: [],
    costEntries: [],
    financeCorrections: [],
    dayLedgers: [],
    priceConfigs: [],
    plannedActivities: [],
    auditEvents: [],
    operators: [{ userId: 'user-1', displayName: 'Ramu Patil', role: 'PRIMARY_OWNER' }],
    scheduleTemplates: [],
    cropTypes: [],
    activityCategories: [],
    costCategories: [],
    referenceDataVersionHash: 'test-ref-hash-v1',
} as unknown as SyncPullResponse);

beforeEach(async () => {
    await resetDatabase();
    step.run.mockReset();
    step.seenInsideTransaction.length = 0;
    resetInputLibraryThrottle();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the library step around a pull (lane IT1c Task 4)', () => {
    it('is asked for once after a successful pull, outside the pull transaction, with the poll interval', async () => {
        step.run.mockImplementation(async () => {
            step.seenInsideTransaction.push(Dexie.currentTransaction !== null && Dexie.currentTransaction !== undefined);
            return 'not-modified';
        });

        await reconcileSyncPull(pull());
        await vi.waitFor(() => expect(step.run).toHaveBeenCalledTimes(1));

        expect(step.seenInsideTransaction).toEqual([false]);
        expect(step.run.mock.calls[0][1]).toEqual({ minIntervalMs: INPUT_LIBRARY_POLL_MS });
        expect(await getDatabase().farms.count()).toBe(1); // the pull itself landed
    });

    it('a download that rejects does not fail the pull', async () => {
        step.run.mockImplementation(() => Promise.reject(new Error('library download blew up')));

        await expect(reconcileSyncPull(pull())).resolves.toBeUndefined();
        await vi.waitFor(() => expect(step.run).toHaveBeenCalledTimes(1));

        expect(await getDatabase().farms.count()).toBe(1);
    });

    it('a download that throws before its first await does not fail the pull', async () => {
        step.run.mockImplementation(() => { throw new Error('thrown at once'); });

        await expect(reconcileSyncPull(pull())).resolves.toBeUndefined();
        await vi.waitFor(() => expect(step.run).toHaveBeenCalledTimes(1));

        expect(await getDatabase().farms.count()).toBe(1);
    });

    it('the real step with no network leaves the pull whole and asks the library route', async () => {
        const net = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        vi.stubGlobal('fetch', net);
        // The REAL step (not the mock the rest of this file installs), so the whole path runs: adopt, ask, fail, keep going.
        const actual = await vi.importActual<typeof import('../../../features/sync/pull/reconcilers/inputLibraryDownload')>(
            '../../../features/sync/pull/reconcilers/inputLibraryDownload');
        actual.resetInputLibraryThrottle();
        step.run.mockImplementation((...args: Parameters<typeof actual.runInputLibraryStep>) => actual.runInputLibraryStep(...args));

        await expect(reconcileSyncPull(pull())).resolves.toBeUndefined();
        await vi.waitFor(() => expect(net).toHaveBeenCalled());

        expect(String(net.mock.calls[0][0])).toContain(INPUT_LIBRARY_PATH);
        expect(await getDatabase().farms.count()).toBe(1);
    });

    it('a pull that fails does not ask for the library', async () => {
        await expect(reconcileSyncPull(undefined as unknown as SyncPullResponse)).rejects.toBeDefined();

        expect(step.run).not.toHaveBeenCalled();
    });
});
