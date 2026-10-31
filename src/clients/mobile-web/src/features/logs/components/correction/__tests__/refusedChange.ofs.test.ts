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
import { moneyEntryIdFor } from '../../../../finance/moneyEntryIdentity';

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

const putLocalRecord = (dailyLogId: string) => getDatabase().logs.put({
    id: dailyLogId, schemaVersion: 1, date: '2026-10-30',
    log: {
        id: dailyLogId, date: '2026-10-30', labour: [], machinery: [],
        inputs: [{ id: 'in-1', productName: 'इथरेल', cost: 500 }],
        activityExpenses: [{ id: 'exp-1', category: 'Transport', totalAmount: 200 }],
    },
} as never);

describe('lane OF-S fix pass 3 — words that match the real state of the money (R2-3), and details not held (R2-1)', () => {
    const inputMoney = moneyEntryIdFor(`${LOG}:input:in-1`);
    const expenseMoney = moneyEntryIdFor(`${LOG}:activity-expense:exp-1`);
    // fix pass 4 — the move names no money: the phone reads the record's lines from its own store.
    const refusedMove = async () => {
        await putLocalRecord(LOG);
        await getDatabase().mutationQueue.add({
            ...row(SyncMutationName.MoveDailyLog, 'REJECTED_USER_REVIEW', 'ShramSafal.LogMoveMoneyNotFound.Conflict'),
            payload: { dailyLogId: LOG },
        } as never);
    };
    const moneyRow = (id: string, status: string, retryCount = 0) => getDatabase().mutationQueue.add({
        deviceId: 'd', clientRequestId: `${SyncMutationName.AddCostEntry}:${id}`, clientCommandId: `${SyncMutationName.AddCostEntry}:${id}`,
        mutationType: SyncMutationName.AddCostEntry, payload: { costEntryId: id }, status, createdAt: '2026-10-31T09:00:00.000Z',
        updatedAt: 'T', retryCount,
    } as never);
    const kept = (id: string, reason: string) => getDatabase().uiPrefs.put({
        key: 'agrisync_held_money_v1', value: [{ costEntryId: id, payload: {}, reason, heldAt: 'T' }],
    } as never);

    it('its money kept on this phone, and a way to send it exists: he is told where to send it', async () => {
        await refusedMove();
        await kept(expenseMoney, 'no-farm');
        expect(await readRefusedChange(LOG)).toMatchObject({ kind: 'move', reason: 'moneyKept' });
        expect(refusalLines({ kind: 'move', reason: 'moneyKept' }, 'mr')[1]).toContain('खरेदी');
        expect(refusalLines({ kind: 'move', reason: 'moneyKept' }, 'en')[1]).toContain('Procure');
    });

    it('its money kept on this phone with no way to send it (its plot is not on the server): said plainly it cannot be moved', async () => {
        await refusedMove();
        await kept(expenseMoney, 'plot-not-on-server');
        expect(await readRefusedChange(LOG)).toMatchObject({ reason: 'moneyKeptStuck' });
        expect(refusalLines({ kind: 'move', reason: 'moneyKeptStuck' }, 'en')[1]).toContain('cannot be moved');
    });

    it('its money row discarded (gone for good): this work can never be moved, never "not arrived yet"', async () => {
        await refusedMove();
        await moneyRow(inputMoney, 'REJECTED_DROPPED');
        expect(await readRefusedChange(LOG)).toMatchObject({ reason: 'moneyRemoved' });
        const en = refusalLines({ kind: 'move', reason: 'moneyRemoved' }, 'en')[1];
        const mr = refusalLines({ kind: 'move', reason: 'moneyRemoved' }, 'mr')[1];
        expect(en).toContain('can never be moved');
        expect(en).not.toMatch(/arrived/);
        expect(mr).not.toContain('पोहोचले');
    });

    it('its money waiting for his review (R3-3): look at it on the sync page first — never "can never be moved"', async () => {
        await refusedMove();
        await moneyRow(inputMoney, 'REJECTED_USER_REVIEW');
        expect(await readRefusedChange(LOG)).toMatchObject({ reason: 'moneyNeedsReview' });
        const en = refusalLines({ kind: 'move', reason: 'moneyNeedsReview' }, 'en')[1];
        const mr = refusalLines({ kind: 'move', reason: 'moneyNeedsReview' }, 'mr')[1];
        expect(en).toContain('sync page');
        expect(en).not.toMatch(/never/);
        expect(mr).toContain('सिंक');
        expect(mr).not.toContain('कधीच');
    });

    it('its money stuck at its retry limit (R3-3): its own true words — send it again, then move', async () => {
        await refusedMove();
        await moneyRow(expenseMoney, 'FAILED', 5);
        expect(await readRefusedChange(LOG)).toMatchObject({ reason: 'moneyStuck' });
        const en = refusalLines({ kind: 'move', reason: 'moneyStuck' }, 'en')[1];
        expect(en).toContain('Send it again');
        expect(en).not.toMatch(/never/);
        expect(refusalLines({ kind: 'move', reason: 'moneyStuck' }, 'mr')[1]).not.toContain('कधीच');
    });

    it('otherwise the server\'s own words stand', async () => {
        await refusedMove();
        await moneyRow(inputMoney, 'APPLIED');
        expect(await readRefusedChange(LOG)).toMatchObject({ reason: 'moneyNotFound' });
    });

    it('details the server never held (an older app version, or details that did not arrive): words true for both, no phone named', () => {
        expect(refusalReasonOf('ShramSafal.LogMoveDetailsNotHeld.Conflict')).toBe('detailsNotHeld');
        const en = refusalLines({ kind: 'move', reason: 'detailsNotHeld' }, 'en')[1];
        expect(en).toContain('older version of the app');
        expect(en).toContain('did not reach the server');
        expect(en).not.toContain('this phone');
        expect(refusalLines({ kind: 'move', reason: 'detailsNotHeld' }, 'mr')[1]).toContain('जुन्या आवृत्तीतून');
    });

    it('no new reason carries Latin letters in Marathi or Devanagari in English, nor the forbidden words', () => {
        for (const reason of ['moneyKept', 'moneyKeptStuck', 'moneyRemoved', 'moneyNeedsReview', 'moneyStuck', 'detailsNotHeld'] as RefusedReason[]) {
            expect(refusalLines({ kind: 'move', reason }, 'mr').join(' ')).not.toMatch(/[A-Za-z]/);
            const en = refusalLines({ kind: 'move', reason }, 'en').join(' ');
            expect(en.replace('खरेदी', '')).not.toMatch(/[\u0900-\u097F]/);
            expect(en).not.toMatch(/\b(AI|draft|policy|permission|grant|role|claim|access)\b/i);
        }
    });
});
