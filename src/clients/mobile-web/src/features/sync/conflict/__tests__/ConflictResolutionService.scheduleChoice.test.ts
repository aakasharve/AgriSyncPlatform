// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2 Task 4; Review Focus 1) - the second phone's adopt is parked
 * with its own words, never the generic "check and retry" line.
 * Lane L8b-3 (founder D-74, "3 + 1"; the L8b-2 words were changed on purpose): a DIFFERENT schedule is now kept as well (up to 3 outside),
 * so `ScheduleAlreadyAdopted` means the SAME schedule is already followed: "हे शेड्यूल या प्लॉटवर आधीच पाळताय" (PROPOSED). The three new
 * refusals (`ScheduleLimitReached`, `OwnScheduleLimitReached`, `ScheduleChoiceNeeded`) say their own words too.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../../infrastructure/sync/MutationQueue';
import { ConflictResolutionService, SCHEDULE_ALREADY_ADOPTED_CODE } from '../ConflictResolutionService';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

beforeEach(async () => {
    await resetDatabase();
    await getDatabase().mutationQueue.clear();
});

const park = (clientRequestId: string, mutationType: string, errorCode: string) =>
    getDatabase().mutationQueue.add({
        deviceId: mutationQueue.getDeviceId(), clientRequestId, clientCommandId: clientRequestId, mutationType, payload: {},
        status: 'REJECTED_USER_REVIEW', createdAt: 'x', updatedAt: 'x', retryCount: 0, lastError: 'refused', errorCode,
    });

describe('a refused schedule choice is parked with words', () => {
    it('ScheduleAlreadyAdopted: the second phone is told the schedule is already followed on the plot', async () => {
        expect(SCHEDULE_ALREADY_ADOPTED_CODE).toBe('ShramSafal.ScheduleAlreadyAdopted');
        await park('adopt_schedule:s1', SyncMutationName.AdoptSchedule, 'ShramSafal.ScheduleAlreadyAdopted');
        const [view] = await ConflictResolutionService.list();
        expect(view.mutationType).toBe(SyncMutationName.AdoptSchedule);
        expect(view.hint).toBe('हे शेड्यूल या प्लॉटवर आधीच पाळताय');
    });

    it.each([
        ['ShramSafal.ScheduleLimitReached', 'बाहेरची 3 शेड्यूल आधीच पाळताय'],
        ['ShramSafal.OwnScheduleLimitReached', 'तुमचं स्वतःचं 1 शेड्यूल आधीच पाळताय'],
        ['ShramSafal.ScheduleChoiceNeeded', 'कोणतं शेड्यूल ते निवडा'],
    ])('%s is PERMANENT (parked, not retried) and says its words', async (code, words) => {
        await park(`adopt_schedule:${code}`, SyncMutationName.AdoptSchedule, code);
        const [view] = await ConflictResolutionService.list();
        expect(view.hint).toBe(words);
    });

    it('Forbidden: told plainly that this person may not change it', async () => {
        await park('adopt_schedule:s2', SyncMutationName.AdoptSchedule, 'ShramSafal.Forbidden');
        const [view] = await ConflictResolutionService.list();
        expect(view.hint).toBe('मालक तुम्हाला "कामाचं नियोजन करणे" देऊ शकतात.'); // B015: for a schedule choice only
    });
});
