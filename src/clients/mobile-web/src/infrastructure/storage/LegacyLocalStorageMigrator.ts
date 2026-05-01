/**
 * Sub-plan 04 Task 2 — one-shot localStorage → Dexie migration.
 *
 * Reads the legacy `crops` and `farmer_profile` localStorage keys (namespaced
 * via storageNamespace) and copies them into the new Dexie tables. Idempotent:
 * sets a flag in localStorage so a re-run is a no-op.
 *
 * Legacy keys are NOT removed in this release — kept for one cycle as a
 * safety net. A follow-up release deletes them once we're confident the
 * Dexie path is healthy in the field.
 */
import { getDatabase } from './DexieDatabase';
import { storageNamespace } from './StorageNamespace';

const MIGRATED_FLAG_KEY = 'agrisync_legacy_storage_migrated_v1';

interface LegacyCrop {
    id: string;
    [key: string]: unknown;
}

export async function runLegacyLocalStorageMigration(): Promise<void> {
    if (localStorage.getItem(MIGRATED_FLAG_KEY) === '1') {
        return;
    }

    const db = getDatabase();
    const cropsKey = storageNamespace.getKey('crops');
    const profileKey = storageNamespace.getKey('farmer_profile');

    const cropsRaw = localStorage.getItem(cropsKey);
    if (cropsRaw) {
        try {
            const parsed = JSON.parse(cropsRaw);
            if (Array.isArray(parsed)) {
                const now = Date.now();
                const rows = (parsed as LegacyCrop[])
                    .filter(c => c && typeof c === 'object' && typeof c.id === 'string')
                    .map(c => ({ id: c.id, data: c, updatedAtMs: now }));
                await db.transaction('rw', db.crops, async () => {
                    await db.crops.clear();
                    if (rows.length > 0) {
                        await db.crops.bulkAdd(rows);
                    }
                });
            }
        } catch (err) {
            console.warn('[LegacyLocalStorageMigrator] crops parse failed', err);
        }
    }

    const profileRaw = localStorage.getItem(profileKey);
    if (profileRaw) {
        try {
            const parsed = JSON.parse(profileRaw);
            if (parsed && typeof parsed === 'object') {
                await db.farmerProfile.put({
                    id: 'self',
                    data: parsed,
                    updatedAtMs: Date.now(),
                });
            }
        } catch (err) {
            console.warn('[LegacyLocalStorageMigrator] profile parse failed', err);
        }
    }

    localStorage.setItem(MIGRATED_FLAG_KEY, '1');
}
