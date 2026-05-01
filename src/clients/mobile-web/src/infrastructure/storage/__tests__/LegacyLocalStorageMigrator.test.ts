// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 2 (T2-5) — LegacyLocalStorageMigrator coverage.
 *
 * Locks the one-time-import contract: localStorage 'crops' and
 * 'farmer_profile' move into the Dexie v14 stores exactly once per
 * device, and the migrator is a no-op on subsequent runs. localStorage
 * entries are intentionally NOT cleared by this migrator — that
 * decision lives in the deferred task T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { resetDatabase, getDatabase } from '../DexieDatabase';
import {
    runLegacyLocalStorageMigration,
    __resetLegacyMigrationFlagForTesting,
} from '../LegacyLocalStorageMigrator';
import { storageNamespace } from '../StorageNamespace';

const sampleCrops = [
    { id: 'crop_grapes', name: 'Grapes' },
    { id: 'crop_onion', name: 'Onion' },
];

const sampleProfile = {
    name: 'Ramu Patil',
    village: 'Test Village',
    phone: '9999999999',
    language: 'mr',
};

describe('LegacyLocalStorageMigrator (Sub-plan 04 Task 2)', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.delete();
        await resetDatabase();
        localStorage.clear();
        // Belt-and-suspenders: if a previous test set the flag, clear it.
        __resetLegacyMigrationFlagForTesting();
        // Default to user namespace (matches DataSourceProvider boot path).
        storageNamespace.setNamespace('user');
    });

    it('is a no-op when no legacy localStorage data exists', async () => {
        const result = await runLegacyLocalStorageMigration();
        expect(result.skipped).toBe(false);
        expect(result.cropsImported).toBe(0);
        expect(result.profileImported).toBe(false);

        const cropsRows = await getDatabase().crops.toArray();
        const profileRow = await getDatabase().farmerProfile.get('self');
        expect(cropsRows).toEqual([]);
        expect(profileRow).toBeUndefined();
    });

    it('migrates crops from localStorage to Dexie', async () => {
        localStorage.setItem(
            storageNamespace.getKey('crops'),
            JSON.stringify(sampleCrops)
        );

        const result = await runLegacyLocalStorageMigration();
        expect(result.cropsImported).toBe(2);

        const rows = await getDatabase().crops.toArray();
        expect(new Set(rows.map(r => r.id))).toEqual(
            new Set(['crop_grapes', 'crop_onion'])
        );
    });

    it('migrates farmer_profile from localStorage to Dexie singleton', async () => {
        localStorage.setItem(
            storageNamespace.getKey('farmer_profile'),
            JSON.stringify(sampleProfile)
        );

        const result = await runLegacyLocalStorageMigration();
        expect(result.profileImported).toBe(true);

        const profileRow = await getDatabase().farmerProfile.get('self');
        expect(profileRow?.id).toBe('self');
        expect((profileRow?.data as { name?: string })?.name).toBe('Ramu Patil');
    });

    it('runs at most once: second invocation is a no-op even if localStorage changes', async () => {
        localStorage.setItem(
            storageNamespace.getKey('crops'),
            JSON.stringify(sampleCrops)
        );
        await runLegacyLocalStorageMigration();

        // Mutate localStorage between calls.
        localStorage.setItem(
            storageNamespace.getKey('crops'),
            JSON.stringify([{ id: 'crop_wheat', name: 'Wheat' }])
        );

        const result = await runLegacyLocalStorageMigration();
        expect(result.skipped).toBe(true);
        expect(result.cropsImported).toBe(0);

        // Dexie still has the original imported rows; second run did not touch them.
        const rows = await getDatabase().crops.toArray();
        expect(new Set(rows.map(r => r.id))).toEqual(
            new Set(['crop_grapes', 'crop_onion'])
        );
    });

    it('intentionally does NOT clear legacy localStorage entries', async () => {
        const cropsKey = storageNamespace.getKey('crops');
        const profileKey = storageNamespace.getKey('farmer_profile');
        localStorage.setItem(cropsKey, JSON.stringify(sampleCrops));
        localStorage.setItem(profileKey, JSON.stringify(sampleProfile));

        await runLegacyLocalStorageMigration();

        // Per Path-1-narrow scope: localStorage must remain intact as a
        // safety net + because SyncPullReconciler still writes there.
        // Retiring localStorage entries is the deferred task
        // T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE's responsibility.
        expect(localStorage.getItem(cropsKey)).not.toBeNull();
        expect(localStorage.getItem(profileKey)).not.toBeNull();
    });

    it('records cropsParseFailed when localStorage holds invalid JSON', async () => {
        localStorage.setItem(storageNamespace.getKey('crops'), 'not json {');

        const result = await runLegacyLocalStorageMigration();
        expect(result.cropsParseFailed).toBe(true);
        expect(result.cropsImported).toBe(0);
        expect(await getDatabase().crops.toArray()).toEqual([]);
    });
});
