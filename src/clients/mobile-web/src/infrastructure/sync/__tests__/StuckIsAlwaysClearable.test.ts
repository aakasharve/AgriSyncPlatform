// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T3 — THE acceptance criterion.
 *
 *   "No state may exist where the chip says `अडकलं — तपासा` and no reachable
 *    action can clear it."
 *
 * Telling a farmer their record is stuck and then handing them a dead button is
 * worse than the silence Phase 1 replaced — it is `P5` inverted, a fake working
 * feature wearing the costume of a truthful one.
 *
 * `deriveSyncHonestyState` has exactly THREE doors into `NEEDS_FIX`
 * (`syncHonestyState.ts:251-273`):
 *
 *   1. `failedUploads > 0`                        — an attachment past its cap
 *   2. a row in `REJECTED_USER_REVIEW`            — a durable server refusal
 *   3. a `FAILED` row at/over `MAX_AUTO_RETRY_COUNT`
 *
 * This file walks each of the three, in real Dexie, through the REAL production
 * read path (`readSyncEvidence` -> `deriveSyncHonestyState` — the same two calls
 * `SyncStatusService` makes on every liveQuery tick), performs the action a
 * farmer can actually reach from the UI, and asserts the chip goes quiet.
 *
 * If a fourth door is ever added to `deriveSyncHonestyState`, the enumeration
 * test at the bottom fails until it is walked here too.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-08-12T09:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-08-12T09:00:00.000Z',
        nextCursorUtc: '2026-08-12T09:00:00.000Z',
        farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [],
        costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [],
        plannedActivities: [], auditEvents: [],
    }),
}));

vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return { ...actual, agriSyncClient: { pushSyncBatch: pushBatchMock, pullSyncChanges: pullChangesMock } };
});

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'test-user', accessToken: 'test', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));

vi.mock('../SyncPullReconciler', () => ({ reconcileSyncPull: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../PayloadValidator', () => ({ validatePayload: vi.fn().mockReturnValue({ ok: true, errors: [] }) }));
vi.mock('../AiJobWorker', () => ({ AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) } }));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue, MAX_AUTO_RETRY_COUNT } from '../MutationQueue';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { SyncMutationName } from '../SyncMutationCatalog';
import { readSyncEvidence } from '../../storage/SyncStatusService';
import { deriveSyncHonestyState } from '../../../features/sync/status/syncHonestyState';
import { partitionOpenFailures, OPEN_FAILURE_STATUSES } from '../../../features/sync/status/stuckMutations';
import { getRootStore, resetRootStore } from '../../../app/state/RootStore';
import { ConflictResolutionService } from '../../../features/sync/conflict/ConflictResolutionService';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run — nothing to delete
    }
    await resetDatabase();
}

/** The exact pair of calls `SyncStatusService` makes to decide what to say. */
async function chipClaim() {
    const { evidence } = await readSyncEvidence();
    return deriveSyncHonestyState(evidence);
}

/** What the drawer would count and list, from the same array. */
async function drawerFailedSection() {
    const db = getDatabase();
    const openFailures = await db.mutationQueue.where('status').anyOf(...OPEN_FAILURE_STATUSES).toArray();
    const { stuck } = partitionOpenFailures(openFailures);
    const failedUploads = await db.uploadQueue.where('status').equals('failed').count();
    return { count: stuck.length + failedUploads, listed: stuck.length, rows: stuck };
}

async function seedCappedFailure(clientRequestId: string) {
    const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true }, { clientRequestId });
    const row = await getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]').equals([mutationQueue.getDeviceId(), requestId]).first();
    await getDatabase().mutationQueue.update(row!.id as number, {
        status: 'FAILED',
        retryCount: MAX_AUTO_RETRY_COUNT + 2,
        lastError: 'Network Error',
    });
    return requestId;
}

async function seedDurableRejection(clientRequestId: string) {
    const requestId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true }, { clientRequestId });
    const row = await getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]').equals([mutationQueue.getDeviceId(), requestId]).first();
    await mutationQueue.markRejectedUserReview(row!.id as number, 'CLIENT_TOO_OLD');
    return requestId;
}

/** Mirrors exactly what `AttachmentUploadWorker` writes when it gives up. */
async function seedFailedUpload(attachmentId: string) {
    const db = getDatabase();
    await db.attachments.add({
        id: attachmentId,
        farmId: 'farm-1',
        localPath: `/tmp/${attachmentId}.jpg`,
        originalFileName: `${attachmentId}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        status: 'failed',
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
        retryCount: 5,
        lastError: 'Attachment upload failed.',
    });
    await db.uploadQueue.add({
        attachmentId,
        status: 'failed',
        retryCount: 5,
        lastAttemptAt: FROZEN_NOW_ISO,
        nextAttemptAt: undefined,
        lastError: 'Attachment upload failed.',
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
    });
}

describe('every way the chip can say "stuck" has a door that opens', () => {
    beforeEach(async () => {
        await freshDb();
        resetRootStore();
        pushBatchMock.mockReset();
        pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
            serverTimeUtc: FROZEN_NOW_ISO,
            results: request.mutations.map(m => ({
                clientRequestId: m.clientRequestId,
                mutationType: m.mutationType,
                status: 'applied' as const,
            })),
        }));
    });

    afterEach(() => {
        backgroundSyncWorker.stop();
        resetRootStore();
    });

    it('DOOR 1 — a capped mutation: the chip shouts, "Retry All" clears it', async () => {
        await seedCappedFailure('req-door-1');
        expect(await chipClaim()).toBe('NEEDS_FIX');

        // The drawer can show the farmer what it is complaining about...
        const before = await drawerFailedSection();
        expect(before.count).toBe(1);
        expect(before.listed).toBe(before.count);

        // ...and the big obvious button is not a no-op.
        await backgroundSyncWorker.retryAllFailed();

        expect(await chipClaim()).not.toBe('NEEDS_FIX');
        expect((await drawerFailedSection()).count).toBe(0);
    });

    it('DOOR 1b — the per-row Retry beside it also still works', async () => {
        const requestId = await seedCappedFailure('req-door-1b');
        expect(await chipClaim()).toBe('NEEDS_FIX');

        await backgroundSyncWorker.retryFailed(requestId);

        expect(await chipClaim()).not.toBe('NEEDS_FIX');
    });

    it('DOOR 2 — a durable rejection SURVIVING A RESTART: badge rehydrates, conflict screen clears it', async () => {
        const requestId = await seedDurableRejection('req-door-2');

        // Second launch: fresh actor, nothing in memory.
        resetRootStore();
        expect(await chipClaim()).toBe('NEEDS_FIX');
        expect(getRootStore().sync.getSnapshot().context.rejectedMutations).toHaveLength(0);

        // Boot.
        await backgroundSyncWorker.rehydrateRejectedMutations();
        expect(getRootStore().sync.getSnapshot().context.rejectedMutations).toHaveLength(1);

        // The farmer follows the badge and resolves it.
        await ConflictResolutionService.retry(requestId);

        expect(await chipClaim()).not.toBe('NEEDS_FIX');
    });

    it('DOOR 2b — discarding from the conflict screen also quiets the chip', async () => {
        const requestId = await seedDurableRejection('req-door-2b');
        await backgroundSyncWorker.rehydrateRejectedMutations();

        await ConflictResolutionService.discard(requestId);

        // R10: an acknowledged loss is not a stuck state.
        expect(await chipClaim()).not.toBe('NEEDS_FIX');
    });

    it('DOOR 3 — a terminally failed photo upload: the chip shouts, "Retry All" re-queues it', async () => {
        await seedFailedUpload('att-door-3');
        expect(await chipClaim()).toBe('NEEDS_FIX');

        const result = await backgroundSyncWorker.retryAllFailed();

        expect(result.uploads).toBe(1);
        expect(await chipClaim()).not.toBe('NEEDS_FIX');

        // Re-queued, not merely relabelled: the upload worker picks up
        // `pending` and `retry_wait` only (`AttachmentUploadWorker.ts:132`).
        const queued = await getDatabase().uploadQueue.where('attachmentId').equals('att-door-3').first();
        expect(queued?.status).toBe('pending');
        expect(queued?.retryCount).toBe(0);
        expect(queued?.nextAttemptAt).toBeUndefined();
        expect((await getDatabase().attachments.get('att-door-3'))?.status).toBe('pending');
    });

    it('ALL THREE DOORS AT ONCE — one tap plus one conflict resolution clears everything', async () => {
        await seedCappedFailure('req-all-1');
        const rejectedId = await seedDurableRejection('req-all-2');
        await seedFailedUpload('att-all-3');
        expect(await chipClaim()).toBe('NEEDS_FIX');

        await backgroundSyncWorker.retryAllFailed();
        // Still shouting — and correctly so: the durable rejection is a real,
        // separate problem that "Retry All" deliberately does not pretend to
        // have fixed.
        expect(await chipClaim()).toBe('NEEDS_FIX');

        await backgroundSyncWorker.rehydrateRejectedMutations();
        expect(getRootStore().sync.getSnapshot().context.rejectedMutations).toHaveLength(1);
        await ConflictResolutionService.discard(rejectedId);

        expect(await chipClaim()).not.toBe('NEEDS_FIX');
    });

    it('the door the farmer is sent to is never empty — the count always has rows or uploads behind it', async () => {
        await seedCappedFailure('req-eyes-1');
        await seedDurableRejection('req-eyes-2');
        await seedFailedUpload('att-eyes-3');

        const section = await drawerFailedSection();
        expect(await chipClaim()).toBe('NEEDS_FIX');
        expect(section.count).toBe(3);
        expect(section.rows.map(r => r.remedy).sort()).toEqual(['NEEDS_REVIEW', 'RETRY']);
    });

    it('and a healthy device is never told to go check anything', async () => {
        await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { sample: true });
        await backgroundSyncWorker.triggerNow();

        expect(await chipClaim()).toBe('ON_SERVER');
        expect((await drawerFailedSection()).count).toBe(0);
    });
});

describe('the enumeration itself', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('NEEDS_FIX has exactly the three causes this file walks', () => {
        // A guard on the guard. If someone adds a fourth reason to shout at the
        // farmer, this fails and they must come back here and prove the fourth
        // one can also be cleared. `EMPTY_SYNC_EVIDENCE` + one nudge per field.
        const base = { rows: [], acknowledgedCount: 1, pendingUploads: 0, failedUploads: 0, pendingAiJobs: 0, unqueueableCount: 0 };

        const causes = [
            { name: 'failedUploads', claim: deriveSyncHonestyState({ ...base, failedUploads: 1 }) },
            { name: 'REJECTED_USER_REVIEW', claim: deriveSyncHonestyState({ ...base, rows: [{ status: 'REJECTED_USER_REVIEW', retryCount: 0 }] }) },
            { name: 'capped FAILED', claim: deriveSyncHonestyState({ ...base, rows: [{ status: 'FAILED', retryCount: MAX_AUTO_RETRY_COUNT }] }) },
        ];
        expect(causes.filter(c => c.claim === 'NEEDS_FIX').map(c => c.name)).toEqual([
            'failedUploads', 'REJECTED_USER_REVIEW', 'capped FAILED',
        ]);

        // Nothing else in the snapshot can produce it.
        const nonCauses = [
            deriveSyncHonestyState({ ...base }),
            deriveSyncHonestyState({ ...base, pendingUploads: 3 }),
            deriveSyncHonestyState({ ...base, pendingAiJobs: 3 }),
            deriveSyncHonestyState({ ...base, rows: [{ status: 'PENDING', retryCount: 0 }] }),
            deriveSyncHonestyState({ ...base, rows: [{ status: 'SENDING', retryCount: 0 }] }),
            deriveSyncHonestyState({ ...base, rows: [{ status: 'APPLIED', retryCount: 0 }] }),
            deriveSyncHonestyState({ ...base, rows: [{ status: 'REJECTED_DROPPED', retryCount: 0 }] }),
            deriveSyncHonestyState({ ...base, rows: [{ status: 'FAILED', retryCount: MAX_AUTO_RETRY_COUNT - 1 }] }),
            // C-1 added a new piece of evidence to the snapshot. It weakens the
            // claim to ON_PHONE and must NOT become a fourth door into the
            // alarm: a skipped log has no queue row, so no retry and no drawer
            // entry could clear it, and this file's whole promise is that
            // everything the chip shouts about is clearable.
            deriveSyncHonestyState({ ...base, unqueueableCount: 1 }),
        ];
        expect(nonCauses).not.toContain('NEEDS_FIX');
    });
});
