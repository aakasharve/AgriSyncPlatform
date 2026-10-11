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
 */
import { storageNamespace } from '../../../infrastructure/storage/StorageNamespace';
import { readCachedJson, writeCachedJson } from '../../../infrastructure/storage/LabourLocalStore';
import type { FieldOperator } from './fieldOperatorClient';

const keyFor = (farmId: string): string => storageNamespace.getKey(`shramsafal_field_operator_roster_${farmId}`);

const isOperator = (v: unknown): v is FieldOperator => {
    const o = v as Partial<FieldOperator> | null;
    return !!o && typeof o.id === 'string' && typeof o.displayName === 'string' && typeof o.isActive === 'boolean';
};

export function readCachedRoster(farmId: string): FieldOperator[] | null {
    try {
        const raw = readCachedJson(keyFor(farmId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.every(isOperator)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function writeCachedRoster(farmId: string, roster: FieldOperator[]): void {
    try {
        writeCachedJson(keyFor(farmId), JSON.stringify(roster));
    } catch {
        /* stringify failed: the screen just has no offline copy */
    }
}
