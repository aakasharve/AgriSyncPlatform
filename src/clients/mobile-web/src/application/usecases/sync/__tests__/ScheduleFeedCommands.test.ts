// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5) - an own work feeds planning by the farmer's second act, queued with no internet: the plan id is the
 * same UUIDv5 the server mints for that occurrence (two phones, one plan), the payload passes the contract's own schema, and an answer about a sign is its own
 * request every time (append-only). A switched-off farm's refusal parks with plain words, never retried as if it could pass.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { categorizeRejection } from '../../../../infrastructure/sync/RejectionPolicy';
import { ScheduleFeedCommands, schedulePlanId } from '../ScheduleFeedCommands';
import { readPendingPlannedWorkIds } from '../../../../features/sync/pull/reconcilers/plannedWorkReconciler';

const PLACE = {
    farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1',
    plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1',
    cropCycleId: 'c1c1c1c1-0000-4000-8000-0000000000c1',
} as const;
const ITEM = '7b000000-0000-4000-8000-0000000000aa';

beforeEach(async () => {
    await resetDatabase();
});

describe('ScheduleFeedCommands (slice 5)', () => {
    it('mints the server\'s plan id for an occurrence (the same vectors as PlannedWork.ScheduleIdFor)', () => {
        expect(schedulePlanId(ITEM, 1)).toBe('abdfa4d1-3ad8-5207-a643-ae6e1991fa6b');
        expect(schedulePlanId(ITEM, 2)).toBe('aebcdb70-09ce-5ca6-8be6-ad4fafd629b1');
        expect(schedulePlanId(ITEM.toUpperCase(), 1)).toBe(schedulePlanId(ITEM, 1));
    });

    it('queues "plan" under that id, with who and a note, and the pull sweep keeps it as owed', async () => {
        const queued = await ScheduleFeedCommands.plan(PLACE, { taskKey: 't1', ownItemId: ITEM, occurrence: 1 }, { assigneeUserId: 'b2b2b2b2-0000-4000-8000-0000000000b2', note: '  सकाळी  ' });
        expect(queued.id).toBe(schedulePlanId(ITEM, 1));
        const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.OwnscheduleItemPlan).toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toEqual({
            plannedWorkId: queued.id,
            farmId: PLACE.farmId,
            plotId: PLACE.plotId,
            cropCycleId: PLACE.cropCycleId,
            taskKey: 't1',
            assigneeUserId: 'b2b2b2b2-0000-4000-8000-0000000000b2',
            note: 'सकाळी',
        });
        expect((await readPendingPlannedWorkIds(getDatabase())).has(queued.id)).toBe(true);
    });

    it('two taps on "plan" for the same occurrence are one request (the same id)', async () => {
        await ScheduleFeedCommands.plan(PLACE, { taskKey: 't1', ownItemId: ITEM, occurrence: 1 });
        await expect(ScheduleFeedCommands.plan(PLACE, { taskKey: 't1', ownItemId: ITEM, occurrence: 1 })).resolves.toBeDefined();
        const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.OwnscheduleItemPlan).toArray();
        expect(rows).toHaveLength(1);
    });

    it('every answer about a sign is its own request; a shape the contract refuses never leaves the phone', async () => {
        await ScheduleFeedCommands.answerSign(PLACE, 'flower', 'unsure', '2026-11-20');
        await ScheduleFeedCommands.answerSign(PLACE, 'flower', 'seen', '2026-11-21');
        const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.ScheduleTaskEvent).toArray();
        expect(rows.map(r => (r.payload as { answer: string }).answer)).toEqual(['unsure', 'seen']);
        await expect(ScheduleFeedCommands.answerSign(PLACE, 'flower', 'maybe' as never)).rejects.toThrow();
    });

    it('a switched-off farm is a permanent refusal with plain words (parked, not retried)', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.ScheduleMechanismOff' })).toBe('PERMANENT');
    });
});
