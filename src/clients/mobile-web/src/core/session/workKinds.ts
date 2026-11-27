/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S4.1; founder 27 Nov "kinds of work he may record", CTO ruling Q2) - may
 * this person record this kind of work on this farm? The kinds ARE the record's own bucket names (`sync-contract/schemas/work-kinds.json`, the one
 * file, pinned by `__tests__/workKinds.test.ts`): six can be limited (पीक काम, पाणी, औषध / खत, मजूर, यंत्र, खर्च), an observation and a reminder
 * are always open.
 *
 * The answer comes from the pull's access scope (`accessScopes[].workKinds`, written only for a limited seat), kept in `appMeta` with the rest
 * (no Dexie bump). When the phone does not know - no scope yet, a farm the answer does not cover, an older server - it answers "every kind": the
 * server decides again on every write, and a refusal that still comes is parked with words (P9: no seat today is limited; P11).
 */
import { useStoredAccessScopes } from './storedFarmScope';
import { isReadableScope, readAccessScopes, scopeForFarm, type StoredAccessScopes } from '../../infrastructure/storage/accessScopeStore';
import { useOptionalFarmContext } from './FarmContext';

/** The six kinds an owner may limit, in the contract's order. */
export const LIMITABLE_WORK_KINDS = ['cropActivities', 'irrigation', 'inputs', 'labour', 'machinery', 'activityExpenses'] as const;
/** Never limited: an observation is not work, a reminder is his own. */
export const ALWAYS_OPEN_WORK_KINDS = ['observations', 'plannedTasks'] as const;

export type WorkKind = typeof LIMITABLE_WORK_KINDS[number];

const LIMITABLE = new Set<string>(LIMITABLE_WORK_KINDS);

export const isLimitableWorkKind = (kind: string): kind is WorkKind => LIMITABLE.has(kind);

/**
 * The kinds this person may record on `farmId`, or `null` = every kind (not limited, or not known). Only a READABLE scope that names a list limits;
 * a name the phone does not know is never a kind he gains.
 */
export function allowedWorkKinds(stored: StoredAccessScopes | null, farmId: string | null | undefined): ReadonlySet<WorkKind> | null {
    const scope = scopeForFarm(stored, farmId);
    if (!scope || !isReadableScope(scope) || !Array.isArray(scope.workKinds)) return null;
    return new Set(scope.workKinds.filter(isLimitableWorkKind));
}

/** May he record `kind` there? Always-open kinds and "not known" are always yes. */
export function mayRecordKind(stored: StoredAccessScopes | null, farmId: string | null | undefined, kind: string): boolean {
    if (!isLimitableWorkKind(kind)) return true;
    const allowed = allowedWorkKinds(stored, farmId);
    return allowed === null || allowed.has(kind);
}

/** The closed kinds a record carries (a non-empty bucket he may not record), in the contract's order. */
export function closedKindsOf(record: Partial<Record<string, unknown>>, allowed: ReadonlySet<WorkKind> | null): WorkKind[] {
    if (allowed === null) return [];
    return LIMITABLE_WORK_KINDS.filter(kind => {
        const rows = record[kind];
        return Array.isArray(rows) && rows.length > 0 && !allowed.has(kind);
    });
}

/** The stored answer for one farm, read once (the save path). */
export async function readAllowedWorkKinds(farmId: string | null | undefined): Promise<ReadonlySet<WorkKind> | null> {
    if (!farmId) return null;
    try {
        return allowedWorkKinds(await readAccessScopes(), farmId);
    } catch {
        // Not known: the server decides (it refuses with a code the phone parks with words).
        return null;
    }
}

/** The OPEN farm's limit, kept live (the doors read this; FIX-2: one open farm, the one in the header). */
export function useOpenFarmWorkKinds(): ReadonlySet<WorkKind> | null {
    const farm = useOptionalFarmContext();
    const stored = useStoredAccessScopes();
    return allowedWorkKinds(stored, farm?.currentFarm?.farmId ?? farm?.currentFarmId ?? null);
}

/** "May he record this kind on the open farm?" for a door (always-open kinds and "not known" are yes). */
export function useMayRecordOnOpenFarm(): (kind: string) => boolean {
    const allowed = useOpenFarmWorkKinds();
    return kind => !isLimitableWorkKind(kind) || allowed === null || allowed.has(kind);
}
