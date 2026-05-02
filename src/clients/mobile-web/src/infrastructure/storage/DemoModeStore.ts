/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task — T-IGH-04-LOCALSTORAGE-MIGRATION (wave 4-D).
 *
 * Purpose-named storage adapter for the demo-mode seeding lifecycle owned by
 * `DataSourceProvider`. This module is the only place outside
 * `infrastructure/storage/` where the demo-seeding localStorage keys may be
 * read or written — every other call site is required to route through the
 * named getter/setter/clearer methods below.
 *
 * Key contract (BYTE-FOR-BYTE equivalent to the previous inline calls):
 *
 *   - `agrisync_active_user_id_v1`        — literal (NOT namespaced); tracks
 *                                            which authenticated user the
 *                                            cached Dexie state belongs to.
 *   - `demo_data_version`                  — namespaced via `storageNamespace`;
 *                                            schema/seed version of the demo
 *                                            corpus currently materialised.
 *   - `dfes_procurement_expenses`          — namespaced; legacy demo
 *                                            procurement bucket.
 *   - `harvest_other_income`               — namespaced; legacy demo other-
 *                                            income bucket.
 *   - `money_events`                       — namespaced; legacy demo finance
 *                                            events bucket.
 *   - `harvest_config_<plotId>`            — namespaced; legacy per-plot
 *                                            harvest config bucket.
 *   - `harvest_sessions_<plotId>_<cropId>` — namespaced; legacy per-plot+crop
 *                                            harvest sessions bucket.
 *
 * The legacy `crops` and `farmer_profile` keys are intentionally NOT covered
 * here — `LegacyLocalStorageMigrator` owns those during the Path-1 cutover.
 *
 * Design note: this is a thin wrapper that mirrors the existing inline call
 * sites' style (no try/catch, direct delegation). Adding error handling here
 * would change observable behavior and is out of scope for this migration.
 */
import { storageNamespace } from './StorageNamespace';

const ACTIVE_USER_ID_KEY = 'agrisync_active_user_id_v1';
const DEMO_DATA_VERSION_KEY = 'demo_data_version';
const PROCUREMENT_EXPENSES_KEY = 'dfes_procurement_expenses';
const HARVEST_OTHER_INCOME_KEY = 'harvest_other_income';
const MONEY_EVENTS_KEY = 'money_events';
// Legacy keys ultimately owned by `LegacyLocalStorageMigrator`. The
// demo-mode reset path still needs to clear them on a version change /
// authenticated-user change, so we expose dedicated clearers that route
// through the same namespace plumbing as the rest of this adapter. Once the
// `T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE` cutover lands, these clearers (and
// their callers in `DataSourceProvider`) can be removed entirely.
const LEGACY_CROPS_KEY = 'crops';
const LEGACY_FARMER_PROFILE_KEY = 'farmer_profile';

function harvestConfigKey(plotId: string): string {
    return `harvest_config_${plotId}`;
}

function harvestSessionsKey(plotId: string, cropId: string): string {
    return `harvest_sessions_${plotId}_${cropId}`;
}

export const DemoModeStore = {
    // --- Active user id (literal key — NOT namespaced) ---
    getActiveUserId(): string | null {
        return localStorage.getItem(ACTIVE_USER_ID_KEY);
    },
    setActiveUserId(userId: string): void {
        localStorage.setItem(ACTIVE_USER_ID_KEY, userId);
    },

    // --- Demo data version (namespaced) ---
    getDemoDataVersion(): string | null {
        return localStorage.getItem(storageNamespace.getKey(DEMO_DATA_VERSION_KEY));
    },
    setDemoDataVersion(version: string): void {
        localStorage.setItem(storageNamespace.getKey(DEMO_DATA_VERSION_KEY), version);
    },

    // --- Demo procurement / income / finance buckets (namespaced) ---
    clearProcurementExpenses(): void {
        localStorage.removeItem(storageNamespace.getKey(PROCUREMENT_EXPENSES_KEY));
    },
    clearHarvestOtherIncome(): void {
        localStorage.removeItem(storageNamespace.getKey(HARVEST_OTHER_INCOME_KEY));
    },
    clearMoneyEvents(): void {
        localStorage.removeItem(storageNamespace.getKey(MONEY_EVENTS_KEY));
    },

    // --- Demo per-plot harvest buckets (namespaced) ---
    clearHarvestConfig(plotId: string): void {
        localStorage.removeItem(storageNamespace.getKey(harvestConfigKey(plotId)));
    },
    clearHarvestSessions(plotId: string, cropId: string): void {
        localStorage.removeItem(storageNamespace.getKey(harvestSessionsKey(plotId, cropId)));
    },

    // --- Legacy keys (migrator-owned; cleared during demo / auth resets) ---
    clearLegacyCrops(): void {
        localStorage.removeItem(storageNamespace.getKey(LEGACY_CROPS_KEY));
    },
    clearLegacyFarmerProfile(): void {
        localStorage.removeItem(storageNamespace.getKey(LEGACY_FARMER_PROFILE_KEY));
    },
};
