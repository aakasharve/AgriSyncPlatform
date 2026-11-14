// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D3; founder D-68 round 2) - `logreason.set` is a child of its saved record: it waits for the
 * record's create like every other change to it (the server answers `DailyLogNotFound` before that), and is parked when the create can never arrive.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase, type MutationQueueStatus } from '../../storage/DexieDatabase';
import { SyncMutationName } from '../SyncMutationCatalog';
import { parentClientRequestIdForDailyLog, parentDailyLogIdOf, resolveDailyLogDependency } from '../MutationDependency';

const DEVICE = 'device-under-test';
const LOG = '11111111-1111-4111-8111-1111111111a1';
const NOW = '2026-11-13T09:00:00.000Z';
const reason = { reasonId: '22222222-2222-4222-8222-222222222221', farmId: '33333333-3333-4333-8333-333333333331', dailyLogId: LOG, workKey: 'work', kind: 'Weather', saidByVoice: false };

async function seedCreate(status: MutationQueueStatus): Promise<void> {
    const key = parentClientRequestIdForDailyLog(LOG);
    await getDatabase().mutationQueue.add({
        deviceId: DEVICE, clientRequestId: key, clientCommandId: key, mutationType: SyncMutationName.CreateDailyLog,
        payload: { dailyLogId: LOG }, status, createdAt: NOW, updatedAt: NOW, retryCount: 0,
    });
}

describe('logreason.set - its parent is its record', () => {
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* none */ }
        await resetDatabase();
    });

    it('reads the parent record off the payload', () => {
        expect(parentDailyLogIdOf(SyncMutationName.LogreasonSet, reason)).toBe(LOG);
    });

    it('waits (uncharged) while the record is still on its way, and is no dependency once it is applied', async () => {
        await seedCreate('PENDING');
        expect((await resolveDailyLogDependency(DEVICE, SyncMutationName.LogreasonSet, reason)).disposition).toBe('PARENT_IN_PROGRESS');
        await getDatabase().mutationQueue.clear();
        await seedCreate('APPLIED');
        expect((await resolveDailyLogDependency(DEVICE, SyncMutationName.LogreasonSet, reason)).disposition).toBe('NOT_A_DEPENDENCY');
    });

    it('is parked when the record can never reach the server', async () => {
        await seedCreate('REJECTED_USER_REVIEW');
        expect((await resolveDailyLogDependency(DEVICE, SyncMutationName.LogreasonSet, reason)).disposition).toBe('PARENT_UNRECOVERABLE');
    });
});
