// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S) — THE surface for a refused queued change of one entry
 * reads the queue's own rows (fake-indexeddb): which kind was refused (content / move / worker count) and the plain
 * reason from the server's full code. A later ACCEPTED change of the same kind clears it; another entry's rows never
 * count.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { readRefusedChange, refusalReasonOf } from '../refusedRevision';

const LOG = 'log-ofs-1';
let n = 0;
const row = (mutationType: string, status: string, errorCode?: string, dailyLogId = LOG) => ({
    deviceId: 'd', clientRequestId: `r-${++n}`, clientCommandId: `r-${n}`, mutationType, payload: { dailyLogId },
    status, createdAt: `2026-10-31T10:00:${String(n).padStart(2, '0')}.000Z`, updatedAt: 'T', retryCount: 0,
    ...(errorCode && { errorCode }),
});

beforeEach(async () => {
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});

describe('lane OF-S — what was refused, and why', () => {
    it('maps every lane OF-S code to its plain reason, and claims none for an unknown code', () => {
        expect(refusalReasonOf('ShramSafal.LogMove.Conflict')).toBe('stale');
        expect(refusalReasonOf('ShramSafal.LabourCorrection.Conflict')).toBe('stale');
        expect(refusalReasonOf('ShramSafal.LogDateInFuture.InvalidCommand')).toBe('futureDay');
        expect(refusalReasonOf('ShramSafal.LogMoveNoCropCycle.InvalidCommand')).toBe('noSeason');
        expect(refusalReasonOf('ShramSafal.LogMoveLinkedRecords.Conflict')).toBe('linked');
        expect(refusalReasonOf('ShramSafal.Forbidden')).toBe('notAllowed');
        expect(refusalReasonOf('ShramSafal.SomethingElse')).toBe('other');
        expect(refusalReasonOf(undefined)).toBe('other');
    });

    it('a refused move of THIS entry is read with its reason; another entry and a waiting change are not', async () => {
        await getDatabase().mutationQueue.bulkAdd([
            row(SyncMutationName.MoveDailyLog, 'REJECTED_USER_REVIEW', 'ShramSafal.LogMoveNoCropCycle.InvalidCommand'),
            row(SyncMutationName.CorrectLabourAssignment, 'REJECTED_USER_REVIEW', 'ShramSafal.Forbidden', 'another-log'),
            row(SyncMutationName.ReviseLogContent, 'PENDING'),
        ] as never);
        expect(await readRefusedChange(LOG)).toEqual({ kind: 'move', reason: 'noSeason' });
        expect(await readRefusedChange('another-log')).toEqual({ kind: 'workers', reason: 'notAllowed' });
        expect(await readRefusedChange('nothing-here')).toBeNull();
    });

    it('a later accepted change of the same kind clears it; the most recent refusal wins across kinds', async () => {
        await getDatabase().mutationQueue.bulkAdd([
            row(SyncMutationName.MoveDailyLog, 'REJECTED_USER_REVIEW', 'ShramSafal.LogMove.Conflict'),
            row(SyncMutationName.MoveDailyLog, 'APPLIED'),
        ] as never);
        expect(await readRefusedChange(LOG)).toBeNull();
        await getDatabase().mutationQueue.bulkAdd([
            row(SyncMutationName.CorrectLabourAssignment, 'REJECTED_USER_REVIEW', 'ShramSafal.LabourCorrection.Conflict'),
        ] as never);
        expect(await readRefusedChange(LOG)).toEqual({ kind: 'workers', reason: 'stale' });
    });
});
