// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 / T-IGH-04-CONFLICT-STATUS-DURABILITY — locks the durable
 * rejection contract.
 *
 * Plan 04 §Architecture calls for explicit `pending`, `applied`,
 * `rejected_user_review`, `rejected_dropped` mutation states. These tests
 * lock the boundary that distinguishes them from the transient FAILED
 * status: durable rejections must survive every worker cycle until the
 * user explicitly retries or discards.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { MutationQueue } from '../MutationQueue';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-04-01T12:00:00.000Z';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

async function seedRow(status: 'PENDING' | 'SENDING' | 'APPLIED' | 'FAILED' | 'REJECTED_USER_REVIEW' | 'REJECTED_DROPPED', overrides: Partial<{ retryCount: number; clientRequestId: string; lastError: string }> = {}) {
    const db = getDatabase();
    const id = await db.mutationQueue.add({
        deviceId: 'test-device',
        clientRequestId: overrides.clientRequestId ?? `req-${status.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
        clientCommandId: 'cmd-1',
        mutationType: 'create_daily_log',
        payload: { sample: true },
        status,
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
        retryCount: overrides.retryCount ?? 0,
        lastError: overrides.lastError,
    });
    return id;
}

describe('MutationQueue — T-IGH-04-CONFLICT-STATUS-DURABILITY', () => {
    beforeEach(async () => {
        vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);
        await freshDb();
    });

    it('markFailedAsPending flips FAILED rows to PENDING (existing behavior preserved)', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedRow('FAILED');

        await queue.markFailedAsPending();

        const row = await getDatabase().mutationQueue.get(id);
        expect(row?.status).toBe('PENDING');
    });

    it('markFailedAsPending does NOT flip REJECTED_USER_REVIEW rows', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedRow('REJECTED_USER_REVIEW', { lastError: 'CLIENT_TOO_OLD' });

        await queue.markFailedAsPending();

        const row = await getDatabase().mutationQueue.get(id);
        // The whole point of durable rejection: this row must NOT auto-retry.
        expect(row?.status).toBe('REJECTED_USER_REVIEW');
        expect(row?.lastError).toBe('CLIENT_TOO_OLD');
    });

    it('markFailedAsPending does NOT flip REJECTED_DROPPED rows', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedRow('REJECTED_DROPPED');

        await queue.markFailedAsPending();

        const row = await getDatabase().mutationQueue.get(id);
        expect(row?.status).toBe('REJECTED_DROPPED');
    });

    it('a REJECTED_USER_REVIEW row survives N consecutive markFailedAsPending invocations (cycle simulation)', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedRow('REJECTED_USER_REVIEW', { lastError: 'MUTATION_TYPE_UNIMPLEMENTED' });

        for (let i = 0; i < 5; i++) {
            await queue.resetInFlightMutations();
            await queue.markFailedAsPending();
        }

        const row = await getDatabase().mutationQueue.get(id);
        expect(row?.status).toBe('REJECTED_USER_REVIEW');
    });

    it('markRejectedUserReview sets the durable status + records lastError + bumps retryCount', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedRow('SENDING', { retryCount: 2 });

        await queue.markRejectedUserReview(id, 'CLIENT_TOO_OLD');

        const row = await getDatabase().mutationQueue.get(id);
        expect(row?.status).toBe('REJECTED_USER_REVIEW');
        expect(row?.lastError).toBe('CLIENT_TOO_OLD');
        expect(row?.retryCount).toBe(3);
    });

    it('markRejectedDropped flips REJECTED_USER_REVIEW → REJECTED_DROPPED', async () => {
        const queue = MutationQueue.getInstance();
        const id = await seedRow('REJECTED_USER_REVIEW');

        await queue.markRejectedDropped(id);

        const row = await getDatabase().mutationQueue.get(id);
        expect(row?.status).toBe('REJECTED_DROPPED');
    });

    it('getPending excludes durable REJECTED rows (auto-retry isolation)', async () => {
        const queue = MutationQueue.getInstance();
        await seedRow('PENDING', { clientRequestId: 'req-pending' });
        await seedRow('REJECTED_USER_REVIEW', { clientRequestId: 'req-review' });
        await seedRow('REJECTED_DROPPED', { clientRequestId: 'req-dropped' });
        await seedRow('FAILED', { clientRequestId: 'req-failed' });
        await seedRow('APPLIED', { clientRequestId: 'req-applied' });

        const pending = await queue.getPending();
        const ids = pending.map(p => p.clientRequestId).sort();
        expect(ids).toEqual(['req-pending']);
    });

    it('getRejectedUserReview returns ONLY REJECTED_USER_REVIEW rows (excludes FAILED, REJECTED_DROPPED, etc.)', async () => {
        const queue = MutationQueue.getInstance();
        await seedRow('PENDING', { clientRequestId: 'req-pending' });
        await seedRow('FAILED', { clientRequestId: 'req-failed' });
        await seedRow('REJECTED_USER_REVIEW', { clientRequestId: 'req-review-1', lastError: 'A' });
        await seedRow('REJECTED_USER_REVIEW', { clientRequestId: 'req-review-2', lastError: 'B' });
        await seedRow('REJECTED_DROPPED', { clientRequestId: 'req-dropped' });
        await seedRow('APPLIED', { clientRequestId: 'req-applied' });

        const review = await queue.getRejectedUserReview();
        const ids = review.map(r => r.clientRequestId).sort();
        expect(ids).toEqual(['req-review-1', 'req-review-2']);
    });
});
