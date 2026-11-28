// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03 B5) — the server refuses the talk speaker's change after the talk's 24 hours
 * with `ShramSafal.LogEditWindow.Conflict` (its message ends `[reason:editWindowClosed]`). The case that matters: a change he made
 * offline at hour 23 that reaches the server at hour 25. The phone says plainly that it was too late and that the record stayed as it
 * was — for a content change, a move and a worker count alike — on the "बदला" screen and on the sync page.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { readRefusedChange, refusalHint, refusalHintForRow, refusalLines, refusalReasonOf } from '../refusedRevision';

const LOG = 'log-talk-b5';
const CODE = 'ShramSafal.LogEditWindow.Conflict';
const MESSAGE = 'This talk could be changed for 24 hours after it was saved, and that time has passed. Nothing was changed. [reason:editWindowClosed]';
const TOO_LATE = 'हा बदल सर्व्हरपर्यंत पोहोचला तेव्हा २४ तास संपले होते, त्यामुळे उशीर झाला. नोंद होती तशीच राहिली.';

let n = 0;
const row = (mutationType: string, status: string, errorCode?: string, lastError?: string) => ({
    deviceId: 'd', clientRequestId: `r-${++n}`, clientCommandId: `r-${n}`, mutationType, payload: { dailyLogId: LOG },
    // made offline at hour 23 (createdAt), refused when it reached the server at hour 25
    status, createdAt: `2026-11-29T08:${String(n).padStart(2, '0')}:00.000Z`, updatedAt: '2026-11-29T10:30:00.000Z', retryCount: 0,
    ...(errorCode && { errorCode }), ...(lastError && { lastError }),
});

beforeEach(async () => {
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});

describe('B5 — the speaker\'s change that arrived after the 24 hours', () => {
    it('the server\'s code, or its reason key alone, reads as "too late"', () => {
        expect(refusalReasonOf(CODE)).toBe('windowClosed');
        expect(refusalReasonOf(undefined, MESSAGE)).toBe('windowClosed');
        expect(refusalReasonOf('ShramSafal.SomethingElse', MESSAGE)).toBe('windowClosed');
        expect(refusalReasonOf('ShramSafal.SomethingElse', 'other words')).toBe('other');
    });

    it('a content change: too late, the record stayed as it was, and his copy is only on this phone', () => {
        expect(refusalLines({ kind: 'revision', reason: 'windowClosed' }, 'mr')).toEqual([TOO_LATE, 'आधी जतन केलेला बदल सर्व्हरने घेतला नाही. तो फक्त या फोनवर आहे.']);
    });

    it('a move and a worker count: put back as the server has it, because it was too late', () => {
        expect(refusalLines({ kind: 'move', reason: 'windowClosed' }, 'mr')).toEqual(['प्लॉट / दिवस बदलला नाही — सर्व्हरवर आहे तसंच ठेवलं.', TOO_LATE]);
        expect(refusalLines({ kind: 'workers', reason: 'windowClosed' }, 'mr')).toEqual(['मजुरांचा बदल झाला नाही — सर्व्हरवर आहे तसंच ठेवलं.', TOO_LATE]);
        expect(refusalLines({ kind: 'move', reason: 'windowClosed' }, 'en')[1]).toBe('This change reached the server after the 24 hours were over, so it was too late. The record stays as it was.');
    });

    it('the "बदला" screen reads it from the refused queue row (hour 23 made, hour 25 refused)', async () => {
        await getDatabase().mutationQueue.bulkAdd([row(SyncMutationName.ReviseLogContent, 'REJECTED_USER_REVIEW', CODE, MESSAGE)] as never);
        expect(await readRefusedChange(LOG)).toMatchObject({ kind: 'revision', reason: 'windowClosed' });
    });

    it('a row with only the reason key in its message still reads as too late', async () => {
        await getDatabase().mutationQueue.bulkAdd([row(SyncMutationName.CorrectLabourAssignment, 'REJECTED_USER_REVIEW', undefined, MESSAGE)] as never);
        expect(await readRefusedChange(LOG)).toMatchObject({ kind: 'workers', reason: 'windowClosed' });
    });

    it('the sync page says the same plain words for each kind', async () => {
        expect(refusalHint(SyncMutationName.ReviseLogContent, CODE, 'mr')).toContain(TOO_LATE);
        expect(refusalHint(SyncMutationName.MoveDailyLog, CODE, 'mr')).toContain(TOO_LATE);
        expect(await refusalHintForRow({ mutationType: SyncMutationName.MoveDailyLog, errorCode: CODE, payload: { dailyLogId: LOG }, lastError: MESSAGE }, 'mr')).toContain(TOO_LATE);
        expect(await refusalHintForRow({ mutationType: SyncMutationName.CorrectLabourAssignment, payload: { dailyLogId: LOG }, lastError: MESSAGE }, 'mr')).toContain(TOO_LATE);
    });
});
