/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 fix 1 (F11) — the money doors and the pull's purge read ONE answer: the server's last `accessScopes`
 * (kept by `accessScopeReconciler`). `/me/context` is only the stand-in before this phone's first pull since MU-3,
 * or for a farm that answer does not cover yet (one made on this phone a moment ago).
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { isReadableScope, readAccessScopes, scopeForFarm, type StoredAccessScopes } from '../../infrastructure/storage/accessScopeStore';
import { AUTHORITY, holdsAuthority } from './farmAuthorities';
import type { MeFarm } from './MeContextService';

/** The server's last scopes, kept live (`null` = none yet: never pulled since MU-3, or an older server). */
export function useStoredAccessScopes(): StoredAccessScopes | null {
    const [stored, setStored] = useState<StoredAccessScopes | null>(null);
    useEffect(() => {
        let alive = true;
        const subscription = liveQuery(() => readAccessScopes(getDatabase())).subscribe({
            next: value => { if (alive) setStored(value); },
            error: () => { if (alive) setStored(null); },
        });
        return () => { alive = false; subscription.unsubscribe(); };
    }, []);
    return stored;
}

/**
 * May the money doors open on this farm? The stored answer for the farm when there is one (a seat that is no longer
 * Active sees nothing); otherwise `/me/context`'s see-money authority; with no farm at all, `false` when the stored
 * answer says no farm's money is his, else `undefined` (the role rule, `mayShowFarmMoney`).
 */
export function seeMoneyDoor(
    stored: StoredAccessScopes | null,
    farmId: string | null | undefined,
    meFarm: Pick<MeFarm, 'role' | 'authorities'> | null | undefined,
): boolean | undefined {
    const scope = scopeForFarm(stored, farmId);
    if (scope) return isReadableScope(scope) && scope.seeMoney;
    if (meFarm) return holdsAuthority(meFarm, AUTHORITY.seeMoney);
    if (stored && !farmId) return stored.scopes.some(s => isReadableScope(s) && s.seeMoney) ? undefined : false;
    return undefined;
}
