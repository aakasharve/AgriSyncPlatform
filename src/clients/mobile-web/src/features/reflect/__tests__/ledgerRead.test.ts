/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF)
 *
 * Where आढावा's money comes from: the server's cost ledger as this phone holds it, read through the finance pages'
 * own selector (corrections applied there, never re-implemented here), this farm's entries only; and the money told
 * on this phone that the ledger does not hold yet (the outbox's `add_cost_entry` rows, the money kept on the phone),
 * which only ever makes a total say "partial".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('../../finance/financeSelectors', () => ({ financeSelectors: { getEffectiveMoneyEvents: () => events.list } }));
const outbox = vi.hoisted(() => ({ rows: [] as unknown[], held: [] as unknown[], asked: '' }));
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        mutationQueue: { where: () => ({ equals: (name: string) => { outbox.asked = name; return { toArray: async () => outbox.rows }; } }) },
    }),
}));
vi.mock('../../finance/heldMoney', () => ({ readHeldMoney: async () => outbox.held }));

import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { readLedgerEntries, readLedgerGaps } from '../overview/useMoneyLedger';

beforeEach(() => { events.list = []; outbox.rows = []; outbox.held = []; });

describe('readLedgerEntries', () => {
    it('this farm\'s entries, each with the CORRECTED amount the finance selector gives, its direction, category, plot and day', () => {
        events.list = [
            { id: 'a', farmId: 'farm-1', plotId: 'g1', dateTime: '2026-10-25T00:00:00Z', type: 'Expense', category: 'Labour', amount: 500, effectiveAmount: 450 },
            { id: 'b', farmId: 'farm-1', dateTime: '2026-10-24T00:00:00Z', type: 'Unknown', category: 'Other', amount: 90, effectiveAmount: 90 },
            { id: 'c', farmId: 'farm-2', plotId: 'x', dateTime: '2026-10-25T00:00:00Z', type: 'Income', category: 'Other', amount: 7, effectiveAmount: 7 },
        ];
        expect(readLedgerEntries('farm-1')).toEqual([
            { id: 'a', plotId: 'g1', dateKey: '2026-10-25', direction: 'Expense', category: 'Labour', amount: 450 },
            { id: 'b', dateKey: '2026-10-24', direction: 'Unknown', category: 'Other', amount: 90 },
        ]);
        expect(readLedgerEntries(null)).toHaveLength(3); // the farm not known yet: nothing is dropped
    });
});

describe('readLedgerGaps', () => {
    it('money told on this phone that the ledger does not hold yet — outbox rows and money kept on the phone; once each', async () => {
        outbox.rows = [
            { payload: { costEntryId: 'in-ledger', farmId: 'farm-1', plotId: 'g1', entryDate: '2026-10-25', direction: 'Expense' }, status: 'APPLIED' },
            { payload: { costEntryId: 'waiting', farmId: 'farm-1', plotId: 'g1', entryDate: '2026-10-25', direction: 'Expense' }, status: 'PENDING' },
            { payload: { costEntryId: 'refused', farmId: 'farm-1', entryDate: '2026-10-20', direction: 'Income' }, status: 'REJECTED_USER_REVIEW' },
            { payload: { costEntryId: 'other-farm', farmId: 'farm-2', entryDate: '2026-10-25', direction: 'Expense' }, status: 'PENDING' },
        ];
        outbox.held = [
            { costEntryId: 'kept', payload: { plotId: 'g2', dateTime: '2026-10-23T05:00:00.000Z', eventType: 'Expense' }, reason: 'no-farm', heldAt: '' },
            { costEntryId: 'waiting', payload: { plotId: 'g1', dateTime: '2026-10-25T05:00:00.000Z', eventType: 'Expense', farmId: 'farm-1' }, reason: 'no-farm', heldAt: '' },
        ];
        const gaps = await readLedgerGaps(new Set(['in-ledger']), 'farm-1');
        expect(outbox.asked).toBe(SyncMutationName.AddCostEntry);
        expect(gaps).toEqual([
            { plotId: 'g1', dateKey: '2026-10-25', direction: 'Expense' },
            { dateKey: '2026-10-20', direction: 'Income' },
            { plotId: 'g2', dateKey: '2026-10-23', direction: 'Expense' },
        ]);
    });

    it('nothing waiting → no gap (a complete ledger says nothing more)', async () => {
        expect(await readLedgerGaps(new Set(), 'farm-1')).toEqual([]);
    });
});
