/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF; review B003) — a PULL is incremental.
 *
 * THE DEFECT. Each pull hands `financeService` only the finance rows changed since the last one (the reconciler has
 * already written them into the phone's tables). The service REPLACED its whole cache with them, so after any later
 * pull every money screen summed only the newest rows: totals shrank and older corrections vanished, with nothing
 * saying so.
 *
 * WHAT THESE PIN, on the REAL service and its real listener (the same path `postReconcileEvents` uses), with the
 * phone's tables in an in-memory IndexedDB:
 *   1. a pull's rows are MERGED by id into what the cache holds — nothing it held is dropped;
 *   2. a changed row replaces only its own old copy, and corrections already held stay applied;
 *   3. a full read already under way when a pull lands (it may have read the tables before the pull wrote them) is
 *      followed by another, so it cannot leave the pull's rows out;
 *   4. the non-refreshing reads (`peek…`) start no refresh — a screen re-reading on every announcement cannot loop.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { financeSelectors } from '../financeSelectors';
import { financeService } from '../financeService';

const FARM = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-25T06:00:00.000Z';

const row = (id: string, amount: number) => ({
    id, farmId: FARM, categoryId: 'fuel', description: 'डिझेल', amount, currencyCode: 'INR', entryDate: '2026-10-25',
    createdByUserId: '22222222-2222-4222-8222-222222222222', createdAtUtc: NOW, modifiedAtUtc: NOW, isCorrected: false, direction: 'Expense',
});
const correction = (id: string, costEntryId: string, correctedAmount: number) =>
    ({ id, costEntryId, correctedAmount, reason: 'चूक', correctedByUserId: 'u', correctedAtUtc: NOW });

/** What the pull reconciler does: write the rows into the phone's tables, then announce them. */
async function pull(costEntries: ReturnType<typeof row>[], corrections: ReturnType<typeof correction>[] = []) {
    const db = getDatabase();
    for (const ce of costEntries) await db.costEntries.put({ id: ce.id, farmId: ce.farmId, payload: ce, updatedAt: NOW });
    for (const fc of corrections) await db.financeCorrections.put({ id: fc.id, costEntryId: fc.costEntryId, payload: fc, updatedAt: NOW });
    window.dispatchEvent(new CustomEvent('agrisync:finance-sync-payload', { detail: { costEntries, corrections, priceConfigs: [] } }));
}

const amounts = () => financeSelectors.peekEffectiveMoneyEvents().map(e => [e.id, e.effectiveAmount]).sort();
const settle = async () => { await financeService.refreshFromPhone(); await financeService.refreshFromPhone(); };

beforeEach(async () => {
    const db = getDatabase();
    await db.costEntries.clear();
    await db.financeCorrections.clear();
    await settle();
});
afterEach(async () => { await settle(); });

describe('financeService — an incremental pull merges into the ledger, never replaces it', () => {
    it('a second pull carrying one new row keeps every row the first pull brought', async () => {
        await pull([row('a', 1000), row('b', 500)]);
        expect(amounts()).toEqual([['a', 1000], ['b', 500]]);
        await pull([row('c', 250)]);
        expect(amounts()).toEqual([['a', 1000], ['b', 500], ['c', 250]]);
        await settle(); // a full read of the phone's tables agrees
        expect(amounts()).toEqual([['a', 1000], ['b', 500], ['c', 250]]);
    });

    it('a changed row replaces only its own copy; a correction already held stays applied', async () => {
        await pull([row('a', 1000), row('b', 500)], [correction('k1', 'a', 900)]);
        expect(amounts()).toEqual([['a', 900], ['b', 500]]);
        await pull([row('b', 450)]); // the next pull: b changed, no corrections in it
        expect(amounts()).toEqual([['a', 900], ['b', 450]]);
    });

    it('a full read under way when a pull lands is followed by another, so the pull\'s rows are not lost', async () => {
        await pull([row('a', 1000)]);
        await settle();
        const reading = financeService.refreshFromPhone(); // reads the tables as they are now (only a)
        // The pull lands while that read is running: its row is written after the read's snapshot, announced before
        // the read is applied. The stale read then replaces the cache with [a] — and the service must read again.
        const c = row('c', 250);
        const written = getDatabase().costEntries.put({ id: c.id, farmId: c.farmId, payload: c, updatedAt: NOW });
        window.dispatchEvent(new CustomEvent('agrisync:finance-sync-payload', { detail: { costEntries: [c], corrections: [], priceConfigs: [] } }));
        await written;
        await reading;
        // No further read is asked for here: the service's own follow-up read must bring c back.
        await vi.waitFor(() => expect(amounts()).toEqual([['a', 1000], ['c', 250]]), { timeout: 2000 });
    });

    it('peeking starts no refresh — a screen that re-reads on every announcement cannot loop', async () => {
        await pull([row('a', 1000)]);
        await settle();
        let announced = 0;
        const count = () => { announced += 1; };
        window.addEventListener('agrisync:finance-cache-updated', count);
        for (let i = 0; i < 5; i += 1) financeSelectors.peekEffectiveMoneyEvents();
        await new Promise(r => setTimeout(r, 30));
        window.removeEventListener('agrisync:finance-cache-updated', count);
        expect(announced).toBe(0);
    });
});
