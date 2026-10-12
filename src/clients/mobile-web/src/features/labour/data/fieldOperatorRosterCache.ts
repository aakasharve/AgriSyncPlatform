/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * fieldOperatorRosterCache — the last roster this device successfully read for
 * a farm, so the manual हजेरी screen still lists names when the network is
 * down (locked offline ruling).
 *
 * Device-local storage (via infrastructure/storage/LabourLocalStore) on purpose, NOT a Dexie table: a Dexie version bump is one-way
 * on devices, and a roster list is a convenience copy, not a record. Keyed per
 * farmer AND farm via `storageNamespace`, so a shared handset never shows one
 * farm's names on another. Every read/write is try/catch'd; a failing store
 * simply means "no cache" and the screen says so honestly.
 *
 * The cache carries NO claim of freshness: callers must not present cached
 * names as "current".
 *
 * MAX AGE 7 DAYS (founder 2026-10-12, same cap as the Labour read-out): the
 * copy is stamped with `savedAtUtc`; an older one - or a legacy copy with no
 * stamp, whose age is unknown - is deleted on read and by the boot sweep
 * (infrastructure/storage/labourFarmAccess.purgeExpiredLabourCaches). It is also
 * erased on every session end and when access to the farm ends.
 */
import { storageNamespace } from '../../../infrastructure/storage/StorageNamespace';
import { readCachedJson, writeCachedJson, removeCachedJson } from '../../../infrastructure/storage/LabourLocalStore';
import { LABOUR_READOUT_MAX_AGE_MS } from '../../../infrastructure/storage/LabourReadoutCache';
import type { FieldOperator } from './fieldOperatorClient';

const keyFor = (farmId: string): string => storageNamespace.getKey(`shramsafal_field_operator_roster_${farmId}`);

const isOperator = (v: unknown): v is FieldOperator => {
    const o = v as Partial<FieldOperator> | null;
    return !!o && typeof o.id === 'string' && typeof o.displayName === 'string' && typeof o.isActive === 'boolean';
};

export function readCachedRoster(farmId: string): FieldOperator[] | null {
    try {
        const key = keyFor(farmId);
        const raw = readCachedJson(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { savedAtUtc?: unknown; roster?: unknown } | null;
        const at = typeof parsed?.savedAtUtc === 'string' ? Date.parse(parsed.savedAtUtc) : NaN;
        const now = Date.now();
        if (Number.isNaN(at) || now - at > LABOUR_READOUT_MAX_AGE_MS || at - now > 24 * 60 * 60 * 1000) {
            removeCachedJson(key); // too old, future-dated, or legacy/unstamped: age unknown
            return null;
        }
        const roster = parsed?.roster;
        if (!Array.isArray(roster) || !roster.every(isOperator)) return null;
        return roster;
    } catch {
        return null;
    }
}

export function writeCachedRoster(farmId: string, roster: FieldOperator[]): void {
    try {
        writeCachedJson(keyFor(farmId), JSON.stringify({ savedAtUtc: new Date().toISOString(), roster }));
    } catch {
        /* stringify failed: the screen just has no offline copy */
    }
}
