/**
 * Sub-plan 04 Task 2 — LegacyLocalStorageMigrator idempotence + correctness.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runLegacyLocalStorageMigration } from '../LegacyLocalStorageMigrator';
import { getDatabase, resetDatabase } from '../DexieDatabase';
import { storageNamespace } from '../StorageNamespace';

async function freshAll() {
    const db = getDatabase();
    try { await db.delete(); } catch { /* ignore */ }
    await resetDatabase();
    localStorage.clear();
    storageNamespace.setNamespace('user');
}

describe('LegacyLocalStorageMigrator', () => {
    beforeEach(freshAll);

    it('is a no-op when nothing is in legacy localStorage', async () => {
        await runLegacyLocalStorageMigration();
        const db = getDatabase();
        expect(await db.crops.toArray()).toEqual([]);
        expect(await db.farmerProfile.toArray()).toEqual([]);
    });

    it('migrates crops from localStorage to Dexie exactly once', async () => {
        const cropsKey = storageNamespace.getKey('crops');
        localStorage.setItem(cropsKey, JSON.stringify([
            { id: 'c1', name: 'Crop One' },
            { id: 'c2', name: 'Crop Two' },
        ]));

        await runLegacyLocalStorageMigration();

        const rows = await getDatabase().crops.toArray();
        expect(rows.map(r => r.id).sort()).toEqual(['c1', 'c2']);

        // Re-running with the flag set is a no-op even if more rows are added
        // to localStorage (operator should re-clear the flag in that edge case).
        localStorage.setItem(cropsKey, JSON.stringify([{ id: 'c3', name: 'Three' }]));
        await runLegacyLocalStorageMigration();
        const rowsAfter = await getDatabase().crops.toArray();
        expect(rowsAfter.map(r => r.id).sort()).toEqual(['c1', 'c2']);
    });

    it('migrates farmer_profile singleton from localStorage to Dexie', async () => {
        const profileKey = storageNamespace.getKey('farmer_profile');
        localStorage.setItem(profileKey, JSON.stringify({
            ownerUserId: 'user_legacy',
            displayName: 'Migrated User',
        }));

        await runLegacyLocalStorageMigration();

        const row = await getDatabase().farmerProfile.get('self');
        expect(row).toBeDefined();
        const data = row?.data as { ownerUserId?: string; displayName?: string };
        expect(data.ownerUserId).toBe('user_legacy');
        expect(data.displayName).toBe('Migrated User');
    });

    it('skips silently when legacy crops blob is malformed JSON', async () => {
        const cropsKey = storageNamespace.getKey('crops');
        localStorage.setItem(cropsKey, '{not-valid-json');
        await runLegacyLocalStorageMigration();
        expect(await getDatabase().crops.toArray()).toEqual([]);
    });
});
