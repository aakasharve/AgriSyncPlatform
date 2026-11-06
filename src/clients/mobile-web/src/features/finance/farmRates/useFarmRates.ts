/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 *
 * Everything the दरपत्रक shows for ONE farm, read the same way online and offline:
 *   - the farm's own list from this phone's copy (`farmRatesStore`), refreshed from the server when it answers (MERGED by
 *     id — the pull's per-farm cursor never re-sends an old rate to a phone that installed this version later, so the
 *     REST read is also how such a phone catches up);
 *   - may he set rates: the server's answer (the one gate the write obeys), remembered for offline use; before the first
 *     answer, the role the server last told this phone (/me/context) stands in. A wrong "yes" can only queue a change the
 *     server then refuses — parked and shown, never lost and never applied;
 *   - does he read work rates (see wages): the server's answer, else its last pull scopes; unknown = what the server sent;
 *   - his changes still on this phone (waiting / refused), the old book's drafts, and ShramSafal's suggested rates.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { readAccessScopes, scopeForFarm } from '../../../infrastructure/storage/accessScopeStore';
import { fetchFarmRates, fetchRateSuggestions } from './farmRatesApi';
import { mergeFarmRates, readFarmRates, readUnreadableFarmRates } from './farmRatesStore';
import { readQueuedFarmRates, readRateDrafts, type QueuedFarmRate, type RateDraft } from './farmRateQueue';
import type { FarmRateRow, RateSuggestion } from './farmRateSchema';

const ACCESS_META_PREFIX = 'shramsafal_farm_rate_access_v1:';

interface RememberedAccess {
    mayWrite: boolean;
    seeWorkRates: boolean;
    /** fix round 1 (F1) — absent in an answer remembered before the fix: then the pull scopes decide. */
    seeInputPrices?: boolean;
}

export interface FarmRatesView {
    loading: boolean;
    rows: FarmRateRow[];
    mayWrite: boolean;
    /**
     * fix round 1 (review F1) — `false` = this person reads none of the farm's rates (a seat that reads only its own
     * records — कामगार, or स्वतःचं काम — or one without see money): the page shows the ShramSafal rule, not the list.
     */
    seeInputPrices?: boolean;
    /** `false` = the server says this person does not read work rates; `undefined` = not known. */
    seeWorkRates?: boolean;
    queued: QueuedFarmRate[];
    drafts: RateDraft[];
    suggestions: RateSuggestion[];
    /** The server answered this time (otherwise the list is this phone's last copy). */
    fromServer: boolean;
    /** This phone's own copy could not be read: the page says so instead of showing an empty list as the truth. */
    failed?: boolean;
    /** fix round 1 (F5) — rows this phone received and could not read: the page says some rates are missing. */
    unreadable?: number;
}

const EMPTY: FarmRatesView = { loading: true, rows: [], mayWrite: false, queued: [], drafts: [], suggestions: [], fromServer: false };

async function remembered(db: AgriLogDatabase, farmId: string): Promise<RememberedAccess | undefined> {
    const row = await db.appMeta.get(`${ACCESS_META_PREFIX}${farmId}`);
    const value = row?.value as Partial<RememberedAccess> | undefined;
    return value && typeof value.mayWrite === 'boolean' && typeof value.seeWorkRates === 'boolean'
        ? { mayWrite: value.mayWrite, seeWorkRates: value.seeWorkRates,
            ...(typeof value.seeInputPrices === 'boolean' ? { seeInputPrices: value.seeInputPrices } : {}) }
        : undefined;
}

export async function loadFarmRatesView(
    farmId: string | null,
    stand: { isPrimaryHolder?: boolean; selfUserId: string | null },
    db: AgriLogDatabase = getDatabase(),
): Promise<FarmRatesView> {
    if (!farmId) return { ...EMPTY, loading: false };
    const server = await fetchFarmRates(farmId).then(answer => answer, () => null);
    const now = new Date().toISOString();
    if (server) {
        // The REST read is the server's WHOLE list of this farm for him: its unreadable count replaces the earlier one.
        await mergeFarmRates(db, server.rawRates, now, farmId);
        await db.appMeta.put({
            key: `${ACCESS_META_PREFIX}${farmId}`,
            value: { mayWrite: server.mayWrite, seeWorkRates: server.seeWorkRates, seeInputPrices: server.seeInputPrices } satisfies RememberedAccess,
            updatedAt: now,
        });
    }

    const last = server ?? (await remembered(db, farmId));
    const scope = scopeForFarm(await readAccessScopes(db), farmId);
    const scopeReadsRates = scope ? scope.seeMoney && !scope.ownRecordsOnly : undefined;
    const seeInputPrices = last?.seeInputPrices ?? scopeReadsRates;
    const seeWorkRates = seeInputPrices === false ? false : last ? last.seeWorkRates : scope ? scope.seeWages : undefined;
    const rows = seeInputPrices === false
        ? []
        : (await readFarmRates(farmId, db)).filter(r => seeWorkRates !== false || r.kind !== 'Work');
    const mayWrite = last ? last.mayWrite : stand.isPrimaryHolder === true;
    // fix round 1 (F7) — ShramSafal's suggestions are asked for only by a person who can confirm one.
    const suggestions = mayWrite ? await fetchRateSuggestions().then(list => list, () => [] as RateSuggestion[]) : [];
    const unreadable = seeInputPrices === false ? 0 : await readUnreadableFarmRates(farmId, db);
    return {
        loading: false,
        rows,
        mayWrite,
        ...(seeInputPrices === undefined ? {} : { seeInputPrices }),
        ...(seeWorkRates === undefined ? {} : { seeWorkRates }),
        queued: await readQueuedFarmRates(farmId, db),
        drafts: mayWrite ? await readRateDrafts(stand.selfUserId, db) : [],
        suggestions,
        fromServer: !!server,
        ...(unreadable > 0 ? { unreadable } : {}),
    };
}

export function useFarmRates(
    farmId: string | null,
    stand: { isPrimaryHolder?: boolean; selfUserId: string | null },
): FarmRatesView & { reload: () => void } {
    const [view, setView] = useState<FarmRatesView>(EMPTY);
    const [tick, setTick] = useState(0);
    const reload = useCallback(() => setTick(t => t + 1), []);
    const { isPrimaryHolder, selfUserId } = stand;

    useEffect(() => {
        let cancelled = false;
        loadFarmRatesView(farmId, { isPrimaryHolder, selfUserId }).then(
            next => { if (!cancelled) setView(next); },
            // The phone's own copy could not be read: say nothing is known rather than show an empty list as the truth.
            () => { if (!cancelled) setView({ ...EMPTY, loading: false, failed: true }); },
        );
        return () => { cancelled = true; };
    }, [farmId, isPrimaryHolder, selfUserId, tick]);

    // A sync that lands while the page is open (his change sent, or the pull bringing a rate) is shown without reopening.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.addEventListener('agrisync:sync-reconciled', reload);
        return () => window.removeEventListener('agrisync:sync-reconciled', reload);
    }, [reload]);

    return { ...view, reload };
}
