// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M, F88) — the day a money entry sits on. An INSTANT (a
 * time with its zone, `…Z`) is put on the farm's day, India time — never the UTC date in front of the `T`, which is the
 * day before for anything between 00:00 and 05:30 India time. A plain day, or a day with a local time, keeps its own day.
 * Through the REAL MutationQueue + validator over fake-indexeddb.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { financeCommandService } from '../financeCommandService';
import { financeSelectors } from '../financeSelectors';
import { financeService } from '../financeService';
import { moneyDayKey } from '../moneyDay';

const FARM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('OF-M F88 — the farm\'s day of a money entry', () => {
    it('an instant is the India day; a plain day and a local time keep their own day', () => {
        expect(moneyDayKey('2026-10-31T19:30:00.000Z')).toBe('2026-11-01'); // 01:00 on 1 Nov in India
        expect(moneyDayKey('2026-10-31T18:29:00Z')).toBe('2026-10-31'); // 23:59 on 31 Oct in India
        expect(moneyDayKey('2026-10-31T23:00:00+05:30')).toBe('2026-10-31');
        expect(moneyDayKey('2026-11-01')).toBe('2026-11-01');
        expect(moneyDayKey('2026-11-01T12:00:00')).toBe('2026-11-01');
        // A server row as the phone holds it (`<entryDate>T00:00:00Z`) is its own day.
        expect(moneyDayKey('2026-10-27T00:00:00Z')).toBe('2026-10-27');
    });

    describe('through the queue', () => {
        beforeEach(async () => {
            await getDatabase().mutationQueue.clear();
            SessionStore.setCurrentFarmId(FARM);
            await getDatabase().farms.put({ id: FARM, payload: { id: FARM }, updatedAt: 'T' });
        });
        afterEach(() => SessionStore.clearCurrentFarmId());

        it('money made at 01:00 India time from an instant goes on that India day', async () => {
            const sourceId = `ofm-instant-${Date.now()}`;
            financeCommandService.createMoneyEventFromSource({
                type: 'Procurement', sourceId, dateTime: '2026-10-31T19:30:00.000Z', eventType: 'Expense', category: 'Input', amount: 450,
            });
            await flush();
            const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray();
            const mine = rows.map(r => r.payload as { entryDate: string; description: string }).find(p => p.description === sourceId);
            expect(mine?.entryDate).toBe('2026-11-01');
        });

        it('the money book\'s day filter reads a day the same way: an entry on 1 November is found on 1 November', async () => {
            const id = 'ofm-day-filter-1';
            await getDatabase().costEntries.put({
                id, farmId: FARM, updatedAt: 'T',
                payload: { id, farmId: FARM, categoryId: 'other', amount: 10, entryDate: '2026-11-01', direction: 'Expense' },
            });
            await financeService.refreshFromPhone();
            expect(financeSelectors.peekEffectiveMoneyEvents({ fromDate: '2026-11-01', toDate: '2026-11-01' }).map(e => e.id)).toContain(id);
            expect(financeSelectors.peekEffectiveMoneyEvents({ fromDate: '2026-10-31', toDate: '2026-10-31' }).map(e => e.id)).not.toContain(id);
        });
    });
});
