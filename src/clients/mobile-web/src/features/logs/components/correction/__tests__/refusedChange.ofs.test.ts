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
import { renderHook, waitFor } from '@testing-library/react';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { readRefusedChange, refusalLines, refusalReasonOf, useRefusedChangeOf, type RefusedReason } from '../refusedRevision';

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
        // fix pass 2 (item 9) — one plain reason per cause.
        expect(refusalReasonOf('ShramSafal.LogMoveAttendance.Conflict')).toBe('attendance');
        expect(refusalReasonOf('ShramSafal.LogMoveJobCard.Conflict')).toBe('jobCard');
        expect(refusalReasonOf('ShramSafal.LogMoveMoneyShared.Conflict')).toBe('moneyShared');
        expect(refusalReasonOf('ShramSafal.LogMoveMoneyNotFound.Conflict')).toBe('moneyNotFound');
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
        expect(await readRefusedChange(LOG)).toMatchObject({ kind: 'move', reason: 'noSeason' });
        expect(await readRefusedChange('another-log')).toMatchObject({ kind: 'workers', reason: 'notAllowed' });
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
        expect(await readRefusedChange(LOG)).toMatchObject({ kind: 'workers', reason: 'stale' });
    });
});

describe('lane OF-S fix pass 2 — a plain reason per cause (item 9), and the most recent refusal (B011 nit)', () => {
    const causes: RefusedReason[] = ['attendance', 'jobCard', 'moneyShared', 'moneyNotFound'];

    it('no reason tells him to change something first; each says plainly why, in his language only', () => {
        for (const reason of causes) {
            const mr = refusalLines({ kind: 'move', reason }, 'mr');
            const en = refusalLines({ kind: 'move', reason }, 'en');
            expect(mr).toHaveLength(2);
            expect(en).toHaveLength(2);
            expect(mr.join(' ')).not.toMatch(/आधी ते बदला|[A-Za-z]/);
            expect(en.join(' ')).not.toMatch(/change those first|first\b|[\u0900-\u097F]/i);
            expect(en.join(' ')).not.toMatch(/\b(AI|draft|policy|permission|grant|role|claim|access)\b/i);
        }
        expect(refusalLines({ kind: 'move', reason: 'moneyNotFound' }, 'mr')[1]).toContain('जुन्या पद्धतीने');
        expect(refusalLines({ kind: 'move', reason: 'moneyNotFound' }, 'en')[1]).toContain('saved the old way');
        expect(refusalLines({ kind: 'move', reason: 'moneyShared' }, 'en')[1]).toContain('shared out across plots');
        expect(refusalLines({ kind: 'move', reason: 'jobCard' }, 'mr')[1]).toContain('काम कार्ड');
        expect(refusalLines({ kind: 'move', reason: 'attendance' }, 'mr')[1]).toContain('हजेरी');
    });

    it('the result screen shows the MOST RECENT refusal among its entries, whatever their order', async () => {
        await getDatabase().mutationQueue.bulkAdd([
            row(SyncMutationName.MoveDailyLog, 'REJECTED_USER_REVIEW', 'ShramSafal.LogMove.Conflict', 'log-first'),
            row(SyncMutationName.MoveDailyLog, 'REJECTED_USER_REVIEW', 'ShramSafal.LogMoveJobCard.Conflict', 'log-second'),
        ] as never);
        const { result } = renderHook(() => useRefusedChangeOf(['log-first', 'log-second']));
        await waitFor(() => expect(result.current).not.toBeNull());
        expect(result.current).toMatchObject({ kind: 'move', reason: 'jobCard' });
    });
});
