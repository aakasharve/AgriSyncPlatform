/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF) — the farm's money as the SERVER's ledger holds it, for
 * आढावा (`moneyModel.ts` turns it into figures):
 *   - entries: the server's cost entries with the finance corrections applied — the finance pages' own read
 *     (`financeSelectors.getEffectiveMoneyEvents`), never a copy of its rules; this farm's only;
 *   - gaps: money told on this phone that the ledger does not hold yet, read from where the money path writes it —
 *     the outbox (`add_cost_entry` rows, any state) and the money kept on this phone (`heldMoney`). An entry the
 *     ledger already holds is not a gap. These make a total say it is partial; they are never added to it.
 *
 * Re-read when the page's records change and when the finance cache announces new data. Every read asks that cache to
 * refresh itself and the refresh announces itself, so an announcement right after this hook's own read is not news
 * (otherwise reading would never stop).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { AddCostEntryPayload } from '../../../application/usecases/sync/AddCostEntryCommand';
import { financeSelectors } from '../../finance/financeSelectors';
import { readHeldMoney } from '../../finance/heldMoney';
import type { Ledger, LedgerEntry, LedgerGap } from './moneyModel';

const CACHE_UPDATED = 'agrisync:finance-cache-updated';
/** An announcement this soon after our own read is that read's refresh. */
const OWN_REFRESH_MS = 2000;

const dateKeyOf = (value: string | undefined): string => (value ?? '').slice(0, 10);

/** The ledger entries of this farm (every farm when the farm is not known yet). */
export function readLedgerEntries(farmId: string | null): LedgerEntry[] {
    return financeSelectors.getEffectiveMoneyEvents()
        .filter(e => !farmId || e.farmId === farmId)
        .map(e => ({
            id: e.id,
            ...(e.plotId ? { plotId: e.plotId } : {}),
            dateKey: dateKeyOf(e.dateTime),
            direction: e.type,
            category: e.category,
            amount: e.effectiveAmount,
        }));
}

/** Money told on this phone that the ledger does not hold yet. A read that fails claims no gap. */
export async function readLedgerGaps(known: ReadonlySet<string>, farmId: string | null): Promise<LedgerGap[]> {
    const [rows, held] = await Promise.all([
        getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray(),
        readHeldMoney(),
    ]);
    const seen = new Set(known);
    const gaps: LedgerGap[] = [];
    const add = (id: string | undefined, gapFarm: string | undefined, gap: LedgerGap) => {
        if (!id || seen.has(id) || (farmId && gapFarm && gapFarm !== farmId)) return;
        seen.add(id);
        gaps.push(gap);
    };
    for (const row of rows) {
        const p = (row.payload ?? {}) as Partial<AddCostEntryPayload>;
        add(p.costEntryId, p.farmId, { ...(p.plotId ? { plotId: p.plotId } : {}), dateKey: dateKeyOf(p.entryDate), direction: p.direction ?? 'Unknown' });
    }
    for (const h of held) {
        add(h.costEntryId, h.payload.farmId ?? undefined, { ...(h.payload.plotId ? { plotId: h.payload.plotId } : {}), dateKey: dateKeyOf(h.payload.dateTime), direction: h.payload.eventType });
    }
    return gaps;
}

export function useMoneyLedger(farmId: string | null, refreshKey: unknown): Ledger {
    const [version, setVersion] = useState(0);
    const lastRead = useRef(0);
    const entries = useMemo(() => {
        lastRead.current = Date.now();
        return readLedgerEntries(farmId);
        // `refreshKey` / `version` only ask for a fresh read.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [farmId, refreshKey, version]);
    useEffect(() => {
        const onUpdated = () => { if (Date.now() - lastRead.current > OWN_REFRESH_MS) setVersion(v => v + 1); };
        window.addEventListener(CACHE_UPDATED, onUpdated);
        return () => window.removeEventListener(CACHE_UPDATED, onUpdated);
    }, []);

    const [gaps, setGaps] = useState<LedgerGap[]>([]);
    useEffect(() => {
        let alive = true;
        readLedgerGaps(new Set(entries.map(e => e.id)), farmId)
            .then(g => { if (alive) setGaps(g); })
            .catch(() => { if (alive) setGaps([]); });
        return () => { alive = false; };
    }, [entries, farmId]);

    return useMemo(() => ({ entries, gaps }), [entries, gaps]);
}
