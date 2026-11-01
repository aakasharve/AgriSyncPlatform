// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M fix pass 1, call C) — a record's FIRST money never lands
 * at an old amount, with no change to a released type:
 *   - a queued edit (`revise_log_content`) waits, uncharged, while that record's first money is still in the outbox, so
 *     the server finds the money and the edit corrects it;
 *   - first money sent AFTER an edit (a retry, a held row released) carries the line's CURRENT amount; when the line was
 *     removed it is not sent, and the removal leaves a trail on this phone (the row and an audit row), never a silent drop;
 *   - once a record's money arrives, the "money did not change" words for that line are cleared.
 *
 * Real BackgroundSyncWorker + MutationQueue + Dexie (fake-indexeddb); only the network boundary is mocked.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-11-01T12:00:00.000Z',
        nextCursorUtc: '2026-11-01T12:00:00.000Z',
        farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [],
        financeCorrections: [], dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [],
    }),
}));

vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return { ...actual, agriSyncClient: { pushSyncBatch: pushBatchMock, pullSyncChanges: pullChangesMock } };
});
vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'test-user', accessToken: 'test', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));
vi.mock('../../../features/sync/pull/SyncPullReconciler', () => ({ reconcileSyncPull: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../AiJobWorker', () => ({ AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue } from '../MutationQueue';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { AddCostEntryCommand, type AddCostEntryPayload } from '../../../application/usecases/sync/AddCostEntryCommand';
import { ReviseLogContentCommand } from '../../../application/usecases/sync/ReviseLogContentCommand';
import { SyncMutationName } from '../SyncMutationCatalog';
import { moneyEntryIdFor } from '../../../features/finance/moneyEntryIdentity';
import { readMoneyNotFollowed, takeEditMoney } from '../../../features/finance/editMoney';

type Sent = { clientRequestId: string; mutationType: string; payload: unknown };
const LOG = '0f5e7000-0000-4000-8000-0000000000e1';
const FARM = '0f5e7000-0000-4000-8000-0000000000e2';
const in1 = moneyEntryIdFor(`${LOG}:input:in-1`);
const sent: Sent[][] = [];

function applyAll() {
    pushBatchMock.mockImplementation(async (request: { mutations: Sent[] }) => {
        sent.push(request.mutations);
        return {
            serverTimeUtc: '2026-11-01T12:00:00.000Z',
            results: request.mutations.map(m => ({ clientRequestId: m.clientRequestId, mutationType: m.mutationType, status: 'applied' as const, data: null })),
        };
    });
}

const putRecord = (inputs: unknown[]) => getDatabase().logs.put({
    id: LOG, schemaVersion: 1, date: '2026-10-25',
    log: { id: LOG, date: '2026-10-25', labour: [], machinery: [], activityExpenses: [], inputs },
} as never);

const firstMoney = (amount: number): AddCostEntryPayload => ({
    costEntryId: in1, farmId: FARM, categoryId: 'other', description: 'इथरेल', amount, currencyCode: 'INR',
    entryDate: '2026-10-25', direction: 'Expense', attachments: [],
});

const queueFirstMoney = (amount: number) => AddCostEntryCommand.enqueue(firstMoney(amount), { moneySource: `${LOG}:input:in-1` });
const rowOf = async (key: string) => (await getDatabase().mutationQueue.where('mutationType').anyOf(SyncMutationName.AddCostEntry, SyncMutationName.ReviseLogContent).toArray())
    .find(r => r.clientRequestId === key || r.clientRequestId.startsWith(key));
const sentTypes = () => sent.flat().map(m => m.mutationType);

describe('lane OF-M fix pass 1 (call C) — first money never lands at an old amount', () => {
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
        pushBatchMock.mockReset();
        sent.length = 0;
        await mutationQueue.setCursor('2026-10-30T00:00:00.000Z');
        applyAll();
    });

    it('a queued edit waits while the record\'s first money is still in the outbox, and goes once the money is applied', async () => {
        await putRecord([{ id: 'in-1', productName: 'इथरेल', cost: 800 }]);
        await queueFirstMoney(500);
        const money = await rowOf(`${SyncMutationName.AddCostEntry}:${in1}`);
        // The money is backing off after a failure: not offered this cycle.
        await getDatabase().mutationQueue.update(money!.id!, { nextRetryAfterMs: Date.now() + 60_000 });
        await ReviseLogContentCommand.enqueue({
            dailyLogId: LOG, baseVersion: 1, content: { schema: 1, inputs: [{ id: 'in-1', cost: 800 }] } as never, revisedAtUtc: '2026-11-01T09:00:00.000Z',
        });

        await backgroundSyncWorker.triggerNow();
        expect(sentTypes()).not.toContain(SyncMutationName.ReviseLogContent);
        const waiting = await rowOf(`${SyncMutationName.ReviseLogContent}:${LOG}`);
        expect(waiting?.status).toBe('PENDING');
        expect(waiting?.retryCount).toBe(0); // uncharged

        // The money becomes due and goes; then the edit goes behind it.
        await getDatabase().mutationQueue.update(money!.id!, { nextRetryAfterMs: undefined });
        await backgroundSyncWorker.triggerNow();
        await backgroundSyncWorker.triggerNow();
        const order = sentTypes();
        expect(order.indexOf(SyncMutationName.AddCostEntry)).toBeGreaterThanOrEqual(0);
        expect(order.indexOf(SyncMutationName.ReviseLogContent)).toBeGreaterThan(order.indexOf(SyncMutationName.AddCostEntry));
    });

    it('first money sent after an edit carries the line\'s CURRENT amount', async () => {
        await putRecord([{ id: 'in-1', productName: 'इथरेल', cost: 800 }]); // he changed ₹500 to ₹800
        await queueFirstMoney(500);

        await backgroundSyncWorker.triggerNow();

        const money = sent.flat().find(m => m.mutationType === SyncMutationName.AddCostEntry);
        expect((money?.payload as { amount: number }).amount).toBe(800);
    });

    it('fix pass 2: first money of a line he removed goes at its ORIGINAL amount, ahead of the edit that corrects it', async () => {
        await putRecord([]); // the priced line is gone
        await takeEditMoney(LOG, { moneyChanged: [], moneyCorrections: [], moneyNotFollowed: [{ kind: 'input', lineId: 'in-1', costEntryId: in1, reason: 'notFound' }] });
        await queueFirstMoney(500);
        await ReviseLogContentCommand.enqueue({
            dailyLogId: LOG, baseVersion: 1, content: { schema: 1 } as never, revisedAtUtc: '2026-11-01T09:00:00.000Z',
        });

        await backgroundSyncWorker.triggerNow();
        await backgroundSyncWorker.triggerNow();

        const money = sent.flat().find(m => m.mutationType === SyncMutationName.AddCostEntry);
        expect((money?.payload as { amount: number }).amount).toBe(500); // never dropped: rule B stays satisfied
        const order = sentTypes();
        expect(order.indexOf(SyncMutationName.ReviseLogContent)).toBeGreaterThan(order.indexOf(SyncMutationName.AddCostEntry));
        expect((await rowOf(`${SyncMutationName.AddCostEntry}:${in1}`))?.status).toBe('APPLIED');
        // ₹500 on the server is not the record's amount now: the words stay until an answer says it is in step.
        expect(await readMoneyNotFollowed(LOG)).toEqual(['notFound']);
    });

    it('once a record\'s money arrives, the "money did not change" words for that line are cleared', async () => {
        await putRecord([{ id: 'in-1', productName: 'इथरेल', cost: 800 }]);
        await takeEditMoney(LOG, { moneyChanged: [], moneyCorrections: [], moneyNotFollowed: [{ kind: 'input', lineId: 'in-1', costEntryId: in1, reason: 'notFound' }] });
        expect(await readMoneyNotFollowed(LOG)).toEqual(['notFound']);
        await queueFirstMoney(500);

        await backgroundSyncWorker.triggerNow();

        expect(await readMoneyNotFollowed(LOG)).toEqual([]);
    });
});
