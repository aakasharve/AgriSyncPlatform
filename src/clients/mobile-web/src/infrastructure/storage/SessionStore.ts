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
 *
 * TASK 17 (spec: 2026-08-28-labour-v2-release-1) — LABOUR WINDOW, SAME
 * SHAPE. `getLabourWindow`/`setLabourWindow` follow the exact pattern above
 * (try/catch over `localStorage`, namespaced per farmer via
 * `storageNamespace.getKey`) for the same reason: a farmer's आढावा window
 * choice is UI preference, not business data, but it still must not survive
 * onto the next farmer sharing a handset, and a storage failure on a cheap
 * device must degrade quietly rather than break the screen. This store
 * deliberately stays a raw `string` in and out — it has no opinion on which
 * strings are valid windows. Validating a stored value against the four
 * known windows (and falling back to the founder-chosen default when it
 * doesn't match) is `useLabourState.ts`'s job, via `isLabourWindow`
 * (`labourWindow.ts`) — keeping that check there, not here, is what stops
 * this generic infrastructure module from depending on a feature's types.
 */

import { storageNamespace } from './StorageNamespace';
import { scopedKeyFor } from './businessKeyScope';

const KEY_CURRENT_FARM_ID = 'shramsafal_current_farm_id';
const KEY_LABOUR_WINDOW = 'shramsafal_labour_window';

export const SessionStore = {
    getCurrentFarmId(): string | null {
        try { return window.localStorage.getItem(storageNamespace.getKey(KEY_CURRENT_FARM_ID)); }
        catch { return null; }
    },
    setCurrentFarmId(farmId: string): void {
        try { window.localStorage.setItem(storageNamespace.getKey(KEY_CURRENT_FARM_ID), farmId); }
        catch { /* ignore */ }
    },
    /**
     * The pointer for an EXPLICIT farmer, not "whoever the handset is serving".
     * The ambient farmer (`activeUserId`) is switched by DataSourceProvider a
     * tick AFTER the session changes, so a reader keyed to the session must not
     * go through the ambient namespace or it can read/write the PREVIOUS
     * farmer's pointer. Demo mode keeps its single sandbox key.
     */
    getCurrentFarmIdForUser(userId: string): string | null {
        try {
            return window.localStorage.getItem(this.keyForUser(userId));
        } catch { return null; }
    },
    setCurrentFarmIdForUser(userId: string, farmId: string): void {
        try { window.localStorage.setItem(this.keyForUser(userId), farmId); }
        catch { /* ignore */ }
    },
    keyForUser(userId: string): string {
        return storageNamespace.getNamespace() === 'demo'
            ? storageNamespace.getKey(KEY_CURRENT_FARM_ID)
            : scopedKeyFor(KEY_CURRENT_FARM_ID, userId);
    },
    /** Erase the pointer for an EXPLICIT farmer (logout, whatever the ambient farmer is). */
    clearCurrentFarmIdForUser(userId: string): void {
        try { window.localStorage.removeItem(this.keyForUser(userId)); }
        catch { /* ignore */ }
    },
    clearCurrentFarmId(): void {
        try { window.localStorage.removeItem(storageNamespace.getKey(KEY_CURRENT_FARM_ID)); }
        catch { /* ignore */ }
    },
    getLabourWindow(): string | null {
        try { return window.localStorage.getItem(storageNamespace.getKey(KEY_LABOUR_WINDOW)); }
        catch { return null; }
    },
    setLabourWindow(value: string): void {
        try { window.localStorage.setItem(storageNamespace.getKey(KEY_LABOUR_WINDOW), value); }
        catch { /* ignore */ }
    },
};
