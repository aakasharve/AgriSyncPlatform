// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 1 — SyncPullReconciler localStorage-only behavior baseline (D-shallow).
 *
 * Locks the **localStorage** write contract of `reconcileSyncPull` from a fixed
 * SyncPullResponse. Sub-plan 04 Task 2 migrates these localStorage writes into
 * Dexie; this snapshot is the contract that migration must preserve.
 *
 * Scope:
 *   - In:  `farmer_profile` and `crops` localStorage keys (the two surfaces
 *          reconcileSyncPull writes to localStorage today).
 *   - Out: Dexie tables. Per the Sub-plan 04 plan amendment for Task 1,
 *          per-table Dexie snapshots are deferred until Task 2 lands the
 *          storage-boundary refactor — at which point the schema/write API
 *          stabilizes and snapshotting it is no longer pre-churn.
 *
 * The Dexie module is `vi.mock`ed to a Proxy that no-ops every method on
 * every table, including `transaction(...)` which simply invokes its callback.
 * `systemClock` is mocked to a fixed ISO timestamp so the snapshot is stable
 * across runs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- Dexie no-op fake ----
//
// reconcileSyncPull touches mutationQueue, logs, attachments, uploadQueue,
// appMeta, referenceData, farms, plots, cropCycles, costEntries,
// financeCorrections, dayLedgers, plannedTasks, attentionCards. The Proxy
// below answers any property as a fakeTable, including methods like put,
// get, where, toArray. transaction() runs its callback inline.
const makeFakeQuery = () => {
    const query: Record<string, unknown> = {};
    query.anyOf = () => query;
    query.equals = () => query;
    query.toArray = async () => [];
    query.first = async () => undefined;
    query.update = async () => undefined;
    return query;
};

const makeFakeTable = () => ({
    toArray: async () => [],
    get: async () => undefined,
    put: async () => undefined,
    update: async () => undefined,
    add: async () => undefined,
    delete: async () => undefined,
    where: () => makeFakeQuery(),
    orderBy: () => makeFakeQuery(),
});

const fakeDb = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'transaction') {
            return async (
                _mode: string,
                _tables: unknown[],
                fn: () => Promise<void>,
            ) => fn();
        }
        return makeFakeTable();
    },
});

vi.mock('../../storage/DexieDatabase', () => ({
    getDatabase: () => fakeDb,
}));

// TemplateCatalog mutates an in-memory map, not localStorage; mock to avoid
// runtime side effects bleeding across tests.
vi.mock('../../reference/TemplateCatalog', () => ({
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));

// systemClock.nowISO() is read once inside reconcileSyncPull and threaded
// into the profile + Dexie writes. Pin it for snapshot stability.
vi.mock('../../../core/domain/services/Clock', () => ({
    systemClock: {
        now: () => new Date('2026-05-01T12:00:00.000Z'),
        nowISO: () => '2026-05-01T12:00:00.000Z',
        nowEpoch: () => Date.parse('2026-05-01T12:00:00.000Z'),
    },
}));

// idGenerator is used inside helpers (e.g. when generating crop ids); pin it
// so the crop-id stays deterministic across runs.
vi.mock('../../../core/domain/services/IdGenerator', () => {
    let counter = 0;
    return {
        idGenerator: {
            generate: () => `test-id-${++counter}`,
        },
    };
});

import { reconcileSyncPull } from '../SyncPullReconciler';
import type { SyncPullResponse } from '../../api/AgriSyncClient';

const fixture: SyncPullResponse = {
    serverTimeUtc: '2026-05-01T12:00:00.000Z',
    nextCursorUtc: '2026-05-01T12:00:00.000Z',
    farms: [
        {
            id: 'farm-1',
            name: 'Test Farm',
            ownerUserId: 'user-1',
            createdAtUtc: '2026-04-01T00:00:00.000Z',
            modifiedAtUtc: '2026-05-01T00:00:00.000Z',
        },
    ],
    plots: [
        {
            id: 'plot-1',
            farmId: 'farm-1',
            name: 'North Field',
            areaInAcres: 2.5,
            createdAtUtc: '2026-04-01T00:00:00.000Z',
            modifiedAtUtc: '2026-05-01T00:00:00.000Z',
        },
    ],
    cropCycles: [
        {
            id: 'cycle-1',
            farmId: 'farm-1',
            plotId: 'plot-1',
            cropName: 'Grapes',
            stage: 'fruiting',
            startDate: '2026-03-01',
            createdAtUtc: '2026-03-01T00:00:00.000Z',
            modifiedAtUtc: '2026-05-01T00:00:00.000Z',
        },
    ],
    dailyLogs: [],
    attachments: [],
    costEntries: [],
    financeCorrections: [],
    dayLedgers: [],
    priceConfigs: [],
    plannedActivities: [],
    auditEvents: [],
    operators: [
        {
            userId: 'user-1',
            displayName: 'Ramu Patil',
            role: 'PRIMARY_OWNER',
        },
        {
            userId: 'user-2',
            displayName: 'Helper Mukadam',
            role: 'MUKADAM',
        },
    ],
    scheduleTemplates: [],
    cropTypes: [],
    activityCategories: [],
    costCategories: [],
    referenceDataVersionHash: 'test-ref-hash-v1',
};

describe('SyncPullReconciler — localStorage behavior baseline (Sub-plan 04 Task 1, D-shallow)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('writes deterministic farmer_profile and crops localStorage keys from a fixed pull payload', async () => {
        await reconcileSyncPull(fixture);

        const profileRaw = localStorage.getItem('farmer_profile');
        const cropsRaw = localStorage.getItem('crops');

        expect({
            farmer_profile: profileRaw === null ? null : JSON.parse(profileRaw),
            crops: cropsRaw === null ? [] : JSON.parse(cropsRaw),
        }).toMatchSnapshot();
    });
});
