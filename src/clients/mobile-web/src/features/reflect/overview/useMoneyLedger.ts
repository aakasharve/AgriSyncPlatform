/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF) — the farm's money as the SERVER's ledger holds it, for
 * आढावा (`moneyModel.ts` turns it into figures):
 *   - entries: the server's cost entries with the finance corrections applied — the finance pages' own read
 *     (`financeSelectors.peekEffectiveMoneyEvents`, the same correction rule), never a copy of its rules; this
 *     farm's only;
 *   - gaps: money told on this phone that the ledger does not hold yet, read from where the money path writes it —
 *     the outbox (`add_cost_entry` rows, any state) and the money kept on this phone (`heldMoney`). An entry the
 *     ledger already holds is not a gap. Lane OF-M fix pass 1 (review 7): a queued edit that changes a price
 *     (`revise_log_content` marked `changesMoney`) is a gap for its record until it is applied — the server changes that
 *     money only then. These make a total say it is partial; they are never added to it;
 *   - complete: true only once a FULL read of the phone's copy of the ledger has finished AND the gaps are known.
 *
 * Review B003 — how it settles on the complete ledger, and why it cannot loop:
 *   1. On opening (and whenever the page's records change) it asks for ONE full read (`refreshFromPhone`) and reads
 *      the cache when that read has finished, however long it takes. Until then — or if it fails — the ledger is
 *      not complete, and every total says so.
 *   2. Whenever the cache announces new data (a pull merged in, a new entry), it reads the cache AS IT STANDS
 *      (`peek…`): reading never starts another refresh, so an announcement can never cause one.
 *   3. The outbox is read after every change; until it has been read, or when it cannot be, nothing is complete.
 */
import { useEffect, useMemo, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { QueueRowWithFacts } from '../../../infrastructure/sync/queueRowFacts';
import type { AddCostEntryPayload } from '../../../application/usecases/sync/AddCostEntryCommand';
import { financeSelectors } from '../../finance/financeSelectors';
import { financeService } from '../../finance/financeService';
import { readHeldMoney } from '../../finance/heldMoney';
import { moneyDayKey } from '../../finance/moneyDay';
import type { Ledger, LedgerEntry, LedgerGap } from './moneyModel';

const CACHE_UPDATED = 'agrisync:finance-cache-updated';

// lane OF-M fix pass 1 (review 8) — one rule for a money day: the farm's day (India time), `moneyDay.ts`.
const dateKeyOf = (value: string | undefined): string => (value ? moneyDayKey(value) : '');

/** The ledger entries of this farm (every farm when the farm is not known yet), as the cache holds them now. */
export function readLedgerEntries(farmId: string | null): LedgerEntry[] {
    return financeSelectors.peekEffectiveMoneyEvents()
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

/** Money told on this phone that the ledger does not hold yet. Rejects when the outbox cannot be read. */
export async function readLedgerGaps(known: ReadonlySet<string>, farmId: string | null): Promise<LedgerGap[]> {
    const [rows, held, edits] = await Promise.all([
        getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray(),
        readHeldMoney(),
        getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.ReviseLogContent).toArray(),
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
    for (const edit of (edits as QueueRowWithFacts[]).filter(e => e.changesMoney && e.status !== 'APPLIED' && e.status !== 'REJECTED_DROPPED')) {
        const logId = String((edit.payload as { dailyLogId?: unknown } | null)?.dailyLogId ?? '');
        const record = logId ? (await getDatabase().logs.get(logId))?.log : undefined;
        const plotIds = (record?.context?.selection ?? []).flatMap(sel => sel.selectedPlotIds ?? []);
        add(`edit:${edit.clientRequestId}`, edit.farmId, {
            ...(plotIds.length === 1 ? { plotId: plotIds[0] } : {}),
            dateKey: record?.date ?? '',
            direction: 'Expense',
        });
    }
    return gaps;
}

export function useMoneyLedger(farmId: string | null, refreshKey: unknown): Ledger {
    // What was read, and for which farm: another farm's read is never this farm's (nor complete for it).
    const [state, setState] = useState(() => ({ farm: farmId, entries: readLedgerEntries(farmId), full: false }));
    const fallback = useMemo(() => (state.farm === farmId ? null : readLedgerEntries(farmId)), [state.farm, farmId]);
    const entries = fallback ?? state.entries;
    const readInFull = state.farm === farmId && state.full;

    // 1. One full read per opening / change of records; complete only once it has finished.
    useEffect(() => {
        let alive = true;
        financeService.refreshFromPhone()
            .then(() => { if (alive) setState({ farm: farmId, entries: readLedgerEntries(farmId), full: true }); })
            .catch(() => { if (alive) setState({ farm: farmId, entries: readLedgerEntries(farmId), full: false }); });
        return () => { alive = false; };
    }, [farmId, refreshKey]);

    // 2. New data in the cache is read as it stands — never a refresh, so never a loop.
    useEffect(() => {
        const onUpdated = () => setState(s => ({ farm: farmId, entries: readLedgerEntries(farmId), full: s.farm === farmId && s.full }));
        window.addEventListener(CACHE_UPDATED, onUpdated);
        return () => window.removeEventListener(CACHE_UPDATED, onUpdated);
    }, [farmId]);

    // 3. The gaps, after every change; unknown until read, and unknown again if the outbox cannot be read.
    const [gaps, setGaps] = useState<{ list: LedgerGap[]; known: boolean }>({ list: [], known: false });
    useEffect(() => {
        let alive = true;
        readLedgerGaps(new Set(entries.map(e => e.id)), farmId)
            .then(list => { if (alive) setGaps({ list, known: true }); })
            .catch(() => { if (alive) setGaps({ list: [], known: false }); });
        return () => { alive = false; };
    }, [entries, farmId]);

    return useMemo(() => ({ entries, gaps: gaps.list, complete: readInFull && gaps.known }), [entries, gaps, readInFull]);
}
