// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 fix round 1, review L006; founder D-29). An old typed reminder (`observation_derived`)
 * was filed under the log's day - "today by default", the very bug D-29 closes - so the one-time upload must not turn that day into a due date:
 * it arrives undated. A `manual` / `ai_extracted` to-do with a real day keeps it. (Original header follows.) (lane L8c-4 Task 4; founder D-1, D-29, D-31, P10) - the ONE-TIME UPLOAD of the old local to-dos,
 * through the real mutation queue, the real store and the real pull reconciler over a fake-indexeddb phone database:
 *   - an open old to-do is queued as his own reminder under an id derived from the OLD id; run twice is ONE create per old to-do;
 *   - done and cancelled old to-dos are not uploaded; a to-do for the whole farm is scope Farm; a plot of this farm is that plot, a plot of
 *     another farm is "not fixed";
 *   - the old copy stays until the server ACKNOWLEDGES each item (the pull brings the server's row), then that item leaves it - and only it;
 *   - a refused upload stays visible on this phone with its words (the parked create), nothing is deleted;
 *   - concurrent runs queue one create each, and a run for a farm whose upload finished does nothing.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { LEGACY_TODOS_KEY, uploadLegacyTodos } from '../data/legacyTodoUpload';

const FARM = '55555555-5555-4555-8555-555555555551';
const OTHER_FARM = '55555555-5555-4555-8555-555555555552';
const PLOT = '44444444-4444-4444-8444-444444444441';
const FOREIGN_PLOT = '44444444-4444-4444-8444-444444444499';

const old = (id: string, over: Record<string, unknown> = {}) => ({
    id, title: `काम ${id}`, plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL', priority: 'normal', status: 'pending', sourceType: 'manual', createdAt: '2026-10-01T05:00:00.000Z', ...over,
});

const seedOld = async (todos: unknown[]) => {
    await getDatabase().appMeta.put({ key: LEGACY_TODOS_KEY, value: todos, updatedAt: 'x' });
};
const creates = async () => (await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.PlannedworkCreate).toArray());

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.plannedWork.clear(), db.mutationQueue.clear(), db.appMeta.clear(), db.plots.clear()]);
    await db.plots.put({ id: PLOT, farmId: FARM, payload: { id: PLOT, farmId: FARM, name: 'ऊस 1' }, modifiedAtUtc: 'x' } as never);
    await db.plots.put({ id: FOREIGN_PLOT, farmId: OTHER_FARM, payload: { id: FOREIGN_PLOT, farmId: OTHER_FARM, name: 'दुसऱ्याचा' }, modifiedAtUtc: 'x' } as never);
});

describe('L006 - an old log day is not a due date', () => {
    const planned = async () => Object.fromEntries((await creates()).map(q => [(q.payload as { title: string }).title, q.payload as Record<string, unknown>]));

    it('an observation-derived to-do whose dueDate is its log day is uploaded UNDATED', async () => {
        await seedOld([old('typed', { sourceType: 'observation_derived', dueDate: '2026-10-01', createdAt: '2026-10-01T05:00:00.000Z' })]);
        await uploadLegacyTodos({ farmId: FARM });
        const sent = (await planned())['काम typed'];
        expect(sent).toBeDefined();
        expect(sent.plannedDate).toBeUndefined();
        expect(sent.looseWhen).toBeUndefined();
    });

    it('an observation-derived to-do is undated even when its day differs (no marker says it was a cue he gave)', async () => {
        await seedOld([old('typed2', { sourceType: 'observation_derived', dueDate: '2026-10-09', createdAt: '2026-10-01T05:00:00.000Z' })]);
        await uploadLegacyTodos({ farmId: FARM });
        expect((await planned())['काम typed2'].plannedDate).toBeUndefined();
    });

    it('a manual to-do with a real later day keeps it, and so does a spoken one', async () => {
        await seedOld([
            old('chosen', { sourceType: 'manual', dueDate: '2026-11-12' }),
            old('said', { sourceType: 'ai_extracted', dueDate: '2026-11-13' }),
        ]);
        await uploadLegacyTodos({ farmId: FARM });
        const by = await planned();
        expect(by['काम chosen'].plannedDate).toBe('2026-11-12');
        expect(by['काम said'].plannedDate).toBe('2026-11-13');
    });
});
