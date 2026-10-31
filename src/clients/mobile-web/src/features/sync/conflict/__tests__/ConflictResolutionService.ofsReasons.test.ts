// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S fix 1, B011) — on the app's conflict page a refused
 * move of a saved entry, a refused worker-count change and a refused create for a day that has not come say WHY in
 * plain words, in the farmer's language (Marathi mode: Marathi only; English mode: English only) — never only the
 * server's English message.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { ConflictResolutionService } from '../ConflictResolutionService';

const NOW = '2026-10-31T00:00:00.000Z';
const park = (mutationType: string, errorCode: string) => getDatabase().mutationQueue.add({
    deviceId: 'd', clientRequestId: `${mutationType}:x`, clientCommandId: `${mutationType}:x`, mutationType,
    payload: { dailyLogId: 'log-1' }, status: 'REJECTED_USER_REVIEW', createdAt: NOW, updatedAt: NOW, retryCount: 1,
    lastError: 'The server said no in English.', errorCode,
});

beforeEach(async () => { await getDatabase().mutationQueue.clear(); });

describe('lane OF-S — the plain reason on the conflict page', () => {
    it.each([
        [SyncMutationName.MoveDailyLog, 'ShramSafal.LogMoveAttendance.Conflict',
            'प्लॉट / दिवस बदलला नाही — सर्व्हरवर आहे तसंच ठेवलं. या दिवसाच्या हजेरीत यातील लोक आहेत, त्यामुळे हे काम हलवता येत नाही.',
            'The plot / day was not changed — it is kept as the server has it. People on this work are in that day\'s attendance, so it cannot be moved.'],
        // fix pass 2 (orchestrator call) — money saved the old way, kept on the phone, or not arrived.
        [SyncMutationName.MoveDailyLog, 'ShramSafal.LogMoveMoneyNotFound.Conflict',
            'प्लॉट / दिवस बदलला नाही — सर्व्हरवर आहे तसंच ठेवलं. या कामाचे पैसे जुन्या पद्धतीने जतन झाले आहेत किंवा अजून पोहोचले नाहीत, त्यामुळे हे काम हलवता येत नाही.',
            'The plot / day was not changed — it is kept as the server has it. This work\'s money was saved the old way or has not arrived yet, so it cannot be moved.'],
        [SyncMutationName.CorrectLabourAssignment, 'ShramSafal.LabourCorrection.Conflict',
            'मजुरांचा बदल झाला नाही — सर्व्हरवर आहे तसंच ठेवलं. तुम्ही पाहिल्यानंतर दुसऱ्या कोणी हे बदललं.',
            'The workers change was not made — it is kept as the server has it. Someone changed this after you saw it.'],
        [SyncMutationName.CreateDailyLog, 'ShramSafal.LogDateInFuture.InvalidCommand',
            'तो दिवस अजून आलेला नाही.', 'That day has not come yet.'],
    ])('%s refused with %s says why, in Marathi and in English', async (mutationType, code, mr, en) => {
        await park(mutationType, code);
        expect((await ConflictResolutionService.list('mr'))[0].hint).toBe(mr);
        expect((await ConflictResolutionService.list('en'))[0].hint).toBe(en);
    });
});
