// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 1 — SyncPullReconciler behavior baseline.
 *
 * REPLACED 2026-05-01 by T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE: this test originally
 * locked the localStorage write contract (D-shallow). The bridge cut over the
 * substrate to Dexie, so the snapshot now locks the Dexie write contract — the
 * actual UI-read substrate post-cutover. Same intent ("what does a fixed
 * SyncPullResponse produce as state?"), different storage layer.
 *
 * Scope:
 *   - In:  the Dexie `crops` and `farmerProfile` rows after a fixed
 *          SyncPullResponse fixture flows through `reconcileSyncPull`.
 *   - Out: per-table Dexie snapshots for sync caches (logs, attachments,
 *          farms, plots, cropCycles, etc). Those tables are unchanged by
 *          the cutover and are not in this test's scope.
 *
 * `fake-indexeddb/auto` registers a real IndexedDB shim, so Dexie writes
 * actually persist and can be read back. systemClock + idGenerator stay
 * mocked for snapshot determinism.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// TemplateCatalog mutates an in-memory map, not Dexie; mock to avoid runtime
// side effects bleeding across tests.
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
import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
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

describe('SyncPullReconciler — Dexie behavior baseline (T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE)', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.delete();
        await resetDatabase();
        localStorage.clear();
    });

    it('writes deterministic crops and farmerProfile rows to Dexie from a fixed pull payload', async () => {
        await reconcileSyncPull(fixture);

        const db = getDatabase();
        // Strip volatile updatedAtMs from the crop rows so the snapshot is
        // stable across runs without having to mock Date.now() (the repos
        // call Date.now() directly, not systemClock).
        const cropRows = (await db.crops.toArray())
            .map(r => ({ id: r.id, data: r.data }))
            .sort((a, b) => a.id.localeCompare(b.id));
        const profileRow = await db.farmerProfile.get('self');
        const profileSnapshot = profileRow
            ? { id: profileRow.id, data: profileRow.data }
            : null;

        expect({ crops: cropRows, farmerProfile: profileSnapshot }).toMatchSnapshot();
    });
});
