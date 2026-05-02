// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE — DoD §5 integration coverage.
 *
 * Proves the sync-pull-updates-UI-store invariant: data written by
 * `reconcileSyncPull` is immediately visible to the application via
 * `DexieDataSource.crops` and `DexieDataSource.profile` — the same ports
 * ProfilePage and other UI consumers read from. This is the regression
 * the bridge was designed to prevent: if a future refactor accidentally
 * routed sync writes back to localStorage (or a different Dexie store),
 * this test fails.
 *
 * Distinct from `SyncPullReconciler.behavior.test.ts`: that test snapshots
 * the raw Dexie row shape; THIS test asserts on the
 * application/ports/AppDataSource port surface, which is the correct
 * boundary for "the substrate the UI reads from."
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../reference/TemplateCatalog', () => ({
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));

vi.mock('../../../core/domain/services/Clock', () => ({
    systemClock: {
        now: () => new Date('2026-05-01T12:00:00.000Z'),
        nowISO: () => '2026-05-01T12:00:00.000Z',
        nowEpoch: () => Date.parse('2026-05-01T12:00:00.000Z'),
    },
}));

vi.mock('../../../core/domain/services/IdGenerator', () => {
    let counter = 0;
    return {
        idGenerator: {
            generate: () => `test-id-${++counter}`,
        },
    };
});

// Sub-plan 04 Task 7 — reconciler relocated to features/sync/pull/.
import { reconcileSyncPull } from '../../../features/sync/pull/SyncPullReconciler';
import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { DexieDataSource } from '../../storage/DexieDataSource';
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
        { userId: 'user-1', displayName: 'Ramu Patil', role: 'PRIMARY_OWNER' },
    ],
    scheduleTemplates: [],
    cropTypes: [],
    activityCategories: [],
    costCategories: [],
    referenceDataVersionHash: 'test-ref-hash-v1',
};

describe('Sync → UI bridge (T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE)', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.delete();
        await resetDatabase();
        localStorage.clear();
    });

    it('DexieDataSource.crops.getAll() reflects what reconcileSyncPull just wrote', async () => {
        const dataSource = DexieDataSource.getInstance();

        // Pre-condition: UI port sees no crops on a fresh device.
        expect(await dataSource.crops.getAll()).toEqual([]);

        await reconcileSyncPull(fixture);

        // Post-condition: UI port sees the synced crop.
        const crops = await dataSource.crops.getAll();
        expect(crops).toHaveLength(1);
        expect(crops[0].id).toBe('crop_grapes');
        expect(crops[0].name).toBe('Grapes');
        expect(crops[0].plots[0]?.id).toBe('plot-1');
    });

    it('DexieDataSource.profile.get() reflects what reconcileSyncPull just wrote', async () => {
        const dataSource = DexieDataSource.getInstance();

        // Pre-condition: UI port sees an empty profile shape on a fresh device.
        const before = await dataSource.profile.get();
        expect(Object.keys(before)).toEqual([]);

        await reconcileSyncPull(fixture);

        // Post-condition: UI port sees the synced profile (operator-derived).
        const profile = await dataSource.profile.get();
        expect(profile.name).toBe('Ramu Patil');
        expect(profile.operators).toHaveLength(1);
        expect(profile.operators[0].role).toBe('PRIMARY_OWNER');
        expect(profile.activeOperatorId).toBe('user-1');
    });

    it('a second sync pull updates the same UI port (no divergence over time)', async () => {
        const dataSource = DexieDataSource.getInstance();

        await reconcileSyncPull(fixture);
        const firstCrops = await dataSource.crops.getAll();
        expect(firstCrops.map(c => c.id)).toEqual(['crop_grapes']);

        // Second pull adds another crop cycle.
        const secondPull: SyncPullResponse = {
            ...fixture,
            cropCycles: [
                ...fixture.cropCycles,
                {
                    id: 'cycle-2',
                    farmId: 'farm-1',
                    plotId: 'plot-2',
                    cropName: 'Onion',
                    stage: 'planted',
                    startDate: '2026-04-15',
                    createdAtUtc: '2026-04-15T00:00:00.000Z',
                    modifiedAtUtc: '2026-05-01T00:00:00.000Z',
                },
            ],
            plots: [
                ...fixture.plots,
                {
                    id: 'plot-2',
                    farmId: 'farm-1',
                    name: 'South Field',
                    areaInAcres: 1.0,
                    createdAtUtc: '2026-04-15T00:00:00.000Z',
                    modifiedAtUtc: '2026-05-01T00:00:00.000Z',
                },
            ],
        };

        await reconcileSyncPull(secondPull);
        const secondCrops = await dataSource.crops.getAll();
        expect(new Set(secondCrops.map(c => c.id))).toEqual(
            new Set(['crop_grapes', 'crop_onion'])
        );
    });
});
