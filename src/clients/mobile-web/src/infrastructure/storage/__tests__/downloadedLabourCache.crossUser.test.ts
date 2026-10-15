// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves
/**
 * Founder decision 2026-10-12 (round 2), cross-user half: logout / user change
 * clears the ENDING user's DOWNLOADED Labour cache from IndexedDB, keeps their
 * UNSENT work private (never visible to another user, never replayed under
 * another user), and an old handset's residue (browser proof F3) is swept at boot.
 * REAL stores: fake-indexeddb, real per-user databases, real MutationQueue.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { getDatabase, resetDatabase } from '../DexieDatabase';
import { activateDatabaseForUser } from '../activateUserDatabase';
import { setActiveDatabaseName } from '../activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from '../userDatabaseName';
import { setAuthSession, clearAuthSession } from '../AuthTokenStore';
import { settleDownloadedLabourPurges, sweepOtherLocalDatabases } from '../downloadedLabourCache';
import { DexieLogsRepository } from '../DexieLogsRepository';
import { DexieProfileRepository } from '../DexieProfileRepository';
import { mutationQueue } from '../../sync/MutationQueue';
import { SyncMutationName } from '../../sync/SyncMutationCatalog';
import { getLocalAttendanceMarks, getLocalAttendanceNameHints } from '../../../features/labour/data/attendanceLocal';
import { MarkAttendanceCommand } from '../../../application/usecases/sync/MarkAttendanceCommand';
import { reconcileLogs } from '../../../features/sync/pull/reconcilers/logsReconciler';

const A = 'user-aaaa-1111';
const B = 'user-bbbb-2222';
const FARM = '22222222-2222-2222-2222-222222222222';
const RAMESH = '33333333-3333-3333-3333-333333333333';
const DAY = 24 * 60 * 60 * 1000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const soon = (ms: number) => new Date(Date.now() + ms).toISOString();

const aLog = (id: string, stamp?: string) => ({
    id, schemaVersion: 1, date: '2026-10-10', isDeleted: 0 as const,
    ...(stamp ? { labourNamesDownloadedAtUtc: stamp } : {}),
    log: { id, date: '2026-10-10', meta: { farmId: FARM }, labour: [{
        id: `${id}-e`, type: 'HIRED', shiftId: 'full', count: 3,
        workerNames: ['Ramesh Patil'],
        attributedOperators: [{ fieldOperatorId: RAMESH, displayNameAtAttach: 'Ramesh Patil' }],
    }] },
} as never);

async function seedDownloadedCacheFor(stampAgeDays: number) {
    const db = getDatabase();
    await db.attendanceMarks.put({
        id: 'srv-mark', farmId: FARM, fieldOperatorId: RAMESH, workDate: '2026-10-10',
        payload: { id: 'srv-mark', farmId: FARM, fieldOperatorId: RAMESH, workDate: '2026-10-10', dayMark: 'Full' },
        updatedAt: ago(stampAgeDays),
    } as never);
    await db.logs.put(aLog('downloaded-log', ago(stampAgeDays)));
    await db.farmerProfile.put({ id: 'self', updatedAtMs: Date.now(), data: {
        name: 'Owner A', activeOperatorId: A,
        operators: [{ id: 'op-raju', name: 'Raju', role: 'WORKER', capabilities: [], isVerifier: false, downloadedAtUtc: ago(stampAgeDays) }],
    } });
    await db.appMeta.put({ key: 'shramsafal_last_pull_payload', value: { operators: [{ displayName: 'Raju' }] }, updatedAt: ago(stampAgeDays) });
}

/** A's unsent work: a queued attendance mark AND a log with an unresolved mutation. */
async function seedUnsentFor() {
    const db = getDatabase();
    await MarkAttendanceCommand.enqueue({
        attendanceMarkId: '11111111-1111-1111-1111-111111111111', farmId: FARM,
        fieldOperatorId: RAMESH, workDate: '2026-10-11', dayMark: 'Half',
    });
    await db.logs.put(aLog('unsent-log'));
    await db.mutationQueue.add({
        deviceId: 'd1', clientRequestId: 'req-log', clientCommandId: 'cmd-log', mutationType: 'CreateDailyLog',
        payload: { dailyLogId: 'unsent-log' }, status: 'PENDING', createdAt: ago(10), updatedAt: ago(10), retryCount: 0,
    });
}

function signIn(userId: string) {
    setAuthSession({ userId, accessToken: 'tok', expiresAtUtc: soon(15 * 60_000) });
    activateDatabaseForUser(userId);
}

describe('logout / user change: downloaded Labour cache goes, unsent work stays private (real stores)', () => {
    beforeEach(async () => {
        try { await resetDatabase(); } catch { /* none open */ }
        for (const n of await Dexie.getDatabaseNames()) await Dexie.delete(n);
        window.localStorage.clear();
        setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);
    });

    it('logout purges A\'s FRESH downloaded cache from A\'s database; A\'s queue and unsent log names survive', async () => {
        signIn(A);
        await seedDownloadedCacheFor(1); // fresh: still purged, because the session ended
        await seedUnsentFor();

        clearAuthSession();
        await settleDownloadedLabourPurges();

        // Read A's database directly (as A returns later would).
        signIn(A);
        const db = getDatabase();
        expect(await db.attendanceMarks.count()).toBe(0);
        expect(await db.appMeta.get('shramsafal_last_pull_payload')).toBeUndefined();
        const ops = ((await db.farmerProfile.get('self'))!.data as { operators: unknown[] }).operators;
        expect(ops).toHaveLength(0);
        const dl = (await db.logs.get('downloaded-log'))!.log.labour![0];
        expect(dl.attributedOperators).toBeUndefined();
        expect(dl.workerNames).toBeUndefined();
        expect(dl.count).toBe(3); // the record itself stays

        // UNSENT work: intact.
        expect(await db.mutationQueue.count()).toBe(2);
        const marks = await getLocalAttendanceMarks(FARM);
        expect(marks.map((m) => [m.source, m.dayMark])).toEqual([['queue', 'Half']]);
        const unsent = (await db.logs.get('unsent-log'))!.log.labour![0];
        expect(unsent.attributedOperators).toHaveLength(1);
    });

    it('B on the same handset sees none of A\'s downloaded or unsent data, and cannot replay A\'s queue', async () => {
        signIn(A);
        const aName = getDatabase().name;
        await seedDownloadedCacheFor(1);
        await seedUnsentFor();
        clearAuthSession();
        await settleDownloadedLabourPurges();

        signIn(B);
        expect(getDatabase().name).not.toBe(aName);
        // visibility
        expect(await getLocalAttendanceMarks(FARM)).toEqual([]);
        expect((await getLocalAttendanceNameHints(FARM, [{ fieldOperatorId: RAMESH, workDate: '2026-10-10' }])).size).toBe(0);
        expect(await DexieLogsRepository.getInstance().getAll({ includeDeleted: true })).toEqual([]);
        expect(await getDatabase().attendanceMarks.count()).toBe(0);
        expect(await getDatabase().appMeta.get('shramsafal_last_pull_payload')).toBeUndefined();
        // replay: the only queue the sync worker can drain is the ACTIVE user's, and it is empty.
        expect(await mutationQueue.getPending()).toEqual([]);
        expect(await getDatabase().mutationQueue.count()).toBe(0);

        // A returns: the unsent queue is still there and still pending, under A.
        clearAuthSession();
        signIn(A);
        expect((await mutationQueue.getPending()).map((r) => r.mutationType).sort()).toEqual(['CreateDailyLog', SyncMutationName.AttendanceMark].sort());
    });

    it('a session that ends while routing has already moved on still purges the right database', async () => {
        signIn(A);
        await seedDownloadedCacheFor(1);
        const aName = getDatabase().name;
        clearAuthSession();
        clearAuthSession(); // second end (e.g. 401 after logout): must not purge or throw anywhere harmful
        await settleDownloadedLabourPurges();
        signIn(A);
        expect(getDatabase().name).toBe(aName);
        expect(await getDatabase().attendanceMarks.count()).toBe(0);
    });

    it('boot sweep removes residue another user left in OTHER local databases: aged copies and the unidentified boundary; unsent stays', async () => {
        // Residue as the browser proof found it: A's data in A's database (8 days old,
        // never logged out cleanly) and in the unidentified boundary database (fresh).
        signIn(A);
        await seedDownloadedCacheFor(8);
        await seedUnsentFor();
        setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);
        await seedDownloadedCacheFor(1);
        const unidentifiedUnsent = getDatabase();
        await unidentifiedUnsent.mutationQueue.add({
            deviceId: 'd1', clientRequestId: 'req-u', clientCommandId: 'cmd-u', mutationType: 'CreateDailyLog',
            payload: { dailyLogId: 'x' }, status: 'PENDING', createdAt: ago(1), updatedAt: ago(1), retryCount: 0,
        });

        // B signs in; boot sweep runs for everything that is not B's.
        signIn(B);
        await sweepOtherLocalDatabases(getDatabase().name);

        signIn(A);
        expect(await getDatabase().attendanceMarks.count()).toBe(0);
        expect(await getDatabase().appMeta.get('shramsafal_last_pull_payload')).toBeUndefined();
        expect(await getDatabase().mutationQueue.count()).toBe(2); // A's unsent: untouched

        setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);
        expect(await getDatabase().attendanceMarks.count()).toBe(0);
        expect(await getDatabase().mutationQueue.count()).toBe(1);
    });
});

describe('pull stamps what it downloads (so the cap has a clock)', () => {
    beforeEach(async () => {
        try { await resetDatabase(); } catch { /* none open */ }
        setActiveDatabaseName('AgriLogDB_test_stamp');
        await getDatabase().logs.clear();
    });

    it('reconcileLogs stamps labourNamesDownloadedAtUtc, a local edit keeps it, and a re-confirmed log is re-stamped', async () => {
        const dto = {
            id: 'L1', farmId: FARM, plotIds: [], date: '2026-10-10', modifiedAtUtc: '2026-10-10T10:00:00Z',
            labour: [], tasks: [], verificationEvents: [], cropCycleId: null,
        } as never;
        const payload = { dailyLogs: [dto], attachments: [], plots: [], cropCycles: [], farms: [] } as never;
        const first = '2026-10-10T12:00:00.000Z';
        await reconcileLogs(getDatabase(), payload, new Map(), new Set(), first);
        expect((await getDatabase().logs.get('L1'))!.labourNamesDownloadedAtUtc).toBe(first);

        // Same server version arrives again: nothing newer to adopt, stamp still refreshed.
        const second = '2026-10-12T12:00:00.000Z';
        await reconcileLogs(getDatabase(), payload, new Map(), new Set(), second);
        expect((await getDatabase().logs.get('L1'))!.labourNamesDownloadedAtUtc).toBe(second);

        // A local edit through the repository keeps the names' age.
        const rec = (await getDatabase().logs.get('L1'))!;
        await DexieLogsRepository.getInstance().save({ ...rec.log, notes: 'edited' } as never);
        expect((await getDatabase().logs.get('L1'))!.labourNamesDownloadedAtUtc).toBe(second);
    });

    it('the profile repository stamps nothing itself: a legacy operator with no stamp is hidden', async () => {
        await getDatabase().farmerProfile.put({ id: 'self', updatedAtMs: 1, data: {
            name: 'O', operators: [{ id: 'legacy-1', name: 'Santosh', role: 'WORKER', capabilities: [], isVerifier: false }],
        } });
        expect((await new DexieProfileRepository().get()).operators).toEqual([]);
    });
});
