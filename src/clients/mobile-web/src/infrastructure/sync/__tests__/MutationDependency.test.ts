// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 boxes 2a + 2b — the dependency-pending rule and the COST of asking it.
 *
 * Box 2a is the rule itself: enumerate the two parent sets, never describe them
 * as "still open". The trap this file exists to prove we avoided is the parent
 * parked in `REJECTED_USER_REVIEW` — "still open" is true of it, and a rule
 * written that way keeps the child retryable and uncharged for ever.
 *
 * Box 2b is the cost. The naive lookup matches on payload content in any status
 * over a table nothing prunes, per child, every cycle. `RECORDS READ` below is a
 * direct measurement — Dexie's `reading` hook fires once per materialised row —
 * and it must not move when the table grows.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resetDatabase, getDatabase, type MutationQueueStatus } from '../../storage/DexieDatabase';
import { SyncMutationName } from '../SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../retryCap';
import {
    describeDependencyRejection,
    parentClientRequestIdForDailyLog,
    parentDailyLogIdOf,
    resolveDailyLogDependency,
} from '../MutationDependency';
import { CreateDailyLogCommand } from '../../../application/usecases/sync/CreateDailyLogCommand';

const DEVICE = 'device-under-test';
const PARENT_LOG = '11111111-1111-4111-8111-111111111111';
const FROZEN_NOW_ISO = '2026-08-15T09:00:00.000Z';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

async function seedParent(status: MutationQueueStatus, retryCount = 0): Promise<void> {
    await getDatabase().mutationQueue.add({
        deviceId: DEVICE,
        clientRequestId: parentClientRequestIdForDailyLog(PARENT_LOG),
        clientCommandId: parentClientRequestIdForDailyLog(PARENT_LOG),
        mutationType: SyncMutationName.CreateDailyLog,
        payload: { dailyLogId: PARENT_LOG },
        status,
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
        retryCount,
    });
}

const childPayload = { dailyLogId: PARENT_LOG, logTaskId: 'task-1', activityType: 'spray' };

describe('MutationDependency — box 2a: the two enumerated parent sets', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('parent_PENDING_leaves_the_child_retryable_and_uncharged', async () => {
        await seedParent('PENDING');

        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);

        expect(verdict.disposition).toBe('PARENT_IN_PROGRESS');
        expect(verdict.parentDailyLogId).toBe(PARENT_LOG);
    });

    it('parent_SENDING_leaves_the_child_retryable_and_uncharged', async () => {
        await seedParent('SENDING');

        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);

        expect(verdict.disposition).toBe('PARENT_IN_PROGRESS');
    });

    it('parent_FAILED_below_the_cap_leaves_the_child_retryable_and_uncharged', async () => {
        await seedParent('FAILED', MAX_AUTO_RETRY_COUNT - 1);

        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);

        expect(verdict.disposition).toBe('PARENT_IN_PROGRESS');
    });

    // ---- THE TRAP. A "still open" rule answers IN_PROGRESS to all three. ----

    it('parent_parked_in_REJECTED_USER_REVIEW_rejects_the_child_instead_of_retrying_forever', async () => {
        await seedParent('REJECTED_USER_REVIEW', 1);

        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);

        expect(verdict.disposition).toBe('PARENT_UNRECOVERABLE');
    });

    it('parent_REJECTED_DROPPED_rejects_the_child', async () => {
        await seedParent('REJECTED_DROPPED', 1);

        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);

        expect(verdict.disposition).toBe('PARENT_UNRECOVERABLE');
    });

    it('parent_FAILED_at_the_cap_rejects_the_child', async () => {
        await seedParent('FAILED', MAX_AUTO_RETRY_COUNT);

        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);

        expect(verdict.disposition).toBe('PARENT_UNRECOVERABLE');
    });

    it('absent_parent_rejects_the_child', async () => {
        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);

        expect(verdict.disposition).toBe('PARENT_UNRECOVERABLE');
        expect(verdict.parentStatus).toBeUndefined();
    });

    it('parent_APPLIED_is_not_a_dependency_problem_and_falls_through', async () => {
        await seedParent('APPLIED');

        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);

        // Deliberately in NEITHER set: the server has the log, so a
        // DailyLogNotFound about it means something this rule cannot diagnose.
        expect(verdict.disposition).toBe('NOT_A_DEPENDENCY');
    });

    it('the_rejection_text_names_the_parent_log_and_its_state', async () => {
        await seedParent('REJECTED_USER_REVIEW', 1);

        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);
        const text = describeDependencyRejection(verdict);

        // "Naming the parent" is the requirement, not a nicety: a rejection the
        // farmer cannot trace to a cause is not resolvable.
        expect(text).toContain(PARENT_LOG);
        expect(text).toContain('REJECTED_USER_REVIEW');
    });
});

describe('MutationDependency — which payload field carries the parent', () => {
    it('reads the parent id from each child mutation shape, and from no others', () => {
        expect(parentDailyLogIdOf(SyncMutationName.AddLogTask, { dailyLogId: PARENT_LOG })).toBe(PARENT_LOG);
        expect(parentDailyLogIdOf(SyncMutationName.VerifyLog, { dailyLogId: PARENT_LOG })).toBe(PARENT_LOG);
        expect(parentDailyLogIdOf(SyncMutationName.VerifyLogV2, { logId: PARENT_LOG })).toBe(PARENT_LOG);
        expect(parentDailyLogIdOf(SyncMutationName.JobcardComplete, { dailyLogId: PARENT_LOG })).toBe(PARENT_LOG);

        // create_attachment only when it actually links to a daily log. The
        // literal is the server's (`CreateAttachmentHandler.cs:109`).
        expect(parentDailyLogIdOf(SyncMutationName.CreateAttachment, {
            linkedEntityType: 'DailyLog', linkedEntityId: PARENT_LOG,
        })).toBe(PARENT_LOG);
        expect(parentDailyLogIdOf(SyncMutationName.CreateAttachment, {
            linkedEntityType: 'Farm', linkedEntityId: PARENT_LOG,
        })).toBeNull();

        // A mutation with no daily-log parent must never be pulled into the rule.
        expect(parentDailyLogIdOf(SyncMutationName.AddCostEntry, { costEntryId: 'c1' })).toBeNull();
        expect(parentDailyLogIdOf(SyncMutationName.CreateDailyLog, { dailyLogId: PARENT_LOG })).toBeNull();
    });

    it('the_derived_parent_key_is_the_key_CreateDailyLogCommand_actually_enqueues', async () => {
        // §P0.7's stated precondition, asserted rather than assumed: the whole
        // keyed lookup collapses to "parent absent -> reject everything" if the
        // producer ever mints a random id instead of deriving one.
        await freshDb();
        const enqueued = await CreateDailyLogCommand.enqueue({
            dailyLogId: PARENT_LOG,
            farmId: '22222222-2222-4222-8222-222222222222',
            plotId: '33333333-3333-4333-8333-333333333333',
            cropCycleId: '44444444-4444-4444-8444-444444444444',
            logDate: '2026-08-15',
        });

        expect(enqueued).toBe(parentClientRequestIdForDailyLog(PARENT_LOG));
    });
});

describe('MutationDependency — box 2b: the lookup is keyed, not scanned', () => {
    let recordsRead = 0;
    let readingHook: ((obj: unknown) => unknown) | null = null;

    async function instrument() {
        const db = getDatabase();
        recordsRead = 0;
        readingHook = (obj: unknown) => {
            recordsRead += 1;
            return obj;
        };
        db.mutationQueue.hook('reading', readingHook);
    }

    afterEach(() => {
        if (readingHook) {
            getDatabase().mutationQueue.hook('reading').unsubscribe(readingHook);
            readingHook = null;
        }
    });

    async function seedNoise(count: number, offset = 0) {
        const db = getDatabase();
        const now = FROZEN_NOW_ISO;
        const rows = Array.from({ length: count }, (_, index) => ({
            deviceId: DEVICE,
            clientRequestId: `${SyncMutationName.AddCostEntry}:noise-${offset + index}`,
            clientCommandId: `${SyncMutationName.AddCostEntry}:noise-${offset + index}`,
            mutationType: SyncMutationName.AddCostEntry,
            // APPLIED on purpose: F2 blocks pruning these, so on a two-year-old
            // handset they are the overwhelming majority of the table and they
            // are exactly what a payload scan would have to walk.
            payload: { costEntryId: `noise-${offset + index}`, dailyLogId: PARENT_LOG },
            status: 'APPLIED' as MutationQueueStatus,
            createdAt: now,
            updatedAt: now,
            retryCount: 0,
        }));
        await db.mutationQueue.bulkAdd(rows);
    }

    it('reads exactly one record however large the queue has grown', async () => {
        await freshDb();
        await seedParent('PENDING');
        await seedNoise(50);
        await instrument();

        const small = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);
        const readsAt50 = recordsRead;

        expect(small.disposition).toBe('PARENT_IN_PROGRESS');
        expect(readsAt50).toBe(1);

        // Twenty times the history. A scan would read twenty times as much; an
        // indexed equality hit reads the same single row.
        await seedNoise(1000, 50);
        recordsRead = 0;
        const large = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);

        expect(large.disposition).toBe('PARENT_IN_PROGRESS');
        expect(recordsRead).toBe(readsAt50);
    });

    it('an absent parent costs zero record reads, not a whole-table scan', async () => {
        await freshDb();
        await seedNoise(500);
        await instrument();

        const verdict = await resolveDailyLogDependency(DEVICE, SyncMutationName.AddLogTask, childPayload);

        expect(verdict.disposition).toBe('PARENT_UNRECOVERABLE');
        expect(recordsRead).toBe(0);
    });
});
