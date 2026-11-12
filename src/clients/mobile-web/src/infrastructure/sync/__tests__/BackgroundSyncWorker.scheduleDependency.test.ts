// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b fix round 1, P003; D-83 = 1, P9, P10)
 *
 * The `schedule.edit` that writes a new schedule's stages depends on the `schedule.create` / `schedule.clone` queued just before it (the contract has no
 * "create with stages"). It must never be JUDGED or CHARGED before its parent's fate is known:
 *   - the parent was refused for good (parked): the edit is parked too, with the PARENT'S code (so it has the same words, not a second wordless card),
 *     and it is never sent;
 *   - the parent is still on its way (waiting, backing off, failed below the cap): the edit waits, uncharged, and is not sent ahead of it;
 *   - the parent was accepted: the edit runs as any change.
 * The same "third failure class" as a log refused for its parent (`BackgroundSyncWorker.dependencyPending.test.ts`); the lookup is keyed by the parent's
 * derivable outbox key (`schedule.create:<id>` / `schedule.clone:<id>` / `schedule.edit:<id>`), so no Dexie bump and no new queue field.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDatabase, resetDatabase, type MutationQueueStatus } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-11-12T09:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-11-12T09:00:00.000Z', nextCursorUtc: '2026-11-12T09:00:00.000Z',
        farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [],
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
vi.mock('../AiJobWorker', () => ({ AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue } from '../MutationQueue';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { SyncMutationName } from '../SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../retryCap';
import { resolveScheduleDependency } from '../MutationDependency';

const FARM = '22222222-2222-4222-8222-222222222222';
const SCHEDULE = '33333333-3333-4333-8333-333333333333';
const NEXT = '44444444-4444-4444-8444-444444444444';
const CREATE_KEY = `${SyncMutationName.ScheduleCreate}:${SCHEDULE}`;
const EDIT_KEY = `${SyncMutationName.ScheduleEdit}:${NEXT}`;

async function seedRow(clientRequestId: string, mutationType: string, payload: unknown, status: MutationQueueStatus, extra: Record<string, unknown> = {}) {
    await getDatabase().mutationQueue.add({
        deviceId: mutationQueue.getDeviceId(), clientRequestId, clientCommandId: clientRequestId, mutationType, payload, status,
        createdAt: FROZEN_NOW_ISO, updatedAt: FROZEN_NOW_ISO, retryCount: 0, ...extra,
    } as never);
}
const seedCreate = (status: MutationQueueStatus, extra: Record<string, unknown> = {}) =>
    seedRow(CREATE_KEY, SyncMutationName.ScheduleCreate, { scheduleTemplateId: SCHEDULE, farmId: FARM, cropKey: 'grape', name: 'माझं' }, status, extra);
const seedEdit = (status: MutationQueueStatus = 'PENDING') =>
    seedRow(EDIT_KEY, SyncMutationName.ScheduleEdit, { scheduleTemplateId: SCHEDULE, newScheduleTemplateId: NEXT, farmId: FARM, stages: [{ name: 'अ', startDay: 0, endDay: 9 }] }, status);
const read = async (key: string) => getDatabase().mutationQueue.where('[deviceId+clientRequestId]').equals([mutationQueue.getDeviceId(), key]).first();
const sentKeys = () => pushBatchMock.mock.calls.flatMap(call => (call[0] as { mutations: Array<{ clientRequestId: string }> }).mutations.map(m => m.clientRequestId));

type Answer = (m: { clientRequestId: string; mutationType: string }) => { status: 'applied' | 'failed'; errorCode?: string; errorMessage?: string };
function respond(answer: Answer) {
    pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
        serverTimeUtc: FROZEN_NOW_ISO,
        results: request.mutations.map(m => ({ clientRequestId: m.clientRequestId, mutationType: m.mutationType, ...answer(m) })),
    }));
}
const NOT_FOUND = { status: 'failed' as const, errorCode: 'ShramSafal.ScheduleTemplateNotFound', errorMessage: 'Schedule template was not found.' };

beforeEach(async () => {
    const db = getDatabase();
    try { await db.delete(); } catch { /* ignore */ }
    await resetDatabase();
    pushBatchMock.mockReset();
});

describe('the create is parked for good: the edit is parked with the create\'s words, uncharged, never sent', () => {
    it('Both_in_one_batch: the create is refused (Forbidden-like shape error), the edit gets NotFound and is parked with the CREATES code', async () => {
        await seedCreate('PENDING');
        await seedEdit('PENDING');
        respond(m => (m.mutationType === SyncMutationName.ScheduleCreate
            ? { status: 'failed', errorCode: 'ShramSafal.ScheduleCropNotOnFarm', errorMessage: 'This farm has no season of that crop.' }
            : NOT_FOUND));
        await backgroundSyncWorker.triggerNow();
        const create = await read(CREATE_KEY);
        const edit = await read(EDIT_KEY);
        expect(create?.status).toBe('REJECTED_USER_REVIEW');
        expect(edit?.status).toBe('REJECTED_USER_REVIEW');
        expect(edit?.errorCode).toBe('ShramSafal.ScheduleCropNotOnFarm');
        expect(edit?.retryCount).toBe(1); // markRejectedUserReview's own +1 (a parked row), never five charged NotFounds
    });

    it('The_create_was_parked_in_an_earlier_cycle: the edit is parked WITHOUT being sent', async () => {
        await seedCreate('REJECTED_USER_REVIEW', { errorCode: 'ShramSafal.ScheduleMadeFor', lastError: 'x' });
        await seedEdit('PENDING');
        respond(() => ({ status: 'applied' }));
        await backgroundSyncWorker.triggerNow();
        expect(sentKeys()).not.toContain(EDIT_KEY);
        const edit = await read(EDIT_KEY);
        expect(edit?.status).toBe('REJECTED_USER_REVIEW');
        expect(edit?.errorCode).toBe('ShramSafal.ScheduleMadeFor');
    });

    it('A_create_that_is_STUCK_at_the_cap_parks_the_edit_too_(nothing_will_move_it_without_a_tap)', async () => {
        await seedCreate('FAILED', { retryCount: MAX_AUTO_RETRY_COUNT, nextRetryAfterMs: Date.now() + 3_600_000 });
        await seedEdit('PENDING');
        respond(() => ({ status: 'applied' }));
        await backgroundSyncWorker.triggerNow();
        expect(sentKeys()).not.toContain(EDIT_KEY);
        const edit = await read(EDIT_KEY);
        expect(edit?.status).toBe('REJECTED_USER_REVIEW');
        expect(edit?.lastError).toMatch(/DEPENDENCY_SCHEDULE_UNRESOLVED/);
        expect(edit?.errorCode).toBe('DEPENDENCY_SCHEDULE_UNRESOLVED');
    });
});

describe('the create is still on its way: the edit waits, uncharged, and does not run first', () => {
    it('Create_in_backoff_(FAILED_below_the_cap): the edit is not sent, not charged, and stays waiting', async () => {
        await seedCreate('FAILED', { retryCount: 1, nextRetryAfterMs: Date.now() + 3_600_000 });
        await seedEdit('PENDING');
        respond(() => NOT_FOUND);
        await backgroundSyncWorker.triggerNow();
        expect(sentKeys()).not.toContain(EDIT_KEY);
        const edit = await read(EDIT_KEY);
        expect(edit?.retryCount).toBe(0);
        expect(['PENDING', 'FAILED']).toContain(edit?.status);
        expect(edit?.status).not.toBe('REJECTED_USER_REVIEW');
    });

    it('Create_refused_for_a_retryable_reason_in_the_SAME_batch: the edit gets NotFound and waits uncharged (the reactive path); the create alone is charged', async () => {
        await seedCreate('PENDING');
        await seedEdit('PENDING');
        respond(m => (m.mutationType === SyncMutationName.ScheduleCreate
            ? { status: 'failed', errorCode: 'ShramSafal.SomethingTransient', errorMessage: 'try later' }
            : NOT_FOUND));
        await backgroundSyncWorker.triggerNow();
        const create = await read(CREATE_KEY);
        const edit = await read(EDIT_KEY);
        expect(create?.status).toBe('FAILED');
        expect(create?.retryCount).toBe(1);
        expect(edit?.status).toBe('FAILED');
        expect(edit?.retryCount).toBe(0);
        expect(edit?.lastError).toMatch(/not counted/i);
    });
});

describe('the create is accepted: the edit runs normally', () => {
    it('Both_pending_in_one_batch_and_both_applied', async () => {
        await seedCreate('PENDING');
        await seedEdit('PENDING');
        respond(() => ({ status: 'applied' }));
        await backgroundSyncWorker.triggerNow();
        expect((await read(CREATE_KEY))?.status).toBe('APPLIED');
        expect((await read(EDIT_KEY))?.status).toBe('APPLIED');
        expect(sentKeys()).toEqual([CREATE_KEY, EDIT_KEY]);
    });

    it('The_create_already_APPLIED: a NotFound about the edit is NOT read as a dependency (the old rule stands: retryable, charged)', async () => {
        await seedCreate('APPLIED');
        await seedEdit('PENDING');
        respond(() => NOT_FOUND);
        await backgroundSyncWorker.triggerNow();
        const edit = await read(EDIT_KEY);
        expect(edit?.status).toBe('FAILED');
        expect(edit?.retryCount).toBe(1);
    });

    it('An_edit_of_a_version_that_has_no_row_here_(it_came_from_the_pull)_is_no_dependency_at_all', async () => {
        await seedEdit('PENDING');
        respond(() => NOT_FOUND);
        await backgroundSyncWorker.triggerNow();
        expect((await read(EDIT_KEY))?.retryCount).toBe(1);
    });
});

describe('resolveScheduleDependency (the keyed lookup)', () => {
    const payload = { scheduleTemplateId: SCHEDULE, newScheduleTemplateId: NEXT };
    it('Finds_a_create_a_clone_or_an_edit_by_its_derivable_key', async () => {
        const device = mutationQueue.getDeviceId();
        await seedRow(`${SyncMutationName.ScheduleClone}:${SCHEDULE}`, SyncMutationName.ScheduleClone, { newScheduleTemplateId: SCHEDULE }, 'PENDING');
        expect((await resolveScheduleDependency(device, SyncMutationName.ScheduleEdit, payload)).disposition).toBe('PARENT_IN_PROGRESS');
    });
    it('Answers_nothing_for_a_mutation_that_is_not_an_edit', async () => {
        await seedCreate('REJECTED_USER_REVIEW', { errorCode: 'x' });
        expect((await resolveScheduleDependency(mutationQueue.getDeviceId(), SyncMutationName.AdoptSchedule, payload)).disposition).toBe('NOT_A_DEPENDENCY');
    });
    it('Carries_the_parents_code_when_it_is_parked', async () => {
        await seedCreate('REJECTED_USER_REVIEW', { errorCode: 'ShramSafal.ScheduleMadeFor' });
        const verdict = await resolveScheduleDependency(mutationQueue.getDeviceId(), SyncMutationName.ScheduleEdit, payload);
        expect(verdict).toMatchObject({ disposition: 'PARENT_UNRECOVERABLE', parentKind: 'schedule', parentErrorCode: 'ShramSafal.ScheduleMadeFor' });
    });
});
