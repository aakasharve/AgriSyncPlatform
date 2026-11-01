/**
 * spec: plr-d10 lane PRV (founder D-26; orchestrator call 9) — a record whose audience no longer includes this person
 * leaves his phone on the next sync, with everything that hangs from it; nothing he still owes the server is touched
 * (P10); a full pull is the whole list. A real Dexie (fake-indexeddb) at the SHIPPED version — no version bump.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DATABASE_VERSION, getDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { FarmAccessScopeDto } from '../../../../../infrastructure/api/dtos';
import type { DailyLog } from '../../../../../types';
import { PENDING_WITHDRAWALS_META_KEY, reconcileWithdrawnRecords } from '../withdrawnRecordsReconciler';
import { dayLedgerMetaKey } from '../../helpers/dayLedgerMetaKey';

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const AT = '2026-11-01T06:00:00.000Z';
const COST_MIRROR = 'shramsafal_finance_cost_entries_v1';
const CORRECTION_MIRROR = 'shramsafal_finance_corrections_v1';

const scope = (over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({
    farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true,
    seeCompliance: true, seeFarmOverview: true, ...over,
});

function log(id: string, maker: string): DailyLog {
    return {
        id, date: '2026-10-30', context: { selection: [] }, dayOutcome: null, cropActivities: [], irrigation: [],
        labour: [{ id: `${id}-crew`, type: 'HIRED', count: 8, wagePerPerson: 432, totalCost: 3456 }],
        inputs: [], machinery: [], activityExpenses: [],
        fullTranscript: 'गुप्त-सूत्र',
        meta: { createdAtISO: AT, createdByOperatorId: maker, farmId: FARM },
    } as unknown as DailyLog;
}

async function putLog(db: AgriLogDatabase, id: string, maker: string, fromServer = true) {
    await db.logs.put({
        id, schemaVersion: 2, log: log(id, maker), date: '2026-10-30', createdByOperatorId: maker, isDeleted: 0,
        ...(fromServer ? { serverModifiedAtUtc: AT } : {}),
    });
}

async function putPhoto(db: AgriLogDatabase, id: string, parent: string, parentType: string, uploaded = true) {
    await db.attachments.put({
        id, farmId: FARM, linkedEntityId: parent, linkedEntityType: parentType, localPath: '', originalFileName: 'p.jpg',
        mimeType: 'image/jpeg', sizeBytes: 1, status: uploaded ? 'uploaded' : 'pending', remoteAttachmentId: uploaded ? id : undefined,
        createdAt: AT, updatedAt: AT, retryCount: 0,
    } as never);
}

async function putMoney(db: AgriLogDatabase, id: string, maker: string, bills: string[] = []) {
    await db.costEntries.put({ id, farmId: FARM, payload: { id, farmId: FARM, amount: 7777.31, createdByUserId: maker, clientAttachmentIds: bills } as never, updatedAt: AT });
    await db.financeCorrections.put({ id: `fc-${id}`, costEntryId: id, payload: {} as never, updatedAt: AT });
    await db.dayLedgers.put({ id: `ledger-${id}`, farmId: FARM, dateKey: '2026-10-30', payload: { sourceCostEntryId: id } as never, updatedAt: AT });
    await db.appMeta.put({ key: dayLedgerMetaKey(`ledger-${id}`), value: { sourceCostEntryId: id }, updatedAt: AT });
}

const pull = (over: Partial<SyncPullResponse> = {}) => ({
    dailyLogs: [], costEntries: [], accessScopes: [scope()], ...over,
}) as unknown as SyncPullResponse;

const run = (db: AgriLogDatabase, payload: SyncPullResponse, opts: { pending?: Set<string>; fullPull?: boolean; userId?: string | null } = {}) =>
    reconcileWithdrawnRecords(db, payload, {
        userId: opts.userId === undefined ? ME : opts.userId,
        pendingLogIds: opts.pending ?? new Set(),
        pendingMoneyIds: new Set(),
        receivedAtUtc: AT,
        fullPull: opts.fullPull ?? false,
    });

let db: AgriLogDatabase;

beforeEach(async () => {
    db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
    await putLog(db, 'private-log', OWNER);
    await putPhoto(db, 'private-photo', 'private-log', 'DailyLog');
    await putMoney(db, 'private-money', OWNER, ['bill-photo']);
    await putPhoto(db, 'receipt', 'private-money', 'CostEntry');
    await putPhoto(db, 'bill-photo', FARM, 'Bill');
    await putLog(db, 'team-log', OWNER);
    await putMoney(db, 'team-money', OWNER);
    await db.appMeta.put({ key: COST_MIRROR, value: [{ id: 'private-money' }, { id: 'team-money' }], updatedAt: AT });
    await db.appMeta.put({ key: CORRECTION_MIRROR, value: [{ costEntryId: 'private-money' }, { costEntryId: 'team-money' }], updatedAt: AT });
});

describe('withdrawnRecordsReconciler (lane PRV)', () => {
    it('removes a withdrawn work record and its photos, and a withdrawn money record with its corrections, day ledger, receipt, bill and mirrors', async () => {
        const outcome = await run(db, pull({
            withdrawnRecords: [{ kind: 'DailyLog', id: 'private-log' }, { kind: 'CostEntry', id: 'private-money' }],
        }));

        expect(outcome).toMatchObject({ removedLogs: 1, removedMoney: 1, heldBack: 0 });
        expect(await db.logs.get('private-log')).toBeUndefined();
        expect(await db.attachments.get('private-photo')).toBeUndefined();
        expect(await db.costEntries.get('private-money')).toBeUndefined();
        expect(await db.financeCorrections.get('fc-private-money')).toBeUndefined();
        expect(await db.dayLedgers.get('ledger-private-money')).toBeUndefined();
        expect(await db.appMeta.get(dayLedgerMetaKey('ledger-private-money'))).toBeUndefined();
        expect(await db.attachments.get('receipt')).toBeUndefined();
        expect(await db.attachments.get('bill-photo')).toBeUndefined();
        expect((await db.appMeta.get(COST_MIRROR))?.value).toEqual([{ id: 'team-money' }]);
        expect((await db.appMeta.get(CORRECTION_MIRROR))?.value).toEqual([{ costEntryId: 'team-money' }]);
        // Everything else stays.
        expect(await db.logs.get('team-log')).toBeDefined();
        expect(await db.costEntries.get('team-money')).toBeDefined();
        expect(await db.financeCorrections.get('fc-team-money')).toBeDefined();
        expect(DATABASE_VERSION).toBeGreaterThan(0);
    });

    it('never takes a record he still owes the server: it is held and let go on a later sync, unless the server sent it again', async () => {
        const first = await run(db, pull({ withdrawnRecords: [{ kind: 'DailyLog', id: 'private-log' }] }), { pending: new Set(['private-log']) });
        expect(first).toMatchObject({ removedLogs: 0, heldBack: 1 });
        expect(await db.logs.get('private-log')).toBeDefined();
        expect((await db.appMeta.get(PENDING_WITHDRAWALS_META_KEY))?.value).toEqual([{ kind: 'DailyLog', id: 'private-log' }]);

        // The next sync names nothing new — the remembered withdrawal is applied once nothing holds the record.
        const later = await run(db, pull());
        expect(later.removedLogs).toBe(1);
        expect(await db.logs.get('private-log')).toBeUndefined();
        expect((await db.appMeta.get(PENDING_WITHDRAWALS_META_KEY))?.value).toEqual([]);
    });

    it('lets a remembered withdrawal go when the record comes back (he regained it)', async () => {
        await run(db, pull({ withdrawnRecords: [{ kind: 'DailyLog', id: 'private-log' }] }), { pending: new Set(['private-log']) });
        await run(db, pull({ dailyLogs: [{ id: 'private-log' }] as never }));
        expect(await db.logs.get('private-log')).toBeDefined();
        expect((await db.appMeta.get(PENDING_WITHDRAWALS_META_KEY))?.value).toEqual([]);
    });

    it('never removes his own record, a photo still uploading, or anything when it does not know who is signed in', async () => {
        await putLog(db, 'my-log', ME);
        await putLog(db, 'uploading-log', OWNER);
        await putPhoto(db, 'uploading-photo', 'uploading-log', 'DailyLog', false);
        const outcome = await run(db, pull({ withdrawnRecords: [{ kind: 'DailyLog', id: 'my-log' }, { kind: 'DailyLog', id: 'uploading-log' }] }));
        // Fix pass 1 (M6): his own record is never remembered (the maker always stays: nothing to do later).
        expect(outcome.heldBack).toBe(1);
        expect((await db.appMeta.get(PENDING_WITHDRAWALS_META_KEY))?.value).toEqual([{ kind: 'DailyLog', id: 'uploading-log' }]);
        expect(await db.logs.get('my-log')).toBeDefined();
        expect(await db.logs.get('uploading-log')).toBeDefined();

        await run(db, pull({ withdrawnRecords: [{ kind: 'DailyLog', id: 'team-log' }] }), { userId: null });
        expect(await db.logs.get('team-log')).toBeDefined();
    });

    it('a full pull is the whole list: a server copy it no longer carries goes; his own, a phone-only record and an older server keep theirs', async () => {
        await putLog(db, 'my-log', ME);
        await putLog(db, 'phone-only', 'owner', false);
        const full = pull({ dailyLogs: [{ id: 'team-log' }] as never, costEntries: [{ id: 'team-money' }] as never });

        const outcome = await run(db, full, { fullPull: true });
        expect(outcome).toMatchObject({ removedLogs: 1, removedMoney: 1 });
        expect(await db.logs.get('private-log')).toBeUndefined();
        expect(await db.costEntries.get('private-money')).toBeUndefined();
        expect(await db.logs.get('team-log')).toBeDefined();
        expect(await db.logs.get('my-log')).toBeDefined();
        expect(await db.logs.get('phone-only')).toBeDefined();

        await putLog(db, 'private-log', OWNER);
        await run(db, { dailyLogs: [], costEntries: [] } as unknown as SyncPullResponse, { fullPull: true });
        expect(await db.logs.get('private-log')).toBeDefined();
    });

    it('a cursor pull never sweeps: only what the server names leaves', async () => {
        await run(db, pull({ dailyLogs: [] }));
        expect(await db.logs.get('private-log')).toBeDefined();
        expect(await db.costEntries.get('private-money')).toBeDefined();
    });
});
