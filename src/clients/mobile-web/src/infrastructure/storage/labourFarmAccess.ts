/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ACCESS TO A FARM ENDED (founder 2026-10-12, access-revocation handling).
 *
 * When the server says a user is no longer a member of a farm (the farm is
 * missing from a successful /me, or a farm-scoped Labour call answers 403), the
 * Labour read-out and the roster cached for that farm are no longer theirs to
 * keep or show. Unknown is NOT revoked: a network failure / 5xx never purges.
 *
 * This erases cached copies only. The user's unsent queue is untouched.
 */
import { clearLabourReadoutsForFarm, LABOUR_READOUT_MAX_AGE_MS } from './LabourReadoutCache';
import { clearCachedRosterForFarm } from './LabourLocalStore';

export function purgeLabourCachesForFarm(userId: string | null, farmId: string): void {
    if (userId) clearLabourReadoutsForFarm(userId, farmId);
    clearCachedRosterForFarm(farmId);
}

/** True only when the server READ the request and refused it as 403 (not a member). */
export function isFarmAccessRefused(error: unknown): boolean {
    return (error as { response?: { status?: unknown } } | null)?.response?.status === 403;
}

const READOUT_PREFIX = 'agrisync_labour_readout_v1:';
const ROSTER_FRAGMENT = 'shramsafal_field_operator_roster_';

/**
 * Boot sweep for the 7-day cap (founder 2026-10-12). The caches delete an expired
 * entry when READ, but an entry for a farm nobody opens again would otherwise sit
 * on the handset past 7 days. Removes every read-out and roster whose stamp is
 * too old, missing (unknown age) or unparseable. Fresh entries are untouched.
 */
export function purgeExpiredLabourCaches(): void {
    try {
        if (typeof window === 'undefined') return;
        const s = window.localStorage;
        const now = Date.now();
        const doomed: string[] = [];
        for (let i = 0; i < s.length; i++) {
            const k = s.key(i);
            if (k === null || !(k.startsWith(READOUT_PREFIX) || k.includes(ROSTER_FRAGMENT))) continue;
            let stale = true;
            try {
                const at = Date.parse((JSON.parse(s.getItem(k) ?? 'null') as { savedAtUtc?: string } | null)?.savedAtUtc ?? '');
                stale = Number.isNaN(at) || now - at > LABOUR_READOUT_MAX_AGE_MS || at - now > 24 * 60 * 60 * 1000;
            } catch { /* unparseable: stale */ }
            if (stale) doomed.push(k);
        }
        doomed.forEach((k) => s.removeItem(k));
    } catch {
        /* storage unavailable */
    }
}
