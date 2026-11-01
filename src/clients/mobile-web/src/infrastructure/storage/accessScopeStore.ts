/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 (plan step 4a; founder D-22 / D-26) — what the SERVER last said this person may read on each
 * farm (`/sync/pull` → `accessScopes`), kept in `appMeta` (no Dexie version bump), and the farms it stopped
 * sending (paused, removed, never approved). The phone never decides access itself: it only remembers the
 * server's last answer, so the pull's purge and the save path read the same thing.
 */
import type { FarmAccessScopeDto } from '../api/dtos';
import type { AgriLogDatabase } from './DexieDatabase';
import { getDatabase } from './DexieDatabase';

/** The server's last scopes: `{ receivedAtUtc, scopes }`. Absent = an older server, or never pulled. */
export const ACCESS_SCOPES_META_KEY = 'shramsafal_access_scopes_v1';

/** Farms this phone held that the server stopped sending: `{ farmIds, updatedAtUtc }`. */
export const OUT_OF_SCOPE_FARMS_META_KEY = 'shramsafal_out_of_scope_farms_v1';

export interface StoredAccessScopes {
    receivedAtUtc: string;
    scopes: FarmAccessScopeDto[];
}

export async function readAccessScopes(db: AgriLogDatabase = getDatabase()): Promise<StoredAccessScopes | null> {
    const row = await db.appMeta.get(ACCESS_SCOPES_META_KEY);
    const value = row?.value as StoredAccessScopes | undefined;
    return value && Array.isArray(value.scopes) ? value : null;
}

/** lane MU-3 fix 1 (F9) — at most this many farms are named in one pull (the server's own cap). */
export const MAX_HELD_FARMS = 100;

/**
 * lane MU-3 fix 1 (F9) — every farm this phone holds anything of (its farm row, a plot, a crop season), so the
 * pull can ask the server about each one by name. Sorted, so the same phone sends the same list.
 */
export async function readHeldFarmIds(db: AgriLogDatabase = getDatabase()): Promise<string[]> {
    const held = new Set<string>();
    for (const farm of await db.farms.toArray()) held.add(farm.id);
    for (const plot of await db.plots.toArray()) held.add(plot.farmId);
    for (const cycle of await db.cropCycles.toArray()) held.add(cycle.farmId);
    return [...held].filter(id => typeof id === 'string' && id.length > 0).sort().slice(0, MAX_HELD_FARMS);
}

/**
 * lane MU-3 fix 1 (F11) — the server's last word on ONE farm, or `undefined` when this phone has none yet (never
 * pulled since MU-3, or the farm is not in the last answer). The money doors read THIS, the same answer the purge
 * applied; `/me/context` is only the stand-in before the first pull.
 */
export function scopeForFarm(stored: StoredAccessScopes | null, farmId: string | null | undefined): FarmAccessScopeDto | undefined {
    if (!stored || !farmId) return undefined;
    return stored.scopes.find(s => s.farmId === farmId);
}

/** lane MU-3 fix 1 (F9) — does this entry say the person reads the farm now? (absent status = an older server = yes) */
export function isReadableScope(scope: FarmAccessScopeDto): boolean {
    return scope.status === undefined || scope.status === 'Active';
}

export async function readOutOfScopeFarmIds(db: AgriLogDatabase = getDatabase()): Promise<Set<string>> {
    const row = await db.appMeta.get(OUT_OF_SCOPE_FARMS_META_KEY);
    const ids = (row?.value as { farmIds?: unknown } | undefined)?.farmIds;
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
}

/**
 * Thrown by the save path for a farm the server no longer lets this person work on (paused or removed):
 * the record is refused BEFORE it is written, with words the farmer can read, instead of being queued
 * for a refusal he would only meet later. PROPOSED twins (Marathi / English).
 */
export class FarmOutOfScopeError extends Error {
    readonly farmId: string;
    readonly messageMr = 'या शेतावर आता तुमची नोंद घेतली जात नाही. मालकाशी बोला.'; // PROPOSED (Marathi)
    readonly messageEn = 'Records for this farm are no longer taken from you. Speak to the owner.'; // PROPOSED (English)

    constructor(farmId: string) {
        super('Records for this farm are no longer taken from you. Speak to the owner.');
        this.name = 'FarmOutOfScopeError';
        this.farmId = farmId;
    }
}

/**
 * Refuses a save for a farm the server stopped sending this person. Unknown (no scopes yet, an older
 * server, a farm this phone just created offline) is never refused: only the server's own answer is.
 */
export async function assertFarmsInScope(farmIds: Iterable<string | null | undefined>, db?: AgriLogDatabase): Promise<void> {
    const outOfScope = await readOutOfScopeFarmIds(db);
    if (outOfScope.size === 0) return;
    for (const farmId of farmIds) {
        if (farmId && outOfScope.has(farmId)) {
            throw new FarmOutOfScopeError(farmId);
        }
    }
}
