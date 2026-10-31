// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M, F89) — an edit saved with no internet makes or corrects
 * its money on the SERVER; the phone never changes money on its own. The revise answer names exactly the money rows the
 * server made or corrected (also on a repeated reply), and the phone writes only those, so the money book shows the
 * change — on the work's day — as soon as the edit applies, before any pull. Where the money could NOT follow, the answer
 * says why, and the phone keeps that for the screens to say plainly.
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
import { ReviseLogContentCommand } from '../../../application/usecases/sync/ReviseLogContentCommand';
import { financeSelectors } from '../../../features/finance/financeSelectors';
import { financeService } from '../../../features/finance/financeService';
import { moneyEntryIdFor } from '../../../features/finance/moneyEntryIdentity';
import { readMoneyNotFollowed } from '../../../features/finance/editMoney';

type PushRequest = { mutations: Array<{ clientRequestId: string; mutationType: string }> };
const LOG = '0f5e7000-0000-4000-8000-0000000000c1';
const FARM = '0f5e7000-0000-4000-8000-0000000000c2';
const PLOT = '0f5e7000-0000-4000-8000-0000000000c3';
const WORK_DAY = '2026-10-25'; // the record's own day: saved later, offline
const in1 = moneyEntryIdFor(`${LOG}:input:in-1`);
const in2 = moneyEntryIdFor(`${LOG}:input:in-2`);

const entry = (id: string, amount: number) => ({
    id, farmId: FARM, plotId: PLOT, cropCycleId: null, categoryId: 'other', description: 'इथरेल', amount, currencyCode: 'INR',
    entryDate: WORK_DAY, createdByUserId: 'u', createdAtUtc: '2026-11-01T10:00:00Z', modifiedAtUtc: '2026-11-01T10:00:00Z',
    location: null, isCorrected: false, direction: 'Expense',
});
const correction = (costEntryId: string, original: number, corrected: number) => ({
    id: `corr-${costEntryId}-${corrected}`, costEntryId, originalAmount: original, correctedAmount: corrected, currencyCode: 'INR',
    reason: 'Changed with its record', correctedByUserId: 'u', correctedAtUtc: '2026-11-01T10:00:00Z', modifiedAtUtc: '2026-11-01T10:00:00Z',
});

function answerWith(data: unknown, status: 'applied' | 'duplicate' = 'applied') {
    pushBatchMock.mockImplementation(async (request: PushRequest) => ({
        serverTimeUtc: '2026-11-01T12:00:00.000Z',
        results: request.mutations.map(m => ({ clientRequestId: m.clientRequestId, mutationType: m.mutationType, status, data })),
    }));
}

const queueEdit = (inputs: unknown[]) => ReviseLogContentCommand.enqueue({
    dailyLogId: LOG, baseVersion: 1, content: { schema: 1, inputs } as never, revisedAtUtc: '2026-11-01T09:00:00.000Z',
});

const inBook = (id: string) => financeSelectors.peekEffectiveMoneyEvents().find(e => e.id === id);

describe('lane OF-M — an offline edit\'s money, written from the server\'s answer only', () => {
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
        pushBatchMock.mockReset();
        await mutationQueue.setCursor('2026-10-30T00:00:00.000Z');
        // The ₹500 the record made when it was first saved, as the money book holds it.
        await getDatabase().costEntries.put({ id: in1, farmId: FARM, payload: entry(in1, 500), updatedAt: 'T' });
        await financeService.refreshFromPhone();
    });

    it('a changed value: the money book shows the corrected amount on the work\'s day as soon as the edit applies', async () => {
        await queueEdit([{ id: 'in-1', productName: 'इथरेल', cost: 800 }]);
        answerWith({ log: { id: LOG }, moneyChanged: [{ ...entry(in1, 500), isCorrected: true }], moneyCorrections: [correction(in1, 500, 800)], moneyNotFollowed: [] });

        await backgroundSyncWorker.triggerNow();

        expect(inBook(in1)?.effectiveAmount).toBe(800);
        expect(inBook(in1)?.dateTime.slice(0, 10)).toBe(WORK_DAY);
        expect(await getDatabase().financeCorrections.get(`corr-${in1}-800`)).toBeTruthy();
        expect(await readMoneyNotFollowed(LOG)).toEqual([]);
    });

    it('a line added: its new money is in the book under its own id, on the work\'s day', async () => {
        await queueEdit([{ id: 'in-1', cost: 500 }, { id: 'in-2', productName: 'युरिया', cost: 300 }]);
        answerWith({ log: { id: LOG }, moneyChanged: [entry(in2, 300)], moneyCorrections: [], moneyNotFollowed: [] });

        await backgroundSyncWorker.triggerNow();

        expect(inBook(in2)?.effectiveAmount).toBe(300);
        expect(inBook(in2)?.dateTime.slice(0, 10)).toBe(WORK_DAY);
        expect(inBook(in1)?.effectiveAmount).toBe(500);
        expect((await getDatabase().costEntries.get(in2))?.farmId).toBe(FARM);
    });

    it('a line removed: corrected to nothing — the entry stays in the trail, its amount now ₹0', async () => {
        await queueEdit([]);
        answerWith({ log: { id: LOG }, moneyChanged: [{ ...entry(in1, 500), isCorrected: true }], moneyCorrections: [correction(in1, 500, 0)], moneyNotFollowed: [] });

        await backgroundSyncWorker.triggerNow();

        expect(inBook(in1)?.effectiveAmount).toBe(0);
        expect(inBook(in1)?.adjustments).toHaveLength(1);
    });

    it('a repeated reply (the first answer was lost) writes the same money', async () => {
        await queueEdit([{ id: 'in-1', cost: 800 }]);
        answerWith({ log: { id: LOG }, moneyChanged: [{ ...entry(in1, 500), isCorrected: true }], moneyCorrections: [correction(in1, 500, 800)], moneyNotFollowed: [] }, 'duplicate');

        await backgroundSyncWorker.triggerNow();

        expect(inBook(in1)?.effectiveAmount).toBe(800);
    });

    it('money that could not follow is kept to be said plainly; a later edit whose money followed clears it', async () => {
        await queueEdit([{ id: 'in-1', cost: 800 }]);
        answerWith({ log: { id: LOG }, moneyChanged: [], moneyCorrections: [], moneyNotFollowed: [{ kind: 'input', lineId: 'in-1', reason: 'notFound' }] });
        await backgroundSyncWorker.triggerNow();

        expect(inBook(in1)?.effectiveAmount).toBe(500); // the phone changed nothing on its own
        expect(await readMoneyNotFollowed(LOG)).toEqual(['notFound']);

        await queueEdit([{ id: 'in-1', cost: 900 }]);
        answerWith({ log: { id: LOG }, moneyChanged: [], moneyCorrections: [], moneyNotFollowed: [] });
        await backgroundSyncWorker.triggerNow();
        expect(await readMoneyNotFollowed(LOG)).toEqual([]);
    });

    it('an answer without money lists (an older server) writes nothing and is said, never a silent drop', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await queueEdit([{ id: 'in-1', cost: 800 }]);
        answerWith({ id: LOG, contentVersion: 2 });

        await backgroundSyncWorker.triggerNow();

        expect(inBook(in1)?.effectiveAmount).toBe(500);
        expect(error.mock.calls.some(call => String(call[0]).includes('[editMoney]'))).toBe(true);
        error.mockRestore();
    });
});
