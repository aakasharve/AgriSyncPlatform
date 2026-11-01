// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV fix pass 2 — the phone shows the holder's choice of who sees a record at once. When the server
 * REFUSES that choice (`set_record_audience`), the refusal is parked where he sees it (never silently dropped, P9) and the
 * pull at the end of the same cycle starts from the beginning, so the record's audience goes back to what the server
 * holds: the lock chip never shows a choice the server refused.
 *
 * Real BackgroundSyncWorker + MutationQueue + Dexie (fake-indexeddb); only the network boundary is mocked (the same
 * harness as BackgroundSyncWorker.refusedMove.ofs.test.ts).
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
import { LOGS_REBUILD_MARKER_KEY } from '../../../features/sync/pull/logsRebuildMarker';
import { SetRecordAudienceCommand } from '../../../application/usecases/sync/SetRecordAudienceCommand';
import { ReviseLogContentCommand } from '../../../application/usecases/sync/ReviseLogContentCommand';
import { chooseAudience } from '../../../features/recordAudience/recordAudienceLocal';

type PushRequest = { mutations: Array<{ clientRequestId: string; mutationType: string }> };
const LOG = '0f5e0000-0000-4000-8000-0000000000d1';

const refuseWith = (errorCode: string) => pushBatchMock.mockImplementation(async (request: PushRequest) => ({
    serverTimeUtc: '2026-11-01T12:00:00.000Z',
    results: request.mutations.map(m => ({
        clientRequestId: m.clientRequestId, mutationType: m.mutationType, status: 'failed' as const, errorCode, errorMessage: 'refused',
    })),
}));

describe('lane PRV fix pass 2 — a refused audience choice puts the record back as the server has it', () => {
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
        pushBatchMock.mockReset();
        pullChangesMock.mockClear();
        await mutationQueue.setCursor('2026-10-31T00:00:00.000Z');
        await getDatabase().appMeta.put({ key: LOGS_REBUILD_MARKER_KEY, value: { rebuiltAtUtc: 'T' }, updatedAt: 'T' });
    });

    it('parks the refusal with its code and pulls from the beginning in the same cycle', async () => {
        const id = await SetRecordAudienceCommand.enqueue({
            recordKind: 'DailyLog', recordId: LOG, audience: 'OnlyMe', selectedUserIds: [], changedAtUtc: '2026-11-01T10:00:00.000Z',
        });
        refuseWith('ShramSafal.RecordAudienceHolder.Forbidden');

        await backgroundSyncWorker.triggerNow();

        const row = (await getDatabase().mutationQueue.toArray()).find(r => r.clientRequestId === id);
        expect(row?.status).toBe('REJECTED_USER_REVIEW');
        expect(row?.errorCode).toBe('ShramSafal.RecordAudienceHolder.Forbidden');
        expect(await getDatabase().appMeta.get(LOGS_REBUILD_MARKER_KEY)).toBeUndefined();
        expect(pullChangesMock.mock.calls.at(-1)?.[0]).toBe('0');
    });

    // Fix pass 3 (item 6) — the full pull never re-merges a record with another change of his still queued, so the
    // refused choice is put back on the phone itself, at once: the lock chip never keeps a choice the server refused.
    it('puts the record back as it was even while another change of his to it is still queued', async () => {
        await getDatabase().logs.put({
            id: LOG, schemaVersion: 2, date: '2026-10-30', isDeleted: 0, serverModifiedAtUtc: '2026-10-31T00:00:00.000Z',
            log: { id: LOG, date: '2026-10-30', labour: [], inputs: [], machinery: [], activityExpenses: [], meta: {}, audience: 'Selected', audienceUserIds: ['u-1'] },
        } as never);
        await chooseAudience('DailyLog', [LOG], { audience: 'OnlyMe', people: [] });
        expect(((await getDatabase().logs.get(LOG))?.log as { audience?: string }).audience).toBe('OnlyMe'); // shown at once
        await ReviseLogContentCommand.enqueue({
            dailyLogId: LOG, baseVersion: 1, content: { schema: 1 } as never, revisedAtUtc: '2026-11-01T10:00:00.000Z',
        });
        refuseWith('ShramSafal.RecordAudienceMember.Forbidden');

        await backgroundSyncWorker.triggerNow();

        const log = (await getDatabase().logs.get(LOG))?.log as { audience?: string; audienceUserIds?: string[] };
        expect(log.audience).toBe('Selected');
        expect(log.audienceUserIds).toEqual(['u-1']);
    });
});
