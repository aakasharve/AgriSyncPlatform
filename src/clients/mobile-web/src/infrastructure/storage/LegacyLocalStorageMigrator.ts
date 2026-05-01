/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 2 — one-time legacy localStorage → Dexie import.
 *
 * Reads the existing `crops` and `farmer_profile` localStorage entries (in
 * the active `storageNamespace`) and writes them into the v14 Dexie stores
 * `crops` + `farmerProfile`. The migrator is gated by a single localStorage
 * flag so it runs at most once per device/namespace.
 *
 * Important: This is a Path-1-narrow implementation per the Sub-plan 04
 * Task 2 amendment dated 2026-05-01. The migrator IS NOT yet wired into
 * `DataSourceProvider` startup, and `DexieDataSource` STILL uses the
 * localStorage-backed `LocalCropRepository` / `LocalProfileRepository`. The
 * actual cutover lives in the deferred task
 * `T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE`, which must also migrate
 * `SyncPullReconciler` away from localStorage to avoid silent divergence
 * between the substrate sync writes to and the substrate the UI reads
 * from.
 *
 * Until that cutover lands, this module exists as a tested, dormant
 * import path — landing the schema + repos + migrator additively without
 * forcing a correctness-sensitive cutover in the same release.
 */

import { getDatabase } from './DexieDatabase';
import { storageNamespace } from './StorageNamespace';

/**
 * Per-device once-only marker. Intentionally NOT namespaced via
 * `storageNamespace.getKey()`: a bulk import is a device-level event, and
 * demo-mode toggling should not re-trigger the import.
 */
const MIGRATED_FLAG = 'agrisync_legacy_storage_migrated_v1';

/**
 * Result of `runLegacyLocalStorageMigration`. Useful for tests and for
 * any future startup wiring that wants to log/telemetry the import outcome.
 */
export interface LegacyMigrationResult {
    skipped: boolean;
    cropsImported: number;
    profileImported: boolean;
    cropsParseFailed: boolean;
    profileParseFailed: boolean;
}

const NOOP_RESULT: LegacyMigrationResult = {
    skipped: true,
    cropsImported: 0,
    profileImported: false,
    cropsParseFailed: false,
    profileParseFailed: false,
};

export async function runLegacyLocalStorageMigration(): Promise<LegacyMigrationResult> {
    if (localStorage.getItem(MIGRATED_FLAG) === '1') {
        return { ...NOOP_RESULT };
    }

    const db = getDatabase();
    const result: LegacyMigrationResult = {
        skipped: false,
        cropsImported: 0,
        profileImported: false,
        cropsParseFailed: false,
        profileParseFailed: false,
    };

    // Crops migration.
    const cropsRaw = localStorage.getItem(storageNamespace.getKey('crops'));
    if (cropsRaw) {
        try {
            const parsed = JSON.parse(cropsRaw) as Array<{ id: string }>;
            if (Array.isArray(parsed)) {
                const now = Date.now();
                await db.transaction('rw', db.crops, async () => {
                    await db.crops.clear();
                    await db.crops.bulkAdd(
                        parsed.map(c => ({ id: c.id, data: c, updatedAtMs: now }))
                    );
                });
                result.cropsImported = parsed.length;
            }
        } catch (err) {
            console.warn('[LegacyMigration] crops parse failed', err);
            result.cropsParseFailed = true;
        }
    }

    // Profile migration.
    const profileRaw = localStorage.getItem(storageNamespace.getKey('farmer_profile'));
    if (profileRaw) {
        try {
            const parsed = JSON.parse(profileRaw);
            await db.farmerProfile.put({
                id: 'self',
                data: parsed,
                updatedAtMs: Date.now(),
            });
            result.profileImported = true;
        } catch (err) {
            console.warn('[LegacyMigration] profile parse failed', err);
            result.profileParseFailed = true;
        }
    }

    // localStorage entries are intentionally left in place as a safety net.
    // The deferred T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE task is responsible for
    // either retiring them entirely or formalizing the dual-write contract.
    localStorage.setItem(MIGRATED_FLAG, '1');

    return result;
}

/**
 * Test/diagnostic helper: clears the migration flag so a subsequent call
 * to `runLegacyLocalStorageMigration` runs the import again. Production
 * code should not call this — the flag is the migration's idempotency
 * guarantee.
 */
export function __resetLegacyMigrationFlagForTesting(): void {
    localStorage.removeItem(MIGRATED_FLAG);
}
