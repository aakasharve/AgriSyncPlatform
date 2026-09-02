/**
 * Labour V2 R1 — B001 pin (3.5 review, fix round 1): getLocalAttendanceMarks
 * is the ONE read Phase 4's register consumes, and its queue half must show
 * exactly the statuses that are LIVE local intent.
 *
 * The invariant that seeded this file: a REJECTED_DROPPED mutation — the
 * farmer's explicit discard in the conflict UI (MutationQueue soft-delete) —
 * must NEVER surface from this helper. Before the fix it did, forever: it
 * never retries, never flips to 'server', never leaves. Reachable on this
 * exact surface via contradiction → ShramSafal.AttendanceContradiction
 * (PERMANENT) → markRejectedUserReview → conflict-UI drop → phantom mark.
 *
 * Real MutationQueue + real Dexie over fake-indexeddb — the statuses are set
 * through the queue's own transition methods, never poked in by hand, so a
 * renamed status breaks HERE and not silently in the register.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { MarkAttendanceCommand } from '../../../application/usecases/sync/MarkAttendanceCommand';
import { getLocalAttendanceMarks } from '../data/attendanceLocal';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

const FARM = '22222222-2222-2222-2222-222222222222';
const GANESH = '33333333-3333-3333-3333-333333333333';

async function enqueueOneMark(): Promise<number> {
    await MarkAttendanceCommand.enqueue({
        attendanceMarkId: '11111111-1111-1111-1111-111111111111',
        farmId: FARM,
        fieldOperatorId: GANESH,
        workDate: '2026-09-02',
        dayMark: 'Full',
    });
    const row = await getDatabase().mutationQueue
        .where('mutationType').equals(SyncMutationName.AttendanceMark)
        .first();
    expect(row?.id).toBeDefined();
    return row!.id!;
}

describe('getLocalAttendanceMarks — only LIVE intent surfaces from the queue', () => {
    beforeEach(async () => {
        await getDatabase().mutationQueue.clear();
        await getDatabase().attendanceMarks.clear();
    });

    it('THE PIN: a mark the farmer explicitly discarded (REJECTED_DROPPED) vanishes from the helper', async () => {
        const id = await enqueueOneMark();
        expect(await getLocalAttendanceMarks(FARM)).toHaveLength(1); // sanity: live before the drop

        await mutationQueue.markRejectedDropped(id);

        expect(await getLocalAttendanceMarks(FARM)).toEqual([]);
    });

    it('a mark parked for the farmer to answer (REJECTED_USER_REVIEW) still shows — as queue intent, never server', async () => {
        // Deliberate (see LIVE_INTENT_STATUSES): the AttendanceContradiction
        // parks the row for HIS decision; blanking his statement from the
        // register while the question is open would be a silent vanish.
        const id = await enqueueOneMark();
        await mutationQueue.markRejectedUserReview(id, 'ShramSafal.AttendanceContradiction');

        const marks = await getLocalAttendanceMarks(FARM);
        expect(marks).toHaveLength(1);
        expect(marks[0].source).toBe('queue');
    });

    it('FAILED intent is still intent — a retry-capped mark stays visible', async () => {
        const id = await enqueueOneMark();
        await mutationQueue.markFailed(id, 'transport dead');

        const marks = await getLocalAttendanceMarks(FARM);
        expect(marks).toHaveLength(1);
        expect(marks[0].source).toBe('queue');
    });
});
