/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 §DoD — session-scoped state that the active app needs
 * synchronously at boot (before Dexie can open). Backed by localStorage
 * but isolated behind this module so the architecture gate stays clean.
 *
 * P0.1 — WHICH FARM, FOR WHICH FARMER
 * -----------------------------------
 * The current-farm pointer was a single raw key shared by every login on the
 * handset, so the next farmer to sign in started inside the previous farmer's
 * farm — and `LogCommandService` stamps new records with exactly this value.
 * Two changes, together:
 *   1. the key is scoped to the active farmer (`storageNamespace`), and
 *   2. `clearCurrentFarmId()` is called on logout (`AuthProvider`), so the
 *      pointer does not survive the session that set it.
 * Neither alone is enough: (1) without (2) leaves a farmer re-entering their
 * own stale farm after a session ends, and (2) without (1) leaves the pointer
 * shared for as long as one session lasts.
 */

import { storageNamespace } from './StorageNamespace';

const KEY_CURRENT_FARM_ID = 'shramsafal_current_farm_id';

export const SessionStore = {
    getCurrentFarmId(): string | null {
        try { return window.localStorage.getItem(storageNamespace.getKey(KEY_CURRENT_FARM_ID)); }
        catch { return null; }
    },
    setCurrentFarmId(farmId: string): void {
        try { window.localStorage.setItem(storageNamespace.getKey(KEY_CURRENT_FARM_ID), farmId); }
        catch { /* ignore */ }
    },
    clearCurrentFarmId(): void {
        try { window.localStorage.removeItem(storageNamespace.getKey(KEY_CURRENT_FARM_ID)); }
        catch { /* ignore */ }
    },
};
