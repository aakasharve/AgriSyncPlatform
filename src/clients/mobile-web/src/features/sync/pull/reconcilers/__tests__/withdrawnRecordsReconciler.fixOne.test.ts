// @vitest-environment jsdom
/**
 * spec: plr-d10 lane PRV fix pass 1 (M6) — the phone never loses or silently holds a withdrawal:
 *   1. what a pull names is remembered BEFORE anything can stop the pass (an unreadable outbox, an unknown person);
 *   2. a money record with a money change of his still queued stays (P10), as a work record always did;
 *   3. a change refused by the rule (`RecordAudience.Forbidden`) parks with the rule's words and only "discard"; while it
 *      is parked its record stays; the moment he discards it, the withdrawal it held applies.
 * A real Dexie (fake-indexeddb) at the SHIPPED version — no version bump.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));
const session = vi.hoisted(() => ({ userId: '11111111-1111-4111-8111-111111111111' as string | null }));
vi.mock('../../../../../infrastructure/storage/AuthTokenStore', async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAuthSession: () => (session.userId ? { userId: session.userId } : null),
}));

import { getDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import { mutationQueue } from '../../../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { PENDING_WITHDRAWALS_META_KEY, reconcileWithdrawnRecords } from '../withdrawnRecordsReconciler';
import { readWithdrawalHolds } from '../../internal/pendingMutations';
import { ConflictResolutionService } from '../../../conflict/ConflictResolutionService';

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const AT = '2026-11-01T06:00:00.000Z';

const putLog = (db: AgriLogDatabase, id: string) => db.logs.put({
    id, schemaVersion: 2, date: '2026-10-30', createdByOperatorId: OWNER, isDeleted: 0, serverModifiedAtUtc: AT,
    log: { id, date: '2026-10-30', labour: [], inputs: [], machinery: [], activityExpenses: [], meta: { createdAtISO: AT, createdByOperatorId: OWNER, farmId: FARM } },
} as never);
const putMoney = (db: AgriLogDatabase, id: string) =>
    db.costEntries.put({ id, farmId: FARM, payload: { id, farmId: FARM, amount: 7777.31, createdByUserId: OWNER } as never, updatedAt: AT });
const queue = (clientRequestId: string, mutationType: string, payload: Record<string, unknown>, status: string, errorCode?: string) =>
    getDatabase().mutationQueue.add({
        deviceId: mutationQueue.getDeviceId(), clientRequestId, clientCommandId: clientRequestId, mutationType, payload,
        status, createdAt: AT, updatedAt: AT, retryCount: 1, lastError: 'refused', errorCode,
    } as never);
const pull = (over: Partial<SyncPullResponse> = {}) => ({ dailyLogs: [], costEntries: [], ...over }) as unknown as SyncPullResponse;
const pendingNames = async (db: AgriLogDatabase) => (await db.appMeta.get(PENDING_WITHDRAWALS_META_KEY))?.value;
const ctx = async (db: AgriLogDatabase, userId: string | null = ME) => {
    const holds = await readWithdrawalHolds(db);
    return { userId, pendingLogIds: holds?.logIds, pendingMoneyIds: holds?.moneyIds, receivedAtUtc: AT, fullPull: false };
};

let db: AgriLogDatabase;
beforeEach(async () => {
    db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
    session.userId = ME;
    await putLog(db, 'private-log');
    await putMoney(db, 'private-money');
});

describe('M6 — a withdrawal is never lost and never silently held', () => {
    it('remembers what the pull named when the outbox cannot be read or the person is unknown, and applies it on the next good sync', async () => {
        const named = pull({ withdrawnRecords: [{ kind: 'DailyLog', id: 'private-log' }] });
        const unreadable = { userId: ME, pendingLogIds: undefined, pendingMoneyIds: undefined, receivedAtUtc: AT, fullPull: false };
        expect(await db.transaction('rw', db.tables, () => reconcileWithdrawnRecords(db, named, unreadable))).toMatchObject({ heldBack: 1 });
        expect(await db.logs.get('private-log')).toBeDefined();
        expect(await pendingNames(db)).toEqual([{ kind: 'DailyLog', id: 'private-log' }]);

        const moneyNamed = pull({ withdrawnRecords: [{ kind: 'CostEntry', id: 'private-money' }] });
        await db.transaction('rw', db.tables, async () => reconcileWithdrawnRecords(db, moneyNamed, await ctx(db, null)));
        expect(await pendingNames(db)).toEqual([{ kind: 'DailyLog', id: 'private-log' }, { kind: 'CostEntry', id: 'private-money' }]);

        // The next good sync names nothing — the remembered names are applied.
        const later = await db.transaction('rw', db.tables, async () => reconcileWithdrawnRecords(db, pull(), await ctx(db)));
        expect(later).toMatchObject({ removedLogs: 1, removedMoney: 1, heldBack: 0 });
        expect(await db.logs.get('private-log')).toBeUndefined();
        expect(await db.costEntries.get('private-money')).toBeUndefined();
    });

    it('a money record with a money change of his still queued stays until the change is sent', async () => {
        await queue('cc-1', SyncMutationName.CorrectCostEntry, { costEntryId: 'private-money', amount: 10 }, 'PENDING');
        const named = pull({ withdrawnRecords: [{ kind: 'CostEntry', id: 'private-money' }] });
        expect(await db.transaction('rw', db.tables, async () => reconcileWithdrawnRecords(db, named, await ctx(db))))
            .toMatchObject({ removedMoney: 0, heldBack: 1 });
        expect(await db.costEntries.get('private-money')).toBeDefined();

        await db.mutationQueue.where('[deviceId+clientRequestId]').equals([mutationQueue.getDeviceId(), 'cc-1']).modify({ status: 'APPLIED' });
        await db.transaction('rw', db.tables, async () => reconcileWithdrawnRecords(db, pull(), await ctx(db)));
        expect(await db.costEntries.get('private-money')).toBeUndefined();
    });

    it('a change refused by the rule shows only its words and "discard"; the record stays while parked and goes when he discards it', async () => {
        await queue('rev-1', SyncMutationName.CorrectLabourAssignment, { dailyLogId: 'private-log', workerCount: 9 },
            'REJECTED_USER_REVIEW', 'ShramSafal.RecordAudience.Forbidden');

        const [row] = await ConflictResolutionService.list('mr');
        expect(row.closedByRule).toBe(true);
        expect(row.hint).toBe('श्रमसफलच्या नियमानुसार हा बदल या नोंदीवर लागू झाला नाही. तुमचा बदल या फोनवर ठेवला आहे.');

        // Parked (even a worker-count refusal, whose refusal usually puts the server's version back): the record stays.
        const named = pull({ withdrawnRecords: [{ kind: 'DailyLog', id: 'private-log' }] });
        expect(await db.transaction('rw', db.tables, async () => reconcileWithdrawnRecords(db, named, await ctx(db))))
            .toMatchObject({ removedLogs: 0, heldBack: 1 });
        expect(await db.logs.get('private-log')).toBeDefined();

        await ConflictResolutionService.discard('rev-1');
        expect(await db.logs.get('private-log')).toBeUndefined();
        expect(await pendingNames(db)).toEqual([]);
    });
});
