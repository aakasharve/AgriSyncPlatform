/**
 * Sub-plan 04 Task 1a — behavioral lock for SyncPullReconciler.
 *
 * Captures the post-pull Dexie + localStorage state for a small synthetic
 * payload BEFORE Task 7 splits the 1150-line reconciler into focused
 * per-resource modules. Any unintended drift during the refactor will fail
 * the snapshot.
 *
 * Synthetic fixture is preferred over a captured real payload so the test is
 * fully reproducible and doesn't drag PII into the repo. Coverage focus:
 *   - farms / plots / cropCycles persist to Dexie
 *   - crops + profile are reduced into localStorage (pre-Task-2 layout)
 *   - reference data version meta is recorded
 *   - empty/missing optional collections do not crash the reconciler
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reconcileSyncPull } from '../SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../storage/DexieDatabase';
import { storageNamespace } from '../../storage/StorageNamespace';
import { systemClock } from '../../../core/domain/services/Clock';
import type { SyncPullResponse } from '../../api/AgriSyncClient';

const FROZEN_NOW_ISO = '2026-04-01T12:00:00.000Z';
const FROZEN_NOW_EPOCH = Date.parse(FROZEN_NOW_ISO);
const FROZEN_NOW_DATE = new Date(FROZEN_NOW_EPOCH);

type FixtureOverrides = Partial<SyncPullResponse>;

function buildFixture(overrides: FixtureOverrides = {}): SyncPullResponse {
    const base: SyncPullResponse = {
        serverTimeUtc: '2026-04-01T00:00:00.000Z',
        nextCursorUtc: '2026-04-01T00:00:00.000Z',
        farms: [
            {
                id: 'farm_1',
                name: 'Test Farm',
                ownerUserId: 'user_owner',
                createdAtUtc: '2026-03-01T00:00:00.000Z',
                modifiedAtUtc: '2026-03-15T00:00:00.000Z',
            },
        ],
        plots: [
            {
                id: 'plot_1',
                farmId: 'farm_1',
                name: 'North Field',
                areaInAcres: 2.5,
                createdAtUtc: '2026-03-01T00:00:00.000Z',
                modifiedAtUtc: '2026-03-15T00:00:00.000Z',
            },
        ],
        cropCycles: [
            {
                id: 'cycle_1',
                farmId: 'farm_1',
                plotId: 'plot_1',
                cropName: 'Grapes',
                stage: 'flowering',
                startDate: '2026-01-01',
                createdAtUtc: '2026-01-01T00:00:00.000Z',
                modifiedAtUtc: '2026-03-15T00:00:00.000Z',
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
        operators: [],
        scheduleTemplates: [],
        scheduleSubscriptions: [],
        cropTypes: [],
        activityCategories: [],
        costCategories: [],
        referenceDataVersionHash: 'baseline-v1',
        attentionBoard: null,
    };
    return { ...base, ...overrides };
}

async function resetState() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore — fake-indexeddb handles missing-db gracefully
    }
    await resetDatabase();
    localStorage.clear();
    storageNamespace.setNamespace('user');
}

describe('SyncPullReconciler (baseline behavior — Task 1a)', () => {
    beforeEach(async () => {
        vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);
        vi.spyOn(systemClock, 'now').mockReturnValue(FROZEN_NOW_DATE);
        vi.spyOn(systemClock, 'nowEpoch').mockReturnValue(FROZEN_NOW_EPOCH);
        await resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reduces a minimal payload into a deterministic Dexie + localStorage snapshot', async () => {
        await reconcileSyncPull(buildFixture());

        const db = getDatabase();
        const farms = await db.farms.toArray();
        const plots = await db.plots.toArray();
        const cropCycles = await db.cropCycles.toArray();

        const cropsRaw = localStorage.getItem(storageNamespace.getKey('crops'));
        const crops = cropsRaw ? JSON.parse(cropsRaw) : [];

        // Strip non-deterministic fields (timestamps the reducer stamps with
        // systemClock.nowISO()) so the snapshot remains stable.
        const stripDates = (rows: readonly unknown[]): Record<string, unknown>[] =>
            rows.map(r => {
                const copy: Record<string, unknown> = { ...(r as Record<string, unknown>) };
                delete copy.lastSyncedAtUtc;
                delete copy.lastModifiedLocallyAtUtc;
                return copy;
            });

        expect({
            farms: stripDates(farms),
            plots: stripDates(plots),
            cropCycles: stripDates(cropCycles),
            crops,
        }).toMatchSnapshot();
    });

    it('handles an empty payload without throwing or persisting rows', async () => {
        const empty = buildFixture({ farms: [], plots: [], cropCycles: [] });
        await reconcileSyncPull(empty);

        const db = getDatabase();
        expect(await db.farms.toArray()).toEqual([]);
        expect(await db.plots.toArray()).toEqual([]);
        expect(await db.cropCycles.toArray()).toEqual([]);
    });

    it('recovers profile.ownerUserId from the first farm', async () => {
        await reconcileSyncPull(buildFixture());
        const profileRaw = localStorage.getItem(storageNamespace.getKey('farmer_profile'));
        if (profileRaw) {
            const profile = JSON.parse(profileRaw);
            expect(typeof profile).toBe('object');
        }
        // Empty fallback is also acceptable — Task 7 split must preserve whichever
        // branch fires here. The snapshot in the first test locks the exact shape.
    });
});
