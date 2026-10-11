/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourReadoutCache - purpose-named adapter for the LAST SUCCESSFUL Labour
 * read-out, kept so a farmer who relaunches the app with no signal still sees
 * his own register and people (clearly marked as possibly out of date).
 *
 * Privacy rules enforced HERE (the caller sanitises, this layer bounds):
 *   - keyed by userId + farmId + window; a different user can never read it;
 *   - maximum age 7 days (LABOUR_READOUT_MAX_AGE_MS), then it is deleted on read;
 *   - erased on every session end (clearAuthSession: logout, rejected refresh,
 *     401) via clearAllLabourReadouts, and for every other user on a user switch;
 *   - the payload is opaque here; features/labour/data/labourReadout.ts strips
 *     all money before anything reaches this module.
 *
 * Every call is try/catch'd: a blocked store simply means "no offline copy".
 */

const PREFIX = 'agrisync_labour_readout_v1:';

/** Conservative cap: a read-out older than this is not shown (queued-only view instead). */
export const LABOUR_READOUT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function ls(): Storage | null {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
        return null;
    }
}

const keyFor = (userId: string, farmId: string, windowKey: string) =>
    `${PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(farmId)}:${encodeURIComponent(windowKey)}`;

export interface StoredLabourReadout {
    savedAtUtc: string;
    payload: unknown;
}

export function writeLabourReadout(userId: string, farmId: string, windowKey: string, payload: unknown): void {
    try {
        ls()?.setItem(
            keyFor(userId, farmId, windowKey),
            JSON.stringify({ savedAtUtc: new Date().toISOString(), payload }),
        );
    } catch {
        /* storage unavailable or full: no offline copy */
    }
}

export function readLabourReadout(userId: string, farmId: string, windowKey: string): StoredLabourReadout | null {
    const s = ls();
    if (!s) return null;
    const key = keyFor(userId, farmId, windowKey);
    try {
        const raw = s.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredLabourReadout;
        const at = Date.parse(parsed.savedAtUtc);
        if (Number.isNaN(at) || Date.now() - at > LABOUR_READOUT_MAX_AGE_MS || at - Date.now() > 24 * 60 * 60 * 1000) {
            s.removeItem(key);
            return null;
        }
        return parsed;
    } catch {
        try { s.removeItem(key); } catch { /* ignore */ }
        return null;
    }
}

function removeWhere(keep: (key: string) => boolean): void {
    const s = ls();
    if (!s) return;
    try {
        const doomed: string[] = [];
        for (let i = 0; i < s.length; i++) {
            const k = s.key(i);
            if (k !== null && k.startsWith(PREFIX) && !keep(k)) doomed.push(k);
        }
        doomed.forEach((k) => s.removeItem(k));
    } catch {
        /* ignore */
    }
}

/** Session ended (logout / rejected refresh / 401): erase every user's read-out. */
export function clearAllLabourReadouts(): void {
    removeWhere(() => false);
}

/** A different user is now active: erase everyone else's read-out. */
export function clearLabourReadoutsExcept(userId: string): void {
    const mine = `${PREFIX}${encodeURIComponent(userId)}:`;
    removeWhere((k) => k.startsWith(mine));
}
