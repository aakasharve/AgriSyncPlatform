/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 §DoD — session-scoped state that the active app needs
 * synchronously at boot (before Dexie can open). Backed by localStorage
 * but isolated behind this module so the architecture gate stays clean.
 */

const KEY_CURRENT_FARM_ID = 'shramsafal_current_farm_id';

export const SessionStore = {
    getCurrentFarmId(): string | null {
        try { return window.localStorage.getItem(KEY_CURRENT_FARM_ID); }
        catch { return null; }
    },
    setCurrentFarmId(farmId: string): void {
        try { window.localStorage.setItem(KEY_CURRENT_FARM_ID, farmId); }
        catch { /* ignore */ }
    },
    clearCurrentFarmId(): void {
        try { window.localStorage.removeItem(KEY_CURRENT_FARM_ID); }
        catch { /* ignore */ }
    },
};
