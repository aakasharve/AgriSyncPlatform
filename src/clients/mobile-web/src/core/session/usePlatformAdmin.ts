/**
 * usePlatformAdmin — is the signed-in person ShramSafal's platform admin?
 *
 * spec: plr-d10 lane F99 fix pass 1 (D-72) — the price list is one list for every farm, so only the platform admin may
 * write it (the server refuses anyone else on REST and on push). The price book shows its write controls only to him
 * (P5: no control that does nothing). Fails closed: until the server has answered, offline, or on any error, the answer
 * is `false` and the page stays read-only.
 */
import { useEffect, useState } from 'react';
import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';
import { getAdminMeScope, isPlatformAdminScope } from '../../infrastructure/api/resources/AdminResource';

export function usePlatformAdmin(): boolean {
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        let cancelled = false;
        getAdminMeScope(agriSyncClient).then(
            body => { if (!cancelled) setIsAdmin(isPlatformAdminScope(body)); },
            () => { if (!cancelled) setIsAdmin(false); },
        );
        return () => { cancelled = true; };
    }, []);

    return isAdmin;
}
