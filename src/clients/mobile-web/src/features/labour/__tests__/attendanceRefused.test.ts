// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour journey fixes (D1 + D6, spec 2026-08-25-prod-cutover-waves) — a mark
 * or a no-work declaration the SERVER REFUSED must be findable, and a refused
 * mark must stop being drawn as live intent in the register.
 *
 * Real MutationQueue + real Dexie over fake-indexeddb; the queue statuses are
 * set through the queue's own transition methods, as attendanceLocal.test.ts.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { MarkAttendanceCommand } from '../../../application/usecases/sync/MarkAttendanceCommand';
import { CreateDailyLogCommand } from '../../../application/usecases/sync/CreateDailyLogCommand';
import { getLocalAttendanceMarks } from '../data/attendanceLocal';
import { listRefusedLabourState } from '../data/attendanceRefused';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../../../infrastructure/sync/retryCap';

const FARM = '22222222-2222-2222-2222-222222222222';
const OTHER_FARM = '99999999-9999-9999-9999-999999999999';
const GANESH = '33333333-3333-3333-3333-333333333333';
const WORK_DATE = '2026-09-02';

// The queue key is value-based (same facts = same row), so each mark names a
// different person: the marks must stay distinct rows.
async function markRowId(markId: string, farmId = FARM): Promise<number> {
    const fieldOperatorId = markId.slice(0, 8) + GANESH.slice(8);
    await MarkAttendanceCommand.enqueue({
        attendanceMarkId: markId, farmId, fieldOperatorId, workDate: WORK_DATE, dayMark: 'Full',
    });
    const rows = await getDatabase().mutationQueue
        .where('mutationType').equals(SyncMutationName.AttendanceMark).toArray();
    return rows.find((r) => (r.payload as { attendanceMarkId: string }).attendanceMarkId === markId)!.id!;
}

async function noWorkRowId(dailyLogId: string): Promise<number> {
    await CreateDailyLogCommand.enqueue({
        dailyLogId, farmId: FARM, logDate: WORK_DATE,
        manualDraft: { dayOutcome: 'NO_WORK_PLANNED' },
    } as never);
    const rows = await getDatabase().mutationQueue
        .where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray();
    return rows.find((r) => (r.payload as { dailyLogId: string }).dailyLogId === dailyLogId)!.id!;
}

beforeEach(async () => {
    await getDatabase().mutationQueue.clear();
    await getDatabase().attendanceMarks.clear();
});

describe('a REFUSED mark is not live intent (the register must stop drawing it)', () => {
    it('Forbidden-parked mark vanishes from the local plane; a contradiction park still shows', async () => {
        const forbidden = await markRowId('11111111-1111-1111-1111-111111111111');
        await mutationQueue.markRejectedUserReview(forbidden, 'User is not allowed to modify this farm.', 'ShramSafal.Forbidden');
        expect(await getLocalAttendanceMarks(FARM)).toEqual([]);

        await getDatabase().mutationQueue.clear();
        const contradiction = await markRowId('22222222-1111-1111-1111-111111111111');
        await mutationQueue.markRejectedUserReview(contradiction, 'x', 'ShramSafal.AttendanceContradiction');
        expect(await getLocalAttendanceMarks(FARM)).toHaveLength(1);
    });
});

describe('listRefusedLabourState — what the labour screens must tell the farmer', () => {
    it('names a Forbidden mark with its facts, flags the missing-responsibility reason, scopes to the farm', async () => {
        const mine = await markRowId('11111111-1111-1111-1111-111111111111');
        await mutationQueue.markRejectedUserReview(mine, 'User is not allowed to modify this farm.', 'ShramSafal.Forbidden');
        const other = await markRowId('33333333-1111-1111-1111-111111111111', OTHER_FARM);
        await mutationQueue.markRejectedUserReview(other, 'x', 'ShramSafal.Forbidden');

        const state = await listRefusedLabourState(FARM);
        expect(state.marks).toHaveLength(1);
        expect(state.marks[0]).toMatchObject({
            fieldOperatorId: '11111111' + GANESH.slice(8), workDate: WORK_DATE, dayMark: 'Full', missingResponsibility: true,
        });
        expect(state.noWorkDeclarationRefused).toBe(false);
    });

    it('does not claim a reason it was not told, and leaves the contradiction question to its own card', async () => {
        const odd = await markRowId('11111111-1111-1111-1111-111111111111');
        await mutationQueue.markRejectedUserReview(odd, 'something', 'ShramSafal.SyncInvalidPayload');
        const contradiction = await markRowId('22222222-1111-1111-1111-111111111111');
        await mutationQueue.markRejectedUserReview(contradiction, 'x', 'ShramSafal.AttendanceContradiction');

        const state = await listRefusedLabourState(FARM);
        expect(state.marks).toHaveLength(1);
        expect(state.marks[0].missingResponsibility).toBe(false);
    });

    it('a pending or discarded mark is not "refused"', async () => {
        await markRowId('11111111-1111-1111-1111-111111111111');
        const dropped = await markRowId('22222222-1111-1111-1111-111111111111');
        await mutationQueue.markRejectedUserReview(dropped, 'x', 'ShramSafal.Forbidden');
        await mutationQueue.markRejectedDropped(dropped);

        expect((await listRefusedLabourState(FARM)).marks).toEqual([]);
    });

    it('a refused no-work declaration is reported (rejected, or retries exhausted) but a retrying one is not', async () => {
        const rejected = await noWorkRowId('aaaaaaaa-1111-1111-1111-111111111111');
        expect((await listRefusedLabourState(FARM)).noWorkDeclarationRefused).toBe(false); // still pending

        await getDatabase().mutationQueue.update(rejected, { status: 'FAILED', retryCount: 1 });
        expect((await listRefusedLabourState(FARM)).noWorkDeclarationRefused).toBe(false); // retrying on its own

        await getDatabase().mutationQueue.update(rejected, { status: 'FAILED', retryCount: MAX_AUTO_RETRY_COUNT });
        expect((await listRefusedLabourState(FARM)).noWorkDeclarationRefused).toBe(true);

        await getDatabase().mutationQueue.update(rejected, { status: 'REJECTED_USER_REVIEW', retryCount: 1 });
        expect((await listRefusedLabourState(FARM)).noWorkDeclarationRefused).toBe(true);
    });

    it('an ordinary (work) daily log that was refused is NOT reported as a no-work declaration', async () => {
        await CreateDailyLogCommand.enqueue({ dailyLogId: 'bbbbbbbb-1111-1111-1111-111111111111', farmId: FARM, logDate: WORK_DATE } as never);
        const row = (await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray())[0];
        await getDatabase().mutationQueue.update(row.id!, { status: 'REJECTED_USER_REVIEW' });
        expect((await listRefusedLabourState(FARM)).noWorkDeclarationRefused).toBe(false);
    });
});
