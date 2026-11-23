// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3) - a plot-season's own schedule on the phone: changes are queued with no internet, a second edit of
 * the same work before sync is QUEUED (never refused or merged away), the pull's copy replaces the server cache whole, the local view never draws queued intent
 * as saved, and a switched-off farm's refusal parks with plain Marathi words instead of being retried five times and parked silently.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { categorizeRejection } from '../../../../infrastructure/sync/RejectionPolicy';
import { OwnScheduleCommands } from '../OwnScheduleCommands';
import { reconcileOwnScheduleItems } from '../../../../features/sync/pull/reconcilers/ownScheduleItemsReconciler';
import { getLocalOwnSchedule } from '../../../../features/scheduler/ownSchedule/ownScheduleLocal';
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';

const PLACE = {
    farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1',
    plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1',
    cropCycleId: 'c1c1c1c1-0000-4000-8000-0000000000c1',
} as const;

const task = (key: string, name: string, fromDay = 3): ScheduleTaskContent => ({
    taskKey: key,
    name,
    kind: 'work',
    timing: {
        timer: 'day', fromDay, toDay: null, afterTaskKey: null, usualDays: null, earliestDays: null, latestDays: null, signWords: null,
        expectedFromDay: null, expectedToDay: null, whenWords: null, repeat: 'once', repeatInterval: null, repeatEndDay: null, repeatEndSign: null,
    },
    basis: 'experience',
    stageIndex: 0,
    order: 0,
    why: null, dose: null, steps: [], products: [], reEntryHours: null, preHarvestDays: null, warnings: [], look: null, ask: null, sources: [], origin: null,
});

const queued = async () => (await getDatabase().mutationQueue.toArray())
    .filter(r => r.mutationType.startsWith('ownschedule.'))
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

const serverItem = (key: string, name: string, revision = 1, state: 'active' | 'removed' = 'active') => ({
    id: `id-${key}`, ...PLACE, taskKey: key, revision, state, task: task(key, name), contentHash: 'a'.repeat(64), origin: null, mainVersionId: null,
    updatedAtUtc: '2026-11-23T06:00:00Z',
});

beforeEach(async () => {
    await getDatabase().delete();
    await resetDatabase();
});

describe('own schedule commands (slice 3)', () => {
    it('queues a save with exactly the contract fields and no owner (the server reads the owner from the farm)', async () => {
        await OwnScheduleCommands.save(PLACE, task('t1', 'छाटणी'));
        const [row] = await queued();
        expect(row.mutationType).toBe(SyncMutationName.OwnscheduleItemSave);
        expect(row.status).toBe('PENDING');
        expect(Object.keys(row.payload as object).sort()).toEqual(['cropCycleId', 'farmId', 'plotId', 'task']);
        expect(JSON.stringify(row.payload)).not.toMatch(/owner|userId/i);
    });

    it('a second edit of the same work before sync is QUEUED behind the first, never refused or merged away', async () => {
        await OwnScheduleCommands.save(PLACE, task('t1', 'खुरपणी'));
        await OwnScheduleCommands.save(PLACE, task('t1', 'खुरपणी (दुसरी)', 5));
        const rows = await queued();
        expect(rows).toHaveLength(2);
        expect(rows[0].clientRequestId).not.toBe(rows[1].clientRequestId);
        expect(rows.map(r => (r.payload as { task: ScheduleTaskContent }).task.name)).toEqual(['खुरपणी', 'खुरपणी (दुसरी)']);
    });

    it('refuses on the phone a task the contract would refuse (an unknown key), so it never leaves', async () => {
        const bad = { ...task('t1', 'छाटणी'), price: 5 } as unknown as ScheduleTaskContent;
        await expect(OwnScheduleCommands.save(PLACE, bad)).rejects.toThrow(/Payload validation failed/);
        expect(await queued()).toHaveLength(0);
    });

    it('queues a removal and a make-main with its day-ordered stage line', async () => {
        await OwnScheduleCommands.remove(PLACE, 't1');
        await OwnScheduleCommands.makeMain(PLACE, { name: ' माझे ', stageLine: [{ name: 'फुटवा', startDay: 0, endDay: 10, endSign: 'फूट दिसली' }] });
        const [remove, main] = await queued();
        expect(remove.payload).toEqual({ ...PLACE, taskKey: 't1' });
        expect(main.mutationType).toBe(SyncMutationName.OwnscheduleMakeMain);
        expect(main.payload).toEqual({ ...PLACE, name: 'माझे', stageLine: [{ name: 'फुटवा', startDay: 0, endDay: 10, endSign: 'फूट दिसली' }] });
    });
});

describe('the switched-off refusal parks with words', () => {
    it('ScheduleMechanismOff and OwnScheduleInvalid are permanent: parked for the farmer, never retried to the cap', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.ScheduleMechanismOff' })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: 'ShramSafal.OwnScheduleInvalid' })).toBe('PERMANENT');
    });
});

describe('the server cache and the local view', () => {
    it('the pull replaces the cache whole, skips an unreadable row, and an absent key leaves it', async () => {
        const db = getDatabase();
        await reconcileOwnScheduleItems(db, { ownScheduleItems: [serverItem('t1', 'छाटणी'), { id: 'broken' }], ownScheduleItemRevisions: [] } as unknown as SyncPullResponse);
        expect((await db.ownScheduleItems.toArray()).map(r => r.taskKey)).toEqual(['t1']);

        await reconcileOwnScheduleItems(db, {} as SyncPullResponse);
        expect(await db.ownScheduleItems.count()).toBe(1);

        await reconcileOwnScheduleItems(db, { ownScheduleItems: [serverItem('t2', 'फवारणी')] } as unknown as SyncPullResponse);
        expect((await db.ownScheduleItems.toArray()).map(r => r.taskKey)).toEqual(['t2']);
    });

    it('queued intent is laid over the server rows and marked pending; a parked change marks its work refused and is not drawn as done', async () => {
        const db = getDatabase();
        await reconcileOwnScheduleItems(db, { ownScheduleItems: [serverItem('t1', 'छाटणी'), serverItem('t2', 'फवारणी')] } as unknown as SyncPullResponse);
        await OwnScheduleCommands.save(PLACE, task('t1', 'छाटणी (बदल)', 4));
        await OwnScheduleCommands.save(PLACE, task('t3', 'नवीन काम'));
        await OwnScheduleCommands.remove(PLACE, 't2');
        const removeRow = (await queued()).find(r => r.mutationType === SyncMutationName.OwnscheduleItemRemove)!;
        await db.mutationQueue.update(removeRow.id!, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.ScheduleMechanismOff' });

        const works = await getLocalOwnSchedule(db, PLACE.cropCycleId);
        const byKey = Object.fromEntries(works.map(w => [w.taskKey, w]));
        expect(byKey.t1).toMatchObject({ pending: true, state: 'active', serverRevision: 1 });
        expect(byKey.t1.task.name).toBe('छाटणी (बदल)');
        expect(byKey.t3).toMatchObject({ pending: true, serverRevision: null });
        expect(byKey.t2).toMatchObject({ pending: false, refused: true, state: 'active' });
    });
});
