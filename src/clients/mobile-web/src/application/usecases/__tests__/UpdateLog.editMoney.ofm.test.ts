// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M, F89) — an edit's money is made by the SERVER from the
 * edit itself (`revise_log_content`); the phone never queues a money change of its own. So the money change is queued
 * with the edit, in its place in the queue (after the record and its first money), and pressing "जतन करा" twice queues
 * ONE change: the second save finds nothing new to send.
 *
 * Real `UpdateLog`, real Dexie (fake-indexeddb) and the real queue; nothing about money is mocked.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { updateLog } from '../UpdateLog';
import { DexieLogsRepository } from '../../../infrastructure/storage/DexieLogsRepository';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { QueueRowWithFacts } from '../../../infrastructure/sync/queueRowFacts';
import type { DailyLog, FarmerProfile } from '../../../types';

const LOG = '0f5e7000-0000-4000-8000-0000000000d1';
const PROFILE = { activeOperatorId: 'me', operators: [], trust: {} } as unknown as FarmerProfile;

const saved: DailyLog = {
    id: LOG,
    date: '2026-10-25',
    context: { selection: [{ cropId: 'FARM_GLOBAL', cropName: 'Farm', selectedPlotIds: [], selectedPlotNames: [] }] },
    cropActivities: [], irrigation: [], labour: [], machinery: [], activityExpenses: [],
    inputs: [{ id: 'in-1', productName: 'इथरेल', cost: 500 }],
    contentVersion: 1,
} as unknown as DailyLog;

const rowsOf = async (type: string) => getDatabase().mutationQueue.where('mutationType').equals(type).toArray();

describe('OF-M — an edit\'s money rides the edit; save twice queues once', () => {
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
    });

    it('a changed price queues one content change and no money change of the phone\'s own; a second save queues nothing', async () => {
        const repo = DexieLogsRepository.getInstance();
        await repo.save(saved);
        const edit = { inputs: [{ id: 'in-1', productName: 'इथरेल', cost: 800 }] } as Partial<DailyLog>;

        const first = await updateLog({ logId: LOG, updatedData: edit, actorId: 'me', reason: 'Spoken correction' }, repo, PROFILE);
        const second = await updateLog({ logId: LOG, updatedData: edit, actorId: 'me', reason: 'Spoken correction' }, repo, PROFILE);

        expect(first.success && first.contentRevisionQueued).toBe(true);
        expect(second.success).toBe(true);
        expect(second.contentRevisionQueued).toBe(false);
        const revisions = await rowsOf(SyncMutationName.ReviseLogContent);
        expect(revisions).toHaveLength(1);
        expect((revisions[0].payload as { content: { inputs: Array<{ cost: number }> } }).content.inputs[0].cost).toBe(800);
        expect(await rowsOf(SyncMutationName.AddCostEntry)).toHaveLength(0);
        expect(await rowsOf(SyncMutationName.CorrectCostEntry)).toHaveLength(0);
        // fix pass 1 (review 7) — the queued edit says it changes money, so आढावा counts it as a gap until applied.
        expect((revisions[0] as QueueRowWithFacts).changesMoney).toBe(true);
    });

    it('fix pass 1 (review 7): an edit that changes no price does not say it changes money', async () => {
        const repo = DexieLogsRepository.getInstance();
        await repo.save({ ...saved, irrigation: [{ id: 'w', method: 'Drip', durationHours: 2 }] } as unknown as DailyLog);

        await updateLog({ logId: LOG, updatedData: { irrigation: [{ id: 'w', method: 'Drip', durationHours: 3 }] } as Partial<DailyLog>, actorId: 'me', reason: 'x' }, repo, PROFILE);

        const revisions = await rowsOf(SyncMutationName.ReviseLogContent);
        expect(revisions).toHaveLength(1);
        expect((revisions[0] as QueueRowWithFacts).changesMoney).toBeFalsy();
    });
});
