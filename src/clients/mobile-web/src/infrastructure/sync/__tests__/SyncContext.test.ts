/**
 * spec: pre-launch-repair L2a (R-3, D-19; review M2 / m8) — the REAL `resolveFarmIdFromSyncState` and
 * `resolveKnownFarmId` against real Dexie (fake-indexeddb). The farm comes from the bill's PLOT only — the
 * last download's own plot list, else the plots Dexie keeps — and never "the first farm" of a farmer with two.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '../../storage/DexieDatabase';
import { resolveFarmIdFromSyncState, resolveKnownFarmId } from '../SyncContext';

const FARM_1 = '11111111-1111-1111-1111-111111111111';
const FARM_2 = '22222222-2222-2222-2222-222222222222';
const PLOT_ON_2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const NOW = '2026-10-29T00:00:00.000Z';

async function lastPull(value: unknown): Promise<void> {
    await getDatabase().appMeta.put({ key: 'shramsafal_last_pull_payload', value, updatedAt: NOW });
}

beforeEach(async () => {
    const db = getDatabase();
    await Promise.all([db.appMeta.clear(), db.plots.clear(), db.farms.clear()]);
    // A farmer with TWO farms, FARM_1 listed first — the farm the old code fell back to.
    await db.farms.bulkPut([
        { id: FARM_1, payload: { id: FARM_1 }, updatedAt: NOW },
        { id: FARM_2, payload: { id: FARM_2 }, updatedAt: NOW },
    ]);
});

describe('resolveFarmIdFromSyncState — the farm of the bill\'s plot, or null', () => {
    it('two farms and no plot named → null, never the first farm', async () => {
        await lastPull({ farms: [{ id: FARM_1 }, { id: FARM_2 }], plots: [{ id: PLOT_ON_2, farmId: FARM_2 }] });
        expect(await resolveFarmIdFromSyncState()).toBeNull();
        expect(await resolveFarmIdFromSyncState('')).toBeNull();
        expect(await resolveFarmIdFromSyncState('   ')).toBeNull();
    });

    it('a plot resolves to its OWN farm (the second farm), not the first', async () => {
        await lastPull({ farms: [{ id: FARM_1 }, { id: FARM_2 }], plots: [{ id: PLOT_ON_2, farmId: FARM_2 }] });
        expect(await resolveFarmIdFromSyncState(PLOT_ON_2)).toBe(FARM_2);
    });

    it('a plot this phone does not know → null', async () => {
        await lastPull({ farms: [{ id: FARM_1 }, { id: FARM_2 }], plots: [{ id: PLOT_ON_2, farmId: FARM_2 }] });
        expect(await resolveFarmIdFromSyncState('bbbbbbbb-0000-0000-0000-00000000000b')).toBeNull();
    });

    it('no download snapshot yet → the plots Dexie keeps answer (the reconciler\'s copy)', async () => {
        await getDatabase().plots.put({ id: PLOT_ON_2, farmId: FARM_2, payload: { id: PLOT_ON_2, farmId: FARM_2 }, updatedAt: NOW });
        expect(await resolveFarmIdFromSyncState(PLOT_ON_2)).toBe(FARM_2);
    });

    it('a snapshot that does not list the plot also falls back to Dexie\'s plots', async () => {
        await lastPull({ farms: [{ id: FARM_1 }], plots: [] });
        await getDatabase().plots.put({ id: PLOT_ON_2, farmId: FARM_2, payload: { id: PLOT_ON_2, farmId: FARM_2 }, updatedAt: NOW });
        expect(await resolveFarmIdFromSyncState(PLOT_ON_2)).toBe(FARM_2);
    });
});

describe('resolveKnownFarmId — a farm counts only if this phone holds it (review m8)', () => {
    it('a farm this phone holds → that farm; one it does not → null; nothing → null', async () => {
        expect(await resolveKnownFarmId(FARM_2)).toBe(FARM_2);
        expect(await resolveKnownFarmId('33333333-3333-3333-3333-333333333333')).toBeNull();
        expect(await resolveKnownFarmId(null)).toBeNull();
        expect(await resolveKnownFarmId(undefined)).toBeNull();
    });
});
