/**
 * usePlatformAdmin — may the signed-in person edit the global price list (is he ShramSafal's platform admin)?
 *
 * spec: plr-d10 lane F99 fix pass 1 (D-72) — the price list is one list for every farm, so only the platform admin may
 * write it (the server refuses anyone else on REST and on push). The price book shows its write controls only to him
 * (P5: no control that does nothing). Fails closed: until the server has answered, offline, or on any error, the answer
 * is `false` and the page stays read-only.
 *
 * lane F99 fix pass 2 (review N-8) — it asks `GET /shramsafal/finance/price-config/may-write`, the same rule the write
 * obeys, answered quietly. It used to ask `/shramsafal/admin/me/scope`, which records every farmer who opens the price
 * book as an "unauthorised admin" in the admin metrics.
 */
import { useEffect, useState } from 'react';
import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';

/** The server's answer read strictly: only a literal `true` is a yes. */
export function mayWriteFrom(body: unknown): boolean {
    return typeof body === 'object' && body !== null && (body as { mayWrite?: unknown }).mayWrite === true;
}

export async function fetchMayWritePriceList(): Promise<boolean> {
    const response = await agriSyncClient.http.get<unknown>('/shramsafal/finance/price-config/may-write');
    return mayWriteFrom(response.data);
}

export function usePlatformAdmin(): boolean {
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetchMayWritePriceList().then(
            may => { if (!cancelled) setIsAdmin(may); },
            () => { if (!cancelled) setIsAdmin(false); },
        );
        return () => { cancelled = true; };
    }, []);

    return isAdmin;
}
