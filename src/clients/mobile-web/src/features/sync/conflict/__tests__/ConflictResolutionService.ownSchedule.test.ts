// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b fix round 1, P009, P006; "names follow the language STRICTLY") - the conflict page's
 * hint for a refused own-schedule write follows the language: Marathi in Marathi mode, English in English mode, never the other. A dependent edit parked
 * with its create's code has the create's words; one whose parent just never arrived has its own plain line.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';

vi.mock('../../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { ConflictResolutionService } from '../ConflictResolutionService';

async function park(key: string, mutationType: string, errorCode: string | undefined, over: Record<string, unknown> = {}) {
    await getDatabase().mutationQueue.add({
        deviceId: mutationQueue.getDeviceId(), clientRequestId: key, clientCommandId: key, mutationType, payload: {}, status: 'REJECTED_USER_REVIEW',
        createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z', retryCount: 1, lastError: 'server words', ...(errorCode ? { errorCode } : {}), ...over,
    } as never);
}

beforeEach(async () => {
    await resetDatabase();
    await getDatabase().mutationQueue.clear();
});

describe('the hint follows the language (P009)', () => {
    it('Marathi_mode_Marathi_and_English_mode_English_for_a_refused_own_schedule_write', async () => {
        await park('schedule.edit:a', SyncMutationName.ScheduleEdit, 'ShramSafal.ScheduleMadeFor');
        const [mr] = await ConflictResolutionService.list('mr');
        expect(mr.hint).toBe('ही निवड यादीत नाही.');
        const [en] = await ConflictResolutionService.list('en');
        expect(en.hint).toBe('This choice is not in the list.');
        expect(en.hint).toMatch(/^[\x20-\x7E]+$/);
    });

    it('No_language_given_keeps_the_old_Marathi_default', async () => {
        await park('schedule.edit:a', SyncMutationName.ScheduleEdit, 'ShramSafal.ScheduleCropNotOnFarm');
        const [row] = await ConflictResolutionService.list();
        expect(row.hint).toBe('या शेतात हे पीक नाही.');
    });

    it('A_dependent_edit_whose_parent_never_arrived_has_its_own_plain_line_in_each_language (P003)', async () => {
        await park('schedule.edit:b', SyncMutationName.ScheduleEdit, 'DEPENDENCY_SCHEDULE_UNRESOLVED');
        const [mr] = await ConflictResolutionService.list('mr');
        const [en] = await ConflictResolutionService.list('en');
        expect(mr.hint).toBeTruthy();
        expect(mr.hint).toMatch(/[ऀ-ॿ]/);
        expect(en.hint).toMatch(/^[\x20-\x7E]+$/);
        expect(en.hint).toContain('first save');
    });

    it('A_follow_that_the_server_could_not_find_(another_owners_schedule) says so in plain words in each language (P006)', async () => {
        // NotFound is not a permanent code: the row is retried to the cap and shows on this page as FAILED, with the server's message only
        await park('adopt_schedule:x', SyncMutationName.AdoptSchedule, undefined, { status: 'FAILED', retryCount: 5, lastError: 'Schedule template was not found.' });
        const [mr] = await ConflictResolutionService.list('mr');
        const [en] = await ConflictResolutionService.list('en');
        expect(mr.hint).toContain('दुसऱ्या मालकाचं');
        expect(en.hint).toContain("another owner's");
    });

    it('Other_mutations_keep_their_old_hints_untouched', async () => {
        await park('adopt_schedule:y', SyncMutationName.AdoptSchedule, 'ShramSafal.ScheduleLimitReached');
        const [row] = await ConflictResolutionService.list('en');
        expect(row.hint).toBe('बाहेरची 3 शेड्यूल आधीच पाळताय'); // the old words, as before this round (not in scope)
    });
});
