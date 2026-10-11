/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourLocalStore - purpose-named storage adapter for two small, device-local Labour values.
 * It is the ONLY place the Labour feature touches localStorage (storage-discipline rule:
 * localStorage is permitted only under infrastructure/storage/).
 *
 *   1. the per-device early-access switch for the manual attendance door
 *      (key supplied by features/labour/attendanceDoor.ts);
 *   2. the last field-operator roster read for a farm, kept so the manual
 *      attendance screen can still list names offline.
 *
 * Why localStorage and not Dexie: a Dexie schema version bump is one-way on installed
 * devices, and these are a device preference and a convenience copy, not records.
 *
 * Every call is try/catch'd. A blocked or failing store means "OFF" / "no cache" and is
 * never surfaced as an error: callers must treat the absence of a value as the safe default.
 */

/** Returns true only if the flag is stored as exactly '1'. Storage failure => false. */
export function readDeviceFlag(key: string): boolean {
    try {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
}

/** Persists (on) or removes (off) the flag. Returns whether the change was persisted. */
export function writeDeviceFlag(key: string, on: boolean): boolean {
    try {
        if (typeof window === 'undefined') return false;
        if (on) window.localStorage.setItem(key, '1');
        else window.localStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}

/** Raw cached string for a key, or null (missing / storage failure). */
export function readCachedJson(key: string): string | null {
    try {
        if (typeof window === 'undefined') return null;
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

/** Best-effort write; a failing store simply means there is no offline copy. */
export function writeCachedJson(key: string, value: string): void {
    try {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(key, value);
    } catch {
        /* storage unavailable */
    }
}
