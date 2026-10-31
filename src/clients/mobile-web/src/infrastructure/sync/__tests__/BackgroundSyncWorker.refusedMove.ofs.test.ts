// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S) — when the server REFUSES a queued move of a saved
 * entry (or a queued worker-count change), nothing is silently dropped (P9) and the entry goes back to the SERVER'S
 * version: the refusal is parked where the farmer sees it, it no longer holds the entry from the pull, and the pull at
 * the end of the same cycle starts from the beginning (the phone's cursor had already gone past that version). A refused
 * CONTENT change is unchanged: it still holds the entry (it stays on this phone for him to decide).
 *
 * Real BackgroundSyncWorker + MutationQueue + Dexie (fake-indexeddb); only the network boundary is mocked.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-10-31T12:00:00.000Z',
        nextCursorUtc: '2026-10-31T12:00:00.000Z',
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
import { LOGS_REBUILD_MARKER_KEY } from '../../../features/sync/pull/logsRebuildMarker';
import { readPendingLogIds } from '../../../features/sync/pull/internal/pendingMutations';
import { MoveDailyLogCommand } from '../../../application/usecases/sync/MoveDailyLogCommand';
import { CorrectLabourAssignmentCommand } from '../../../application/usecases/sync/CorrectLabourAssignmentCommand';
import { ReviseLogContentCommand } from '../../../application/usecases/sync/ReviseLogContentCommand';
import { parentClientRequestIdForDailyLog } from '../MutationDependency';
import { SyncMutationName } from '../SyncMutationCatalog';
import { financeService } from '../../../features/finance/financeService';
import { financeCommandService } from '../../../features/finance/financeCommandService';
import { moneyEntryIdFor } from '../../../features/finance/moneyEntryIdentity';

type PushRequest = { mutations: Array<{ clientRequestId: string; mutationType: string }> };
const LOG = '0f5e0000-0000-4000-8000-0000000000c1';
const LOG_B = '0f5e0000-0000-4000-8000-0000000000c2';
const PLOT = '0f5e0000-0000-4000-8000-0000000000c3';

function refuseWith(errorCode: string) {
    pushBatchMock.mockImplementation(async (request: PushRequest) => ({
        serverTimeUtc: '2026-10-31T12:00:00.000Z',
        results: request.mutations.map(m => ({
            clientRequestId: m.clientRequestId, mutationType: m.mutationType, status: 'failed' as const,
            errorCode, errorMessage: 'refused',
        })),
    }));
}

async function markRebuilt() {
    await getDatabase().appMeta.put({ key: LOGS_REBUILD_MARKER_KEY, value: { rebuiltAtUtc: 'T' }, updatedAt: 'T' });
}

const lastPullCursor = (): unknown => pullChangesMock.mock.calls.at(-1)?.[0];

describe('lane OF-S — a refused move / worker count puts the entry back to the server version', () => {
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
        pushBatchMock.mockReset();
        pullChangesMock.mockClear();
        await mutationQueue.setCursor('2026-10-30T00:00:00.000Z');
        await markRebuilt();
    });

    it('a refused move is parked with its code, no longer holds the entry, and the same cycle pulls from the beginning', async () => {
        const id = await MoveDailyLogCommand.enqueue({
            dailyLogId: LOG, baseVersion: 2, newPlotIds: [PLOT], revisedAtUtc: '2026-10-31T10:00:00.000Z',
        });
        expect(await readPendingLogIds(getDatabase())).toContain(LOG); // waiting: it holds the entry
        refuseWith('ShramSafal.LogMoveAttendance.Conflict');

        await backgroundSyncWorker.triggerNow();

        const row = (await getDatabase().mutationQueue.toArray()).find(r => r.clientRequestId === id);
        expect(row?.status).toBe('REJECTED_USER_REVIEW'); // never silently dropped (P9)
        expect(row?.errorCode).toBe('ShramSafal.LogMoveAttendance.Conflict');
        expect(await readPendingLogIds(getDatabase())).not.toContain(LOG);
        expect(await getDatabase().appMeta.get(LOGS_REBUILD_MARKER_KEY)).toBeUndefined();
        expect(lastPullCursor()).toBe('0'); // the server's version comes down in this very cycle
    });

    it('a refused worker-count change does the same', async () => {
        await CorrectLabourAssignmentCommand.enqueue({
            labourAssignmentId: '0f5e0000-0000-4000-8000-0000000000c4', dailyLogId: LOG, farmId: '0f5e0000-0000-4000-8000-0000000000c5',
            quantity: { workerCount: 6 }, seen: { workerCount: 8 }, correctedAtUtc: '2026-10-31T10:00:00.000Z',
        }, 2);
        refuseWith('ShramSafal.LabourCorrection.Conflict');

        await backgroundSyncWorker.triggerNow();

        expect(await readPendingLogIds(getDatabase())).not.toContain(LOG);
        expect(lastPullCursor()).toBe('0');
    });

    it('a refused CONTENT change still holds its entry and asks for nothing (unchanged)', async () => {
        await ReviseLogContentCommand.enqueue({
            dailyLogId: LOG_B, baseVersion: 1, content: { schema: 1 } as never, revisedAtUtc: '2026-10-31T10:00:00.000Z',
        });
        refuseWith('ShramSafal.LogContent.InvalidCommand');

        await backgroundSyncWorker.triggerNow();

        expect(await readPendingLogIds(getDatabase())).toContain(LOG_B);
        expect(await getDatabase().appMeta.get(LOGS_REBUILD_MARKER_KEY)).toBeDefined();
        expect(lastPullCursor()).toBe('2026-10-30T00:00:00.000Z');
    });
});

describe('lane OF-S fix 1 (B004) — a move / worker count sent before the create of its record lands waits for it', () => {
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
        pushBatchMock.mockReset();
        // The record's create is still waiting on this phone (held: not offered this cycle).
        await getDatabase().mutationQueue.add({
            deviceId: mutationQueue.getDeviceId(), clientRequestId: parentClientRequestIdForDailyLog(LOG),
            clientCommandId: parentClientRequestIdForDailyLog(LOG), mutationType: SyncMutationName.CreateDailyLog, payload: { dailyLogId: LOG },
            status: 'PENDING', createdAt: '2026-10-31T09:00:00.000Z', updatedAt: '2026-10-31T09:00:00.000Z', retryCount: 0,
            nextRetryAfterMs: Date.now() + 3_600_000,
        } as never);
        refuseWith('ShramSafal.DailyLogNotFound');
    });

    const childRow = async (id: string) => (await getDatabase().mutationQueue.toArray()).find(r => r.clientRequestId === id);

    it('a move: uncharged, kept waiting, never parked as a refusal', async () => {
        const id = await MoveDailyLogCommand.enqueue({ dailyLogId: LOG, baseVersion: 1, newLogDate: '2026-10-24', revisedAtUtc: '2026-10-31T10:00:00.000Z' });
        await backgroundSyncWorker.triggerNow();
        const row = await childRow(id);
        expect(row?.status).toBe('FAILED');
        expect(row?.retryCount).toBe(0);
    });

    it('a worker count: the same', async () => {
        const id = await CorrectLabourAssignmentCommand.enqueue({
            labourAssignmentId: '0f5e0000-0000-4000-8000-0000000000c4', dailyLogId: LOG, farmId: '0f5e0000-0000-4000-8000-0000000000c5',
            quantity: { workerCount: 6 }, seen: { workerCount: 8 }, correctedAtUtc: '2026-10-31T10:00:00.000Z',
        }, 1);
        await backgroundSyncWorker.triggerNow();
        const row = await childRow(id);
        expect(row?.status).toBe('FAILED');
        expect(row?.retryCount).toBe(0);
    });
});

describe('lane OF-S fix pass 2 — the money follows the server\'s answer at once (N1, N3); a move waits for its money (N4)', () => {
    const FARM = '0f5e0000-0000-4000-8000-0000000000c5';
    const MONEY = moneyEntryIdFor(`${LOG}:input:in-1`); // just saved: in the money book, not pulled yet
    const OLD_KEY = moneyEntryIdFor(`${LOG}:labour:crew-line-1`); // the record's money saved the old way
    const MOVE = {
        dailyLogId: LOG, baseVersion: 2, newPlotIds: [PLOT], newLogDate: '2026-10-24',
        moneyLines: [{ kind: 'input', lineId: 'in-1' }], revisedAtUtc: '2026-10-31T10:00:00.000Z',
    } as never;
    const rowOf = async (id: string) => (await getDatabase().mutationQueue.toArray()).find(r => r.clientRequestId === id);

    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
        pushBatchMock.mockReset();
        pullChangesMock.mockClear();
        await mutationQueue.setCursor('2026-10-30T00:00:00.000Z');
        await markRebuilt();
    });

    it('save, then move at once: the money book shows the new place as soon as the move applies, without waiting for a pull', async () => {
        await financeService.refreshFromPhone();
        await getDatabase().costEntries.put({
            id: OLD_KEY, farmId: FARM, updatedAt: 'T',
            payload: { id: OLD_KEY, farmId: FARM, plotId: 'plot-old', entryDate: '2026-10-25', amount: 2800, categoryId: 'labour_misc' },
        } as never);
        const moved = {
            id: MONEY, farmId: FARM, plotId: PLOT, cropCycleId: 'cycle-new', categoryId: 'other', description: 'from the record',
            amount: 500, currencyCode: 'INR', entryDate: '2026-10-24', createdByUserId: 'me', createdAtUtc: '2026-10-31T06:00:00Z',
            modifiedAtUtc: '2026-10-31T12:00:00Z', isCorrected: false, direction: 'Expense',
        };
        pushBatchMock.mockImplementation(async (request: PushRequest) => ({
            serverTimeUtc: '2026-10-31T12:00:00.000Z',
            results: request.mutations.map(m => ({
                clientRequestId: m.clientRequestId, mutationType: m.mutationType, status: 'applied' as const,
                ...(m.mutationType === SyncMutationName.MoveDailyLog && { data: { log: { id: LOG }, moneyMoved: [moved] } }),
            })),
        }));

        // Save: the record's money, made exactly as the save makes it (in the money book at once, queued for the server).
        financeCommandService.createMoneyEventFromSource({
            type: 'VoiceLog', sourceId: `${LOG}:input:in-1`, dateTime: '2026-10-31T06:00:00Z', eventType: 'Expense',
            category: 'Input', farmId: FARM, logId: LOG, amount: 500, createdByUserId: 'me',
        });
        await vi.waitFor(async () => expect(await rowOf(`${SyncMutationName.AddCostEntry}:${MONEY}`)).toBeDefined());
        expect(financeService.peekMoneyEvents().find(e => e.id === MONEY)?.plotId).toBeUndefined();

        // Move at once.
        await MoveDailyLogCommand.enqueue(MOVE);
        await backgroundSyncWorker.triggerNow();

        expect((await getDatabase().costEntries.get(MONEY))?.payload).toMatchObject({ plotId: PLOT, entryDate: '2026-10-24', amount: 500 });
        const inBook = financeService.peekMoneyEvents().find(e => e.id === MONEY);
        expect(inBook).toMatchObject({ plotId: PLOT, amount: 500 });
        expect(inBook?.dateTime).toMatch(/^2026-10-24/);
        // Money the server did not name stays exactly as it was (the phone never moves money on its own).
        expect((await getDatabase().costEntries.get(OLD_KEY))?.payload).toMatchObject({ plotId: 'plot-old', entryDate: '2026-10-25' });
    });

    it('refused because its money has not arrived while that money is still on its way from this phone: it waits, uncharged', async () => {
        await getDatabase().mutationQueue.add({
            deviceId: mutationQueue.getDeviceId(), clientRequestId: `${SyncMutationName.AddCostEntry}:${MONEY}`,
            clientCommandId: `${SyncMutationName.AddCostEntry}:${MONEY}`, mutationType: SyncMutationName.AddCostEntry,
            payload: { costEntryId: MONEY }, status: 'FAILED', createdAt: '2026-10-31T09:00:00.000Z', updatedAt: '2026-10-31T09:00:00.000Z',
            retryCount: 1, nextRetryAfterMs: Date.now() + 3_600_000,
        } as never);
        const id = await MoveDailyLogCommand.enqueue(MOVE);
        refuseWith('ShramSafal.LogMoveMoneyNotFound.Conflict');

        await backgroundSyncWorker.triggerNow();

        const row = await rowOf(id);
        expect(row?.status).toBe('FAILED');
        expect(row?.retryCount).toBe(0);
        expect(await readPendingLogIds(getDatabase())).toContain(LOG);
    });

    it('refused because its money has not arrived and none is on its way: the refusal stands with its plain reason', async () => {
        const id = await MoveDailyLogCommand.enqueue(MOVE);
        refuseWith('ShramSafal.LogMoveMoneyNotFound.Conflict');

        await backgroundSyncWorker.triggerNow();

        const row = await rowOf(id);
        expect(row?.status).toBe('REJECTED_USER_REVIEW');
        expect(row?.errorCode).toBe('ShramSafal.LogMoveMoneyNotFound.Conflict');
        expect(await readPendingLogIds(getDatabase())).not.toContain(LOG);
    });
});
