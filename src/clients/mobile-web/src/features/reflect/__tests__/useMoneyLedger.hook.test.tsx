// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF; review B003)
 *
 * `useMoneyLedger` must always settle on the COMPLETE ledger, and never loop:
 *   - it asks for ONE full read per opening / change of records, and is complete only when that read has finished —
 *     however slow it is; the cache's announcements in the meantime are read as they stand and never start another;
 *   - an incremental pull merged into the cache is read in, and a later full read keeps it (never shrinks);
 *   - a full read or an outbox read that fails, and the first render before the gaps are known, are NOT complete —
 *     every total then says it is partial.
 * The finance cache and the phone's tables are stand-ins here (the merge itself is pinned in
 * `features/finance/__tests__/financeService.merge.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

interface Deferred { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void }
const deferred = (): Deferred => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

const cache = vi.hoisted(() => ({
    events: [] as unknown[],
    reads: [] as Deferred[],
    outbox: { fail: false, rows: [] as unknown[] },
}));
vi.mock('../../finance/financeSelectors', () => ({ financeSelectors: { peekEffectiveMoneyEvents: () => cache.events } }));
vi.mock('../../finance/financeService', () => ({
    financeService: { refreshFromPhone: vi.fn(() => { const d = deferred(); cache.reads.push(d); return d.promise; }) },
}));
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        mutationQueue: { where: () => ({ equals: () => ({ toArray: async () => { if (cache.outbox.fail) throw new Error('outbox unreadable'); return cache.outbox.rows; } }) }) },
    }),
}));
vi.mock('../../finance/heldMoney', () => ({ readHeldMoney: async () => [] }));

import { financeService } from '../../finance/financeService';
import { buildSeasonTotals } from '../overview/moneyModel';
import { selectAll, toViewScope } from '../overview/reflectSelection';
import { useMoneyLedger } from '../overview/useMoneyLedger';
import { CROPS } from './reflectFixtures';

const event = (id: string, amount: number, extra: Record<string, unknown> = {}) =>
    ({ id, farmId: 'farm-1', plotId: 'g1', dateTime: '2026-10-25T00:00:00Z', type: 'Expense', category: 'Labour', amount, effectiveAmount: amount, ...extra });
const announce = () => act(() => { window.dispatchEvent(new CustomEvent('agrisync:finance-cache-updated')); });
const finishRead = async (i: number) => { await act(async () => { cache.reads[i].resolve(); await cache.reads[i].promise; }); };
const costOf = (ledger: ReturnType<typeof useMoneyLedger>) => buildSeasonTotals(ledger, CROPS, toViewScope(CROPS, selectAll(CROPS)), () => [], true).cost;

beforeEach(() => {
    cache.events = [event('a', 1000), event('b', 500)];
    cache.reads = [];
    cache.outbox = { fail: false, rows: [] };
    vi.mocked(financeService.refreshFromPhone).mockClear();
});
afterEach(cleanup);

describe('useMoneyLedger — settles on the complete ledger, never loops', () => {
    it('first render: not complete (the full read and the outbox are not known yet) — the total says partial', () => {
        const { result } = renderHook(() => useMoneyLedger('farm-1', 1));
        expect(result.current.complete).toBe(false);
        expect(costOf(result.current)).toEqual({ amount: 1500, hidden: false, partial: ['unchecked'] });
    });

    it('a SLOW full read: incomplete until it finishes; announcements meanwhile are read as they stand and start no read', async () => {
        const { result } = renderHook(() => useMoneyLedger('farm-1', 1));
        for (let i = 0; i < 5; i += 1) {
            cache.events = [...cache.events, event(`n${i}`, 10)];
            announce();
        }
        await waitFor(() => expect(result.current.entries).toHaveLength(7));
        expect(result.current.complete).toBe(false);
        expect(financeService.refreshFromPhone).toHaveBeenCalledTimes(1); // never a loop
        await finishRead(0);
        await waitFor(() => expect(result.current.complete).toBe(true));
        expect(financeService.refreshFromPhone).toHaveBeenCalledTimes(1);
        expect(costOf(result.current)).toEqual({ amount: 1550, hidden: false, partial: [] });
    });

    it('an incremental pull, then a full read: the pull\'s rows are kept — the ledger never shrinks', async () => {
        let records = 1;
        const { result, rerender } = renderHook(() => useMoneyLedger('farm-1', records));
        await finishRead(0);
        await waitFor(() => expect(result.current.complete).toBe(true));
        expect(costOf(result.current).amount).toBe(1500);

        cache.events = [...cache.events, event('c', 250)]; // the cache merged a pull of one new row (not a replacement)
        announce();
        await waitFor(() => expect(costOf(result.current).amount).toBe(1750));
        expect(result.current.complete).toBe(true);

        records = 2; // the page's records changed: one more full read
        rerender();
        expect(financeService.refreshFromPhone).toHaveBeenCalledTimes(2);
        await finishRead(1);
        await waitFor(() => expect(result.current.entries.map(e => e.id)).toEqual(['a', 'b', 'c']));
        expect(costOf(result.current)).toEqual({ amount: 1750, hidden: false, partial: [] });
    });

    it('the full read fails: never complete', async () => {
        const { result } = renderHook(() => useMoneyLedger('farm-1', 1));
        await act(async () => { cache.reads[0].reject(new Error('tables unreadable')); await cache.reads[0].promise.catch(() => undefined); });
        await new Promise(r => setTimeout(r, 0));
        expect(result.current.complete).toBe(false);
        expect(costOf(result.current).partial).toEqual(['unchecked']);
    });

    it('the outbox cannot be read: never complete, even after the full read', async () => {
        cache.outbox.fail = true;
        const { result } = renderHook(() => useMoneyLedger('farm-1', 1));
        await finishRead(0);
        await waitFor(() => expect(result.current.entries).toHaveLength(2));
        await new Promise(r => setTimeout(r, 0));
        expect(result.current.complete).toBe(false);
        expect(costOf(result.current).partial).toEqual(['unchecked']);
    });

    it('money still in the outbox (not in the ledger) is a gap; the entry the ledger holds is not', async () => {
        cache.outbox.rows = [
            { payload: { costEntryId: 'a', farmId: 'farm-1', plotId: 'g1', entryDate: '2026-10-25', direction: 'Expense' } },
            { payload: { costEntryId: 'waiting', farmId: 'farm-1', plotId: 'g1', entryDate: '2026-10-25', direction: 'Expense' } },
        ];
        const { result } = renderHook(() => useMoneyLedger('farm-1', 1));
        await finishRead(0);
        await waitFor(() => expect(result.current.complete).toBe(true));
        expect(result.current.gaps).toEqual([{ plotId: 'g1', dateKey: '2026-10-25', direction: 'Expense' }]);
        expect(costOf(result.current).partial).toEqual(['notOnServer']);
    });
});
