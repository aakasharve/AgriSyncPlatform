// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-3; founder D-24d) - the phone dependency path for an ARRAY of parents.
 * `plannedwork.complete` carries `dailyLogIds`: it waits for EVERY parent log's create, and is parked as soon as ANY one of them
 * cannot reach the server (it names that log). The single-field children keep their old answers exactly.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase, type MutationQueueStatus } from '../../storage/DexieDatabase';
import { SyncMutationName } from '../SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../retryCap';
import {
    describeDependencyRejection,
    parentClientRequestIdForDailyLog,
    parentDailyLogIdOf,
    parentDailyLogIdsOf,
    resolveDailyLogDependency,
} from '../MutationDependency';

const DEVICE = 'device-under-test';
const LOG_A = '11111111-1111-4111-8111-1111111111a1';
const LOG_B = '11111111-1111-4111-8111-1111111111b2';
const TASK = '33333333-3333-4333-8333-333333333331';
const FARM = '22222222-2222-4222-8222-222222222221';
const NOW = '2026-11-08T09:00:00.000Z';
const complete = { plannedWorkId: TASK, farmId: FARM, plotIds: [], dailyLogIds: [LOG_A, LOG_B], somethingLeft: false };

async function freshDb() {
    try { await getDatabase().delete(); } catch { /* none */ }
    await resetDatabase();
}

async function seed(logId: string, status: MutationQueueStatus, retryCount = 0): Promise<void> {
    const key = parentClientRequestIdForDailyLog(logId);
    await getDatabase().mutationQueue.add({
        deviceId: DEVICE, clientRequestId: key, clientCommandId: key, mutationType: SyncMutationName.CreateDailyLog,
        payload: { dailyLogId: logId }, status, createdAt: NOW, updatedAt: NOW, retryCount,
    });
}

describe('plannedwork.complete - the parents are the whole array', () => {
    beforeEach(freshDb);

    it('reads every parent id off the array, each once, and none off a payload without one', () => {
        expect(parentDailyLogIdsOf(SyncMutationName.PlannedworkComplete, complete)).toEqual([LOG_A, LOG_B]);
        expect(parentDailyLogIdsOf(SyncMutationName.PlannedworkComplete, { ...complete, dailyLogIds: [LOG_A, LOG_A, ' ', 7] })).toEqual([LOG_A]);
        expect(parentDailyLogIdsOf(SyncMutationName.PlannedworkComplete, { ...complete, dailyLogIds: [] })).toEqual([]);
        expect(parentDailyLogIdsOf(SyncMutationName.PlannedworkComplete, { plannedWorkId: TASK })).toEqual([]);
        // The other plannedwork steps, and the money, have no daily-log parent.
        expect(parentDailyLogIdsOf(SyncMutationName.PlannedworkReopen, { plannedWorkId: TASK, reason: 'x' })).toEqual([]);
        expect(parentDailyLogIdsOf(SyncMutationName.PlannedworkAccept, { plannedWorkId: TASK })).toEqual([]);
        // The single-field children keep their answers, as one-element lists.
        expect(parentDailyLogIdsOf(SyncMutationName.AddLogTask, { dailyLogId: LOG_A })).toEqual([LOG_A]);
        expect(parentDailyLogIdsOf(SyncMutationName.VerifyLogV2, { logId: LOG_A })).toEqual([LOG_A]);
        expect(parentDailyLogIdOf(SyncMutationName.AddLogTask, { dailyLogId: LOG_A })).toBe(LOG_A);
    });

    it('waits (uncharged) while ANY parent is still on its way, even when another is already applied', async () => {
        await seed(LOG_A, 'APPLIED');
        await seed(LOG_B, 'PENDING');
        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.PlannedworkComplete, complete);
        expect(verdict.disposition).toBe('PARENT_IN_PROGRESS');
        expect(verdict.parentDailyLogId).toBe(LOG_B);

        await freshDb();
        await seed(LOG_A, 'SENDING');
        await seed(LOG_B, 'FAILED', MAX_AUTO_RETRY_COUNT - 1);
        expect((await resolveDailyLogDependency(DEVICE, SyncMutationName.PlannedworkComplete, complete)).disposition).toBe('PARENT_IN_PROGRESS');
    });

    it('is parked when ANY parent cannot reach the server - and says which', async () => {
        for (const bad of ['REJECTED_USER_REVIEW', 'REJECTED_DROPPED'] as const) {
            await freshDb();
            await seed(LOG_A, 'PENDING');
            await seed(LOG_B, bad);
            const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.PlannedworkComplete, complete);
            expect(verdict.disposition, bad).toBe('PARENT_UNRECOVERABLE');
            expect(verdict.parentDailyLogId).toBe(LOG_B);
            expect(describeDependencyRejection(verdict)).toContain(LOG_B);
        }

        // A cap-exhausted parent, and a parent with no row on this phone at all, are the same.
        await freshDb();
        await seed(LOG_A, 'APPLIED');
        await seed(LOG_B, 'FAILED', MAX_AUTO_RETRY_COUNT);
        expect((await resolveDailyLogDependency(DEVICE, SyncMutationName.PlannedworkComplete, complete)).disposition).toBe('PARENT_UNRECOVERABLE');
        await freshDb();
        await seed(LOG_A, 'PENDING');
        const absent = await resolveDailyLogDependency(DEVICE, SyncMutationName.PlannedworkComplete, complete);
        expect(absent.disposition).toBe('PARENT_UNRECOVERABLE');
        expect(absent.parentDailyLogId).toBe(LOG_B);
    });

    it('is no dependency once every parent is applied, or when it names no log (a reminder done with none)', async () => {
        await seed(LOG_A, 'APPLIED');
        await seed(LOG_B, 'APPLIED');
        expect((await resolveDailyLogDependency(DEVICE, SyncMutationName.PlannedworkComplete, complete)).disposition).toBe('NOT_A_DEPENDENCY');
        expect((await resolveDailyLogDependency(DEVICE, SyncMutationName.PlannedworkComplete, { ...complete, dailyLogIds: [] })).disposition)
            .toBe('NOT_A_DEPENDENCY');
        expect((await resolveDailyLogDependency(DEVICE, SyncMutationName.PlannedworkReopen, { plannedWorkId: TASK })).disposition)
            .toBe('NOT_A_DEPENDENCY');
    });

    it('leaves a single-parent child exactly as it was (the old answers)', async () => {
        await seed(LOG_A, 'PENDING');
        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, { dailyLogId: LOG_A, logTaskId: 't' });
        expect(verdict).toEqual({
            disposition: 'PARENT_IN_PROGRESS', parentDailyLogId: LOG_A,
            parentClientRequestId: parentClientRequestIdForDailyLog(LOG_A), parentStatus: 'PENDING',
        });
        await freshDb();
        const missing = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, { dailyLogId: LOG_A, logTaskId: 't' });
        expect(missing.disposition).toBe('PARENT_UNRECOVERABLE');
        expect(missing.parentStatus).toBeUndefined();
    });
});
