// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I4 — X4)
//
// A money entry made without an explicit farm used to take the FIRST cached money event's
// farm (the wrong farm for a farmer with two) or the literal 'farm_unknown', which fails
// the GUID check — so a first bill on a fresh phone was kept on the phone and never sent.
// Through the REAL MutationQueue + validator over fake-indexeddb, like its sibling suite.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { financeCommandService } from '../financeCommandService';
import { getUnqueueableLogCount, resetUnqueueableLogs } from '../../sync/status/unqueueableLogs';
import type { MoneySourcePayload } from '../finance.types';

const FARM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FARM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const payload = (sourceId: string, over: Partial<MoneySourcePayload> = {}): MoneySourcePayload => ({
    type: 'Procurement',
    sourceId,
    dateTime: '2026-10-25T10:00:00Z',
    eventType: 'Expense',
    category: 'Input',
    amount: 450,
    createdByUserId: '22222222-2222-4222-8222-222222222222',
    ...over,
});

async function sentFarmIds(): Promise<string[]> {
    const rows = await getDatabase().mutationQueue
        .where('mutationType').equals(SyncMutationName.AddCostEntry).toArray();
    return rows.map((r) => (r.payload as { farmId: string }).farmId);
}

describe('a money entry carries the farm this phone is working on', () => {
    beforeEach(async () => {
        await getDatabase().mutationQueue.clear();
        SessionStore.clearCurrentFarmId();
    });
    afterEach(() => SessionStore.clearCurrentFarmId());

    it('first bill on a fresh phone: no farm passed, current farm set → sent with the current farm', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        const event = financeCommandService.createMoneyEventFromSource(payload(`fresh-${Date.now()}`));
        await flush();
        expect(event.farmId).toBe(FARM_A);
        expect(await sentFarmIds()).toEqual([FARM_A]);
    });

    it('never borrows another cached entry\'s farm — a farmer on his second farm gets the second farm', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        financeCommandService.createMoneyEventFromSource(payload(`a-${Date.now()}`));
        SessionStore.setCurrentFarmId(FARM_B);
        const second = financeCommandService.createMoneyEventFromSource(payload(`b-${Date.now()}`));
        await flush();
        expect(second.farmId).toBe(FARM_B);
        expect((await sentFarmIds()).sort()).toEqual([FARM_A, FARM_B].sort());
    });

    it('a farm passed by the caller wins over the current farm', async () => {
        SessionStore.setCurrentFarmId(FARM_A);
        const event = financeCommandService.createMoneyEventFromSource(payload(`explicit-${Date.now()}`, { farmId: FARM_B }));
        await flush();
        expect(event.farmId).toBe(FARM_B);
        expect(await sentFarmIds()).toEqual([FARM_B]);
    });

    it('no farm at all: nothing queued, reported as unsent, never the made-up "farm_unknown"', async () => {
        resetUnqueueableLogs();
        const event = financeCommandService.createMoneyEventFromSource(payload(`nofarm-${Date.now()}`));
        await flush();
        expect(event.farmId).not.toBe('farm_unknown');
        expect(await sentFarmIds()).toEqual([]);
        // The honest part: the sync badge's "saved here but never sent" count includes it.
        // (The receipt or log it came from stays on the phone; the money entry itself is
        // only in the in-memory list, which reloads from the server rows.)
        expect(getUnqueueableLogCount()).toBe(1);
    });
});
