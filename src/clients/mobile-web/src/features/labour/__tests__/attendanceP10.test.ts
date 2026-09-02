/**
 * Labour V2 R1 Task 3.5d — P10, the client honesty loop, verbatim from the
 * spec: "an authorised person marks attendance with connectivity off; the
 * mark survives as EXPLICITLY UNSYNCHRONIZED INTENT (never rendered as
 * saved); reconnect; sync completes; the app restarts; the same fact is
 * visible in हजेरी." Acknowledged = reconstructable without the originating
 * device — a 200 is NOT acknowledgement, and `getLocalAttendanceMarks` is
 * the exact helper Phase 4's register reads, so what this file proves is
 * what हजेरी will draw.
 *
 * Real MutationQueue + real Dexie over fake-indexeddb; the transport is dead
 * by construction (nothing here ever pushes).
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { MarkAttendanceCommand } from '../../../application/usecases/sync/MarkAttendanceCommand';
import { getLocalAttendanceMarks } from '../data/attendanceLocal';
import { reconcileAttendance } from '../../sync/pull/reconcilers/attendanceReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { AttendanceMarkDto, SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';

const FARM = '22222222-2222-2222-2222-222222222222';
const GANESH = '33333333-3333-3333-3333-333333333333';
const MARK_ID = '11111111-1111-1111-1111-111111111111';
const WORK_DATE = '2026-09-02';

const serverDto: AttendanceMarkDto = {
    id: MARK_ID,
    farmId: FARM,
    fieldOperatorId: GANESH,
    workDate: WORK_DATE,
    dayMark: 'Full',
    nightMark: null,
    hoursWorked: null,
    extraHours: null,
    hoursBasis: 'Unspecified',
    recordedByUserId: '44444444-4444-4444-4444-444444444444',
    recordedAtUtc: '2026-09-02T06:00:00.000Z',
    modifiedAtUtc: '2026-09-02T06:00:00.000Z',
};

describe('P10 — offline mark → reconnect → restart, the fact survives honestly', () => {
    it('walks the whole loop: queue-labelled intent, never "server", until the pull acknowledges it', async () => {
        // ── 1. OFFLINE MARK. The transport is dead; the enqueue is all that
        //       happens. The fact must exist locally as EXPLICITLY
        //       unsynchronized intent — labelled 'queue', and provably NOT
        //       'server', so no consumer can render it as saved. ──
        await MarkAttendanceCommand.enqueue({
            attendanceMarkId: MARK_ID,
            farmId: FARM,
            fieldOperatorId: GANESH,
            workDate: WORK_DATE,
            dayMark: 'Full',
        });

        const offline = await getLocalAttendanceMarks(FARM);
        expect(offline).toHaveLength(1);
        expect(offline[0].dayMark).toBe('Full');
        expect(offline[0].fieldOperatorId).toBe(GANESH);
        expect(offline[0].source).toBe('queue');
        expect(offline[0].source).not.toBe('server'); // the weaker state, stated

        // ── 2. RECONNECT. The worker cycle marks the queue row APPLIED on
        //       the server's applied|duplicate (BackgroundSyncWorker:377-378)
        //       and the next pull delivers the acknowledged row through the
        //       real reconciler. The fact flips to 'server'. ──
        const db = getDatabase();
        await db.mutationQueue
            .where('mutationType').equals(SyncMutationName.AttendanceMark)
            .modify({ status: 'APPLIED' });
        await reconcileAttendance(
            db,
            { attendanceMarks: [serverDto] } as unknown as SyncPullResponse,
            '2026-09-02T06:30:00.000Z');

        const synced = await getLocalAttendanceMarks(FARM);
        expect(synced).toHaveLength(1);
        expect(synced[0].source).toBe('server');
        expect(synced[0].dayMark).toBe('Full');

        // ── 3. RESTART. Close the handle and drop the singleton (what an app
        //       kill does to memory); a NEW AgriLogDatabase opens over the
        //       same IndexedDB. The same fact is still there, from the server
        //       store alone — reconstructable without the queue row, which is
        //       what "without the originating device" means locally. ──
        await resetDatabase();

        const afterRestart = await getLocalAttendanceMarks(FARM);
        expect(afterRestart).toHaveLength(1);
        expect(afterRestart[0].source).toBe('server');
        expect(afterRestart[0].dayMark).toBe('Full');
        expect(afterRestart[0].workDate).toBe(WORK_DATE);
        expect(afterRestart[0].fieldOperatorId).toBe(GANESH); // the fact हजेरी will draw
    });
});
