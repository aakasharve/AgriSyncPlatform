/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF)
 *
 * Where आढावा's money comes from: the server's cost ledger as this phone holds it, read through the finance pages'
 * own selector (corrections applied there, never re-implemented here), this farm's entries only; and the money told
 * on this phone that the ledger does not hold yet (the outbox's `add_cost_entry` rows, the money kept on the phone, and —
 * lane OF-M fix pass 1, review 7 — a queued edit that changes a price), which only ever makes a total say "partial".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => ({ list: [] as unknown[] }));
// The non-refreshing read (review B003): reading never asks the cache to refresh itself.
vi.mock('../../finance/financeSelectors', () => ({ financeSelectors: { peekEffectiveMoneyEvents: () => events.list } }));
vi.mock('../../finance/financeService', () => ({ financeService: { refreshFromPhone: async () => undefined } }));
const outbox = vi.hoisted(() => ({ rows: [] as unknown[], edits: [] as unknown[], editsName: '', held: [] as unknown[], asked: [] as string[], logs: {} as Record<string, unknown> }));
// ONE database object, as the real `getDatabase` returns while the same person is signed in. Each outbox read answers
// with the rows of the kind it asked for (lane OF-M fix pass 3, item 0: the gaps read two kinds of row).
const db = vi.hoisted(() => ({
    mutationQueue: { where: () => ({ equals: (name: string) => {
        outbox.asked.push(name);
        return { toArray: async () => (name === outbox.editsName ? outbox.edits : outbox.rows) };
    } }) },
    logs: { get: async (id: string) => outbox.logs[id] },
}));
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({ getDatabase: () => db }));
vi.mock('../../finance/heldMoney', () => ({ readHeldMoney: async () => outbox.held }));

import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { readLedgerEntries, readLedgerGaps } from '../overview/useMoneyLedger';

beforeEach(() => {
    events.list = []; outbox.rows = []; outbox.edits = []; outbox.held = []; outbox.asked = []; outbox.logs = {};
    outbox.editsName = SyncMutationName.ReviseLogContent;
});

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
        expect(outbox.asked).toContain(SyncMutationName.AddCostEntry);
        expect(gaps).toEqual([
            { plotId: 'g1', dateKey: '2026-10-25', direction: 'Expense' },
            { dateKey: '2026-10-20', direction: 'Income' },
            { plotId: 'g2', dateKey: '2026-10-23', direction: 'Expense' },
        ]);
    });

    it('lane OF-M (review 7): a queued edit that changes a price is a gap on the day of its record until applied; others are not', async () => {
        outbox.logs = { 'log-1': { log: { id: 'log-1', date: '2026-10-25', context: { selection: [{ selectedPlotIds: ['g1'] }] } } } };
        outbox.edits = [
            { clientRequestId: 'revise_log_content:log-1:a', farmId: 'farm-1', payload: { dailyLogId: 'log-1' }, status: 'PENDING', changesMoney: true },
            { clientRequestId: 'revise_log_content:log-1:b', farmId: 'farm-1', payload: { dailyLogId: 'log-1' }, status: 'PENDING' },
            { clientRequestId: 'revise_log_content:log-1:c', farmId: 'farm-1', payload: { dailyLogId: 'log-1' }, status: 'APPLIED', changesMoney: true },
        ];
        const gaps = await readLedgerGaps(new Set(), 'farm-1');
        expect(outbox.asked).toContain(SyncMutationName.ReviseLogContent);
        expect(gaps).toEqual([{ plotId: 'g1', dateKey: '2026-10-25', direction: 'Expense' }]);
    });

    it('nothing waiting → no gap (a complete ledger says nothing more)', async () => {
        expect(await readLedgerGaps(new Set(), 'farm-1')).toEqual([]);
    });
});
