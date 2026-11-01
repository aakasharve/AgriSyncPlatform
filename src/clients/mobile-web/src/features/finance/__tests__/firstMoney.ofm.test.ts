// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M fix pass 1) —
 *   - call C: money KEPT on this phone and sent later (`sendKeptMoney`) carries its line's CURRENT amount; a line he
 *     removed is not sent, and that leaves a trail on this phone;
 *   - review 4: the "money did not change" words stay until a later answer says that line's money is in step — an edit
 *     that touched no price never clears them;
 *   - review 10: the money a refusal names is found in the outbox by its id alone, even when its line was removed;
 *   - review 7 / 8: आढावा counts a queued edit that changes a price as a gap, and dates a gap by the farm's day.
 * Real Dexie (fake-indexeddb) and the real queue.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { namedMoneyRowsOfRecord } from '../../../infrastructure/sync/MutationDependency';
import { ReviseLogContentCommand } from '../../../application/usecases/sync/ReviseLogContentCommand';
import { financeCommandService } from '../financeCommandService';
import { holdMoney, readHeldMoney } from '../heldMoney';
import { moneyEntryIdFor } from '../moneyEntryIdentity';
import { readMoneyNotFollowed, takeEditMoney } from '../editMoney';
import { readLedgerGaps } from '../../reflect/overview/useMoneyLedger';
import type { MoneySourcePayload } from '../finance.types';

const LOG = '0f5e7000-0000-4000-8000-0000000000f1';
const FARM = '0f5e7000-0000-4000-8000-0000000000f2';
const in1 = moneyEntryIdFor(`${LOG}:input:in-1`);

const putRecord = (inputs: unknown[], date = '2026-10-25') => getDatabase().logs.put({
    id: LOG, schemaVersion: 1, date,
    log: { id: LOG, date, labour: [], machinery: [], activityExpenses: [], inputs, context: { selection: [] } },
} as never);

const kept: MoneySourcePayload = {
    type: 'VoiceLog', sourceId: `${LOG}:input:in-1`, dateTime: '2026-10-25T12:00:00', eventType: 'Expense', category: 'Input',
    farmId: null, logId: LOG, amount: 500, notes: 'इथरेल',
};

const queuedMoney = async () => (await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray())
    .map(r => r.payload as { costEntryId: string; amount: number });

beforeEach(async () => {
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    SessionStore.setCurrentFarmId(FARM);
    await getDatabase().farms.put({ id: FARM, payload: { id: FARM }, updatedAt: 'T' });
});
afterEach(() => SessionStore.clearCurrentFarmId());

describe('call C — money kept on this phone is sent at its line\'s current amount', () => {
    it('a kept ₹500 whose line now says ₹800 goes as ₹800', async () => {
        await putRecord([{ id: 'in-1', productName: 'इथरेल', cost: 800 }]);
        await holdMoney({ costEntryId: in1, payload: kept, reason: 'no-farm', heldAt: 'T' });

        const outcome = await financeCommandService.sendKeptMoney(kept, FARM);

        expect(outcome).toBe('queued');
        expect(await queuedMoney()).toEqual([expect.objectContaining({ costEntryId: in1, amount: 800 })]);
    });

    it('fix pass 2: a kept ₹500 whose line he removed goes at its ORIGINAL ₹500 (his edit corrects it), and leaves the list', async () => {
        await putRecord([]);
        await holdMoney({ costEntryId: in1, payload: kept, reason: 'no-farm', heldAt: 'T' });

        const outcome = await financeCommandService.sendKeptMoney(kept, FARM);

        expect(outcome).toBe('queued');
        expect(await queuedMoney()).toEqual([expect.objectContaining({ costEntryId: in1, amount: 500 })]);
        expect((await readHeldMoney()).map(h => h.costEntryId)).not.toContain(in1);
    });
});

describe('review 4 — the words stay until that line\'s money is in step', () => {
    it('an edit that touched no price never clears them; an answer naming that line\'s money does', async () => {
        await takeEditMoney(LOG, { moneyChanged: [], moneyCorrections: [], moneyNotFollowed: [{ kind: 'input', lineId: 'in-1', costEntryId: in1, reason: 'notFound' }] });
        expect(await readMoneyNotFollowed(LOG)).toEqual(['notFound']);

        await takeEditMoney(LOG, { moneyChanged: [], moneyCorrections: [], moneyNotFollowed: [] }); // irrigation hours only
        expect(await readMoneyNotFollowed(LOG)).toEqual(['notFound']);

        await takeEditMoney(LOG, {
            moneyChanged: [{ id: in1, farmId: FARM, amount: 500, entryDate: '2026-10-25' }],
            moneyCorrections: [{ id: 'c1', costEntryId: in1, correctedAmount: 800 }],
            moneyNotFollowed: [],
        });
        expect(await readMoneyNotFollowed(LOG)).toEqual([]);
    });
});

describe('review 10 — the money a refusal names is found by its id alone', () => {
    it('fix pass 4: money corrected in the money book is said as that, and kept until an answer says it is in step', async () => {
        await takeEditMoney(LOG, { moneyChanged: [], moneyCorrections: [], moneyNotFollowed: [{ kind: 'input', lineId: 'in-1', costEntryId: in1, reason: 'moneyBook' }] });
        expect(await readMoneyNotFollowed(LOG)).toEqual(['moneyBook']);
        await takeEditMoney(LOG, { moneyChanged: [], moneyCorrections: [], moneyNotFollowed: [] });
        expect(await readMoneyNotFollowed(LOG)).toEqual(['moneyBook']);
    });

    it('a named line he has since removed still finds its row in the outbox', async () => {
        await putRecord([]); // the line is no longer on this phone's copy
        const rows = await namedMoneyRowsOfRecord(LOG, [in1]);
        expect(rows).toEqual([{ id: in1, clientRequestId: `${SyncMutationName.AddCostEntry}:${in1}` }]);
    });
});

describe('reviews 7 and 8 — आढावा', () => {
    it('a queued edit that changes a price is a gap until it is applied, on the record\'s day', async () => {
        await putRecord([{ id: 'in-1', cost: 800 }], '2026-10-25');
        await ReviseLogContentCommand.enqueue({
            dailyLogId: LOG, baseVersion: 1, content: { schema: 1, inputs: [{ id: 'in-1', cost: 800 }] } as never, revisedAtUtc: '2026-11-01T09:00:00.000Z',
        }, { changesMoney: true });

        const gaps = await readLedgerGaps(new Set(), FARM);

        expect(gaps).toEqual([expect.objectContaining({ dateKey: '2026-10-25' })]);
    });

    it('a queued edit that changes no price is not a gap', async () => {
        await putRecord([{ id: 'in-1', cost: 800 }]);
        await ReviseLogContentCommand.enqueue({
            dailyLogId: LOG, baseVersion: 1, content: { schema: 1, inputs: [{ id: 'in-1', cost: 800 }] } as never, revisedAtUtc: '2026-11-01T09:00:00.000Z',
        });
        expect(await readLedgerGaps(new Set(), FARM)).toEqual([]);
    });

    it('a gap read from an instant is dated by the farm\'s day (India time)', async () => {
        await holdMoney({ costEntryId: 'kept-1', payload: { ...kept, sourceId: 'bill-1:line-1', logId: undefined, farmId: FARM, dateTime: '2026-10-31T19:30:00.000Z' }, reason: 'no-farm', heldAt: 'T' });
        const gaps = await readLedgerGaps(new Set(), FARM);
        expect(gaps.map(g => g.dateKey)).toEqual(['2026-11-01']);
    });
});
