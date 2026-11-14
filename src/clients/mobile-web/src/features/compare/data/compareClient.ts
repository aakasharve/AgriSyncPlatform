/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D2 Task 3; D-68, D-81, D-83 = 1; P4, P9, P10, P11) - the phone client of
 * `GET /shramsafal/farms/{farmId}/compare`. The server counts (the one engine); the phone only draws. NO screen is changed by this lane: the
 * तुलना screen is frozen until CMP-T, which reads `useFarmCompare`.
 *
 *   - an answer that reads is shown and kept per farm (`compareStore`), tagged with the signed-in user;
 *   - no net (the device says so, or the request never arrived): the kept answer of THIS farm and THIS user with the time the server gave
 *     it, else "offline"; another farm's or another user's kept answer is never shown;
 *   - a 403 or a 404 (this seat may not read the farm's तुलना, or the farm is not his - the server never reveals which): NOTHING is drawn and
 *     what was kept is forgotten. The server's refusal is the boundary; hiding the tab (CMP-D1) is only presentation;
 *   - any other error, or an answer that cannot be read: NOTHING is drawn - never a fake, never a stage with a number missing.
 * It never throws into a page. Fetched when तुलना opens and again after every sync (`agrisync:sync-reconciled`).
 */
import { useEffect, useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { getSessionUserId } from '../../../infrastructure/storage/AuthTokenStore';
import { onActiveDatabaseChanged } from '../../../infrastructure/storage/activeDatabaseName';
import { parseFarmCompare, type FarmCompareDto } from './compareDtos';
import { dropCompare, readCachedCompare, saveCompare } from './compareStore';

export const farmComparePath = (farmId: string): string => `/shramsafal/farms/${farmId}/compare`;

export type FarmCompareResult =
    | { kind: 'compare'; compare: FarmCompareDto; source: 'server' | 'cache'; asOfUtc: string }
    | { kind: 'offline' }
    | { kind: 'none' };

const NONE: FarmCompareResult = { kind: 'none' };

const statusOf = (error: unknown): number | undefined => (error as { response?: { status?: number } } | null)?.response?.status;

export async function loadFarmCompare(farmId: string | null | undefined): Promise<FarmCompareResult> {
    try {
        if (!farmId) return NONE;
        const userId = getSessionUserId();

        const keptOrOffline = async (): Promise<FarmCompareResult> => {
            const kept = await readCachedCompare(farmId, userId);
            return kept
                ? { kind: 'compare', compare: kept.compare, source: 'cache', asOfUtc: kept.compare.serverTimeUtc || kept.receivedAtUtc }
                : { kind: 'offline' };
        };

        if (typeof navigator !== 'undefined' && navigator.onLine === false) return await keptOrOffline();
        try {
            const response = await agriSyncClient.http.get<unknown>(farmComparePath(farmId));
            const compare = parseFarmCompare(response.data);
            if (!compare) return NONE;
            await saveCompare(farmId, userId, compare);
            return { kind: 'compare', compare, source: 'server', asOfUtc: compare.serverTimeUtc };
        } catch (error) {
            const status = statusOf(error);
            if (status === 404 || status === 403) {
                await dropCompare(farmId);
                return NONE;
            }
            if (status === undefined) return await keptOrOffline(); // the request never reached the server: no net
            return NONE;
        }
    } catch {
        return NONE; // never throws into a page
    }
}

/**
 * The answer for one farm, asked again when `refreshKey` changes, after every sync, and when the signed-in farmer's database changes.
 * `undefined` while the first answer is on its way. Never throws.
 */
export function useFarmCompare(farmId: string | null | undefined, refreshKey = ''): FarmCompareResult | undefined {
    const [result, setResult] = useState<{ scope: string; value: FarmCompareResult } | undefined>(undefined);
    const [syncs, setSyncs] = useState(0);
    const [dbEpoch, setDbEpoch] = useState(0);
    const key = `${farmId ?? ''}|${refreshKey}|${syncs}|${dbEpoch}`;
    // The answer on screen belongs to a farm and a database, NOT to a sync: a refetch after a sync keeps the last good answer until the new one
    // arrives (so an open sheet and the words typed in it survive). Another farm or another farmer's database drops it at once.
    const scope = `${farmId ?? ''}|${dbEpoch}`;

    // Another farmer's database: the old answer is dropped in the same breath, then asked again.
    useEffect(() => onActiveDatabaseChanged(() => {
        setResult(undefined);
        setDbEpoch(n => n + 1);
    }), []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const again = () => setSyncs(n => n + 1);
        window.addEventListener('agrisync:sync-reconciled', again);
        return () => window.removeEventListener('agrisync:sync-reconciled', again);
    }, []);

    useEffect(() => {
        if (!farmId) return undefined;
        let alive = true;
        void loadFarmCompare(farmId).then(
            value => { if (alive) setResult({ scope, value }); },
            () => { if (alive) setResult({ scope, value: NONE }); },
        );
        return () => { alive = false; };
    }, [farmId, key]); // eslint-disable-line react-hooks/exhaustive-deps

    return result?.scope === scope ? result.value : undefined;
}
