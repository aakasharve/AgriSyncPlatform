// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves
/**
 * Founder decision 2026-10-12 (round 2): the 7-day Labour cache limit holds in
 * EVERY store that can feed a screen with worker names or attendance.
 *
 * REAL stores (fake-indexeddb + jsdom localStorage), no mocks of the code under
 * test. For each store: aged 6 days is kept, aged 8 days is gone (sweep AND
 * on-read), unstamped legacy copies are dropped, and UNSENT work (queued marks,
 * logs with an unresolved mutation) is never touched by an age sweep.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase, resetDatabase } from '../DexieDatabase';
import { setActiveDatabaseName } from '../activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from '../userDatabaseName';
import { writeActiveUserId } from '../activeUserId';
import { DexieLogsRepository } from '../DexieLogsRepository';
import { DexieProfileRepository } from '../DexieProfileRepository';
import { MarkAttendanceCommand } from '../../../application/usecases/sync/MarkAttendanceCommand';
import { getLocalAttendanceMarks, getLocalAttendanceNameHints } from '../../../features/labour/data/attendanceLocal';
import {
    sweepExpiredDownloadedLabour,
    isDownloadFresh,
    DOWNLOADED_LABOUR_MAX_AGE_MS,
} from '../downloadedLabourCache';
import { LABOUR_READOUT_MAX_AGE_MS } from '../LabourReadoutCache';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const FARM = '22222222-2222-2222-2222-222222222222';
const RAMESH = '33333333-3333-3333-3333-333333333333';
const SUNITA = '44444444-4444-4444-4444-444444444444';
const ME = 'me-user-id';

function logRecord(id: string, date: string, stamp: string | undefined, names = true) {
    return {
        id, schemaVersion: 1, date, isDeleted: 0 as const,
        ...(stamp ? { labourNamesDownloadedAtUtc: stamp } : {}),
        log: {
            id, date, meta: { farmId: FARM },
            labour: [{
                id: `${id}-ev`, type: 'HIRED', shiftId: 'full', count: 2,
                ...(names ? {
                    workerNames: ['Ramesh Patil'],
                    attributedOperators: [{ fieldOperatorId: RAMESH, displayNameAtAttach: 'Ramesh Patil' }],
                } : {}),
            }],
        },
    } as never;
}

function mark(id: string, op: string, updatedAt: string | undefined) {
    return {
        id, farmId: FARM, fieldOperatorId: op, workDate: '2026-10-01',
        payload: { id, farmId: FARM, fieldOperatorId: op, workDate: '2026-10-01', dayMark: 'Full' },
        updatedAt,
    } as never;
}

describe('7-day cap across every store that feeds Labour screens (real stores)', () => {
    beforeEach(async () => {
        try { await resetDatabase(); } catch { /* none open yet */ }
        window.localStorage.clear();
        setActiveDatabaseName('AgriLogDB_test_downloaded_labour');
        const db = getDatabase();
        await Promise.all([db.attendanceMarks.clear(), db.logs.clear(), db.farmerProfile.clear(),
            db.appMeta.clear(), db.mutationQueue.clear(), db.outbox.clear()]);
        writeActiveUserId(ME);
    });

    it('the cap is the same 7 days as the read-out and roster caches', () => {
        expect(DOWNLOADED_LABOUR_MAX_AGE_MS).toBe(LABOUR_READOUT_MAX_AGE_MS);
        expect(DOWNLOADED_LABOUR_MAX_AGE_MS).toBe(7 * DAY);
        expect(isDownloadFresh(ago(6))).toBe(true);
        expect(isDownloadFresh(ago(8))).toBe(false);
        expect(isDownloadFresh(undefined)).toBe(false);
        expect(isDownloadFresh('not a date')).toBe(false);
        expect(isDownloadFresh(new Date(Date.now() + 3 * DAY).toISOString())).toBe(false);
    });

    describe('Dexie attendanceMarks (server-acknowledged marks)', () => {
        it('on read: 8-day-old and unstamped rows do not reach the screen, 6-day-old does', async () => {
            const db = getDatabase();
            await db.attendanceMarks.bulkPut([
                mark('m6', RAMESH, ago(6)), mark('m8', SUNITA, ago(8)), mark('mNone', 'x', undefined),
            ]);
            const got = await getLocalAttendanceMarks(FARM);
            expect(got.map((m) => m.fieldOperatorId)).toEqual([RAMESH]);
        });

        it('sweep: deletes the 8-day-old and unstamped rows, keeps the 6-day-old', async () => {
            const db = getDatabase();
            await db.attendanceMarks.bulkPut([
                mark('m6', RAMESH, ago(6)), mark('m8', SUNITA, ago(8)), mark('mNone', 'x', undefined),
            ]);
            await sweepExpiredDownloadedLabour(db);
            expect((await db.attendanceMarks.toArray()).map((r) => r.id)).toEqual(['m6']);
        });
    });

    describe('Dexie logs (labour names inside downloaded logs)', () => {
        it('sweep: names stamped 8 days ago are removed, 6 days ago kept; the log itself and its counts stay', async () => {
            const db = getDatabase();
            await db.logs.bulkPut([
                logRecord('l6', '2026-10-06', ago(6)),
                logRecord('l8', '2026-10-04', ago(8)),
            ]);
            await sweepExpiredDownloadedLabour(db);
            const l6 = (await db.logs.get('l6'))!.log.labour![0];
            const l8 = (await db.logs.get('l8'))!.log.labour![0];
            expect(l6.attributedOperators).toHaveLength(1);
            expect(l6.workerNames).toEqual(['Ramesh Patil']);
            expect(l8.attributedOperators).toBeUndefined();
            expect(l8.workerNames).toBeUndefined();
            expect(l8.count).toBe(2); // the record itself is not a cache: untouched
            expect(await db.logs.count()).toBe(2);
        });

        it('sweep: an UNSTAMPED legacy log is dropped of names, unless it has an unsent mutation', async () => {
            const db = getDatabase();
            await db.logs.bulkPut([logRecord('legacy', '2026-10-05', undefined), logRecord('unsent', '2026-10-05', undefined)]);
            await db.mutationQueue.add({
                deviceId: 'd', clientRequestId: 'r1', clientCommandId: 'c1', mutationType: 'CreateDailyLog',
                payload: { dailyLogId: 'unsent' }, status: 'PENDING', createdAt: ago(9), updatedAt: ago(9), retryCount: 0,
            });
            await sweepExpiredDownloadedLabour(db);
            expect((await db.logs.get('legacy'))!.log.labour![0].attributedOperators).toBeUndefined();
            expect((await db.logs.get('unsent'))!.log.labour![0].attributedOperators).toHaveLength(1);
            expect(await db.mutationQueue.count()).toBe(1);
        });

        it('on read (no sweep yet): repository hides 8-day-old names, shows 6-day-old, and name hints follow', async () => {
            const db = getDatabase();
            await db.logs.bulkPut([
                logRecord('l6', '2026-10-06', ago(6)),
                logRecord('l8', '2026-10-04', ago(8)),
            ]);
            const all = await DexieLogsRepository.getInstance().getAll();
            const byId = new Map(all.map((l) => [l.id, l]));
            expect(byId.get('l6')!.labour![0].attributedOperators).toHaveLength(1);
            expect(byId.get('l8')!.labour![0].attributedOperators).toBeUndefined();
            expect(byId.get('l8')!.labour![0].workerNames).toBeUndefined();

            const hints6 = await getLocalAttendanceNameHints(FARM, [{ fieldOperatorId: RAMESH, workDate: '2026-10-06' }]);
            const hints8 = await getLocalAttendanceNameHints(FARM, [{ fieldOperatorId: RAMESH, workDate: '2026-10-04' }]);
            expect(hints6.get(RAMESH)).toBe('Ramesh Patil');
            expect(hints8.size).toBe(0);
        });
    });

    describe('Dexie farmerProfile (team operators pulled from the server)', () => {
        const op = (id: string, name: string, extra: object = {}) => ({
            id, name, role: 'WORKER', capabilities: [], isVerifier: false, isActive: true, ...extra,
        });
        async function putProfile(operators: unknown[]) {
            await getDatabase().farmerProfile.put({ id: 'self', updatedAtMs: Date.now(), data: { name: 'Owner', operators, activeOperatorId: ME } });
        }

        it('on read and by sweep: 8-day-old / unstamped operators go, 6-day-old and local-only stay, own entry stays', async () => {
            await putProfile([
                op('fresh', 'Raju', { downloadedAtUtc: ago(6) }),
                op('old', 'Shankar', { downloadedAtUtc: ago(8) }),
                op('legacy', 'Santosh'),
                op('local', 'Added Here', { localOnly: true }),
                op(ME, 'Me', { downloadedAtUtc: ago(30) }),
            ]);
            const read = await new DexieProfileRepository().get();
            expect(read.operators.map((o) => o.id).sort()).toEqual([ME, 'fresh', 'local'].sort());

            await sweepExpiredDownloadedLabour(getDatabase());
            const row = await getDatabase().farmerProfile.get('self');
            const ids = ((row!.data as { operators: { id: string }[] }).operators).map((o) => o.id).sort();
            expect(ids).toEqual([ME, 'fresh', 'local'].sort());
        });
    });

    describe('Dexie appMeta last-pull snapshot (whole /sync/pull payload, includes names)', () => {
        it('sweep: an 8-day-old snapshot is deleted, a 6-day-old one kept', async () => {
            const db = getDatabase();
            await db.appMeta.put({ key: 'shramsafal_last_pull_payload', value: { operators: [{ displayName: 'Raju' }] }, updatedAt: ago(8) });
            await sweepExpiredDownloadedLabour(db);
            expect(await db.appMeta.get('shramsafal_last_pull_payload')).toBeUndefined();

            await db.appMeta.put({ key: 'shramsafal_last_pull_payload', value: { farms: [] }, updatedAt: ago(6) });
            await sweepExpiredDownloadedLabour(db);
            expect(await db.appMeta.get('shramsafal_last_pull_payload')).toBeDefined();
        });
    });

    describe('UNSENT work is never touched by an age sweep', () => {
        it('an 8-day-old queued attendance mark survives and is still shown (as queue, not server)', async () => {
            await MarkAttendanceCommand.enqueue({
                attendanceMarkId: '11111111-1111-1111-1111-111111111111', farmId: FARM,
                fieldOperatorId: RAMESH, workDate: '2026-10-01', dayMark: 'Full',
            });
            const db = getDatabase();
            await db.mutationQueue.toCollection().modify({ createdAt: ago(8), updatedAt: ago(8) });
            await sweepExpiredDownloadedLabour(db);
            expect(await db.mutationQueue.count()).toBe(1);
            const marks = await getLocalAttendanceMarks(FARM);
            expect(marks).toHaveLength(1);
            expect(marks[0].source).toBe('queue');
        });
    });

    describe('localStorage stores (read-out and roster) agree', () => {
        it('read-out and roster aged 6 days are kept, 8 days are gone, by the same boot sweep', async () => {
            const { purgeExpiredLabourCaches } = await import('../labourFarmAccess');
            const put = (k: string, d: number) => window.localStorage.setItem(k, JSON.stringify({ savedAtUtc: ago(d), payload: {}, roster: [] }));
            put('agrisync_labour_readout_v1:u:f:w6', 6);
            put('agrisync_labour_readout_v1:u:f:w8', 8);
            put('x_shramsafal_field_operator_roster_f6', 6);
            put('x_shramsafal_field_operator_roster_f8', 8);
            purgeExpiredLabourCaches();
            expect(Object.keys(window.localStorage).filter((k) => /readout|roster/.test(k)).sort()).toEqual([
                'agrisync_labour_readout_v1:u:f:w6', 'x_shramsafal_field_operator_roster_f6',
            ]);
        });
    });

    it('keeps the unidentified boundary name stable for the cross-user tests', () => {
        expect(UNIDENTIFIED_DATABASE_NAME).toBe('AgriLogDB_unidentified');
    });
});
