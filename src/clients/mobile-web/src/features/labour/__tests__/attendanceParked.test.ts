// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 9 (B001, spec: 2026-08-28-labour-v2-release-1) — the client half of
 * the contradiction-answer loop, which did not exist: the server parks an
 * attendance.mark with ShramSafal.AttendanceContradiction and the ANSWER
 * travels back as `resolvedLabourAssignmentId` — written, before this task,
 * by NOBODY.
 *
 * Real worker, real MutationQueue, REAL payload validator (the resolution
 * payload must satisfy the actual attendance_mark zod, not a mock's nod),
 * real Dexie over fake-indexeddb. Only the network boundary is mocked — the
 * MutationRetryCap.transport idiom.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-09-02T09:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-09-02T09:00:00.000Z',
        nextCursorUtc: '2026-09-02T09:00:00.000Z',
        farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [],
        costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [],
        plannedActivities: [], auditEvents: [],
    }),
}));

vi.mock('../../../infrastructure/api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../../infrastructure/api/AgriSyncClient')>('../../../infrastructure/api/AgriSyncClient');
    return { ...actual, agriSyncClient: { pushSyncBatch: pushBatchMock, pullSyncChanges: pullChangesMock } };
});
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'test-user', accessToken: 'test', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));
vi.mock('../../../infrastructure/sync/SyncPullReconciler', () => ({ reconcileSyncPull: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../infrastructure/sync/AiJobWorker', () => ({ AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../../app/state/RootStore', () => ({ getRootStore: () => ({ sync: { send: vi.fn() } }) }));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { MarkAttendanceCommand, type AttendanceMarkPayload } from '../../../application/usecases/sync/MarkAttendanceCommand';
import {
    listParkedAttendanceContradictions,
    buildContradictionQuestion,
    answerAttendanceContradiction,
} from '../data/attendanceParked';
import type { DailyLog } from '../../../types';

const FARM = '22222222-2222-2222-2222-222222222222';
const GANESH = '33333333-3333-3333-3333-333333333333';
const MARK_ID = '11111111-1111-1111-1111-111111111111';
const WORK_DATE = '2026-09-02';
const ASSIGNMENT_FULL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ASSIGNMENT_NIGHT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function freshDb() {
    const db = getDatabase();
    try { await db.delete(); } catch { /* first run */ }
    await resetDatabase();
}

/** Push responder: refuse every attendance.mark with the contradiction. */
function contradictionResponse(request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) {
    return {
        serverTimeUtc: FROZEN_NOW_ISO,
        results: request.mutations.map((m) => ({
            clientRequestId: m.clientRequestId,
            mutationType: m.mutationType,
            status: 'failed' as const,
            errorCode: 'ShramSafal.AttendanceContradiction',
            errorMessage: 'Two of today\'s works claim different attendance for this person. Answer in Labour, then it will sync.',
        })),
    };
}

/** A minimal local log carrying attributed engagements — the pull carriage shape. */
function logWith(engagements: Array<{ id: string; shiftId: string; name: string }>): DailyLog {
    return {
        id: 'log-1',
        date: WORK_DATE,
        meta: { farmId: FARM },
        labour: engagements.map((e) => ({
            id: e.id,
            labourAssignmentId: e.id,
            type: 'HIRED',
            shiftId: e.shiftId,
            workerNames: [e.name],
            attributedOperators: [{ fieldOperatorId: GANESH, displayNameAtAttach: e.name }],
        })),
    } as unknown as DailyLog;
}

async function parkOneMark(): Promise<void> {
    await MarkAttendanceCommand.enqueue({
        attendanceMarkId: MARK_ID, farmId: FARM, fieldOperatorId: GANESH,
        workDate: WORK_DATE, dayMark: 'Full',
    });
    pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => contradictionResponse(request));
    await backgroundSyncWorker.triggerNow();
}

describe('the parked contradiction — listed by CODE, never by prose', () => {
    beforeEach(async () => {
        await freshDb();
        pushBatchMock.mockReset();
    });

    it('the worker park persists the server error code on the queue row', async () => {
        await parkOneMark();
        const row = await getDatabase().mutationQueue
            .where('mutationType').equals(SyncMutationName.AttendanceMark).first();
        expect(row?.status).toBe('REJECTED_USER_REVIEW');
        expect(row?.errorCode).toBe('ShramSafal.AttendanceContradiction');
    });

    it('lists the contradiction park for its farm', async () => {
        await parkOneMark();
        const parks = await listParkedAttendanceContradictions(FARM);
        expect(parks).toHaveLength(1);
        expect(parks[0].payload.fieldOperatorId).toBe(GANESH);
        expect(parks[0].payload.workDate).toBe(WORK_DATE);
    });

    it('does NOT list a park with a different code — that is a different question', async () => {
        await MarkAttendanceCommand.enqueue({
            attendanceMarkId: MARK_ID, farmId: FARM, fieldOperatorId: GANESH,
            workDate: WORK_DATE, dayMark: 'Full',
        });
        pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
            serverTimeUtc: FROZEN_NOW_ISO,
            results: request.mutations.map((m) => ({
                clientRequestId: m.clientRequestId, mutationType: m.mutationType,
                status: 'failed' as const,
                errorCode: 'ShramSafal.SyncInvalidPayload',
                errorMessage: 'attendance.mark payload contains unsupported fields.',
            })),
        }));
        await backgroundSyncWorker.triggerNow();

        expect(await listParkedAttendanceContradictions(FARM)).toHaveLength(0);
    });
});

describe('the question — rebuilt from local facts, or not at all', () => {
    beforeEach(async () => {
        await freshDb();
        pushBatchMock.mockReset();
    });

    it('carries the snapshot name and one fact per engagement when the facts disagree', async () => {
        await parkOneMark();
        const [park] = await listParkedAttendanceContradictions(FARM);
        const question = buildContradictionQuestion(park, [logWith([
            { id: ASSIGNMENT_FULL, shiftId: 'Full', name: 'गणेश' },
            { id: ASSIGNMENT_NIGHT, shiftId: 'Night', name: 'गणेश' },
        ])]);
        expect(question).not.toBeNull();
        expect(question!.name).toBe('गणेश');
        expect(question!.facts).toEqual([
            { shift: 'full', labourAssignmentId: ASSIGNMENT_FULL },
            { shift: 'night', labourAssignmentId: ASSIGNMENT_NIGHT },
        ]);
    });

    it('fabricates NO question when local facts cannot reproduce the disagreement', async () => {
        await parkOneMark();
        const [park] = await listParkedAttendanceContradictions(FARM);
        // one fact only — Distinct > 1 is the server's own rule
        expect(buildContradictionQuestion(park, [logWith([
            { id: ASSIGNMENT_FULL, shiftId: 'Full', name: 'गणेश' },
        ])])).toBeNull();
        // no history at all
        expect(buildContradictionQuestion(park, [])).toBeNull();
    });

    it('ignores another farm\'s logs — the strict farm filter', async () => {
        await parkOneMark();
        const [park] = await listParkedAttendanceContradictions(FARM);
        const foreign = logWith([
            { id: ASSIGNMENT_FULL, shiftId: 'Full', name: 'गणेश' },
            { id: ASSIGNMENT_NIGHT, shiftId: 'Night', name: 'गणेश' },
        ]);
        (foreign.meta as { farmId?: string }).farmId = '99999999-9999-9999-9999-999999999999';
        expect(buildContradictionQuestion(park, [foreign])).toBeNull();
    });
});

describe('the answer — replacePayload, speaking ONLY the halves the ruling decides (B002)', () => {
    beforeEach(async () => {
        await freshDb();
        pushBatchMock.mockReset();
    });

    it('re-enqueues the parked row with resolvedLabourAssignmentId and the decided half, nothing else', async () => {
        await parkOneMark();
        const [park] = await listParkedAttendanceContradictions(FARM);

        const answered = await answerAttendanceContradiction(park, { shift: 'night', labourAssignmentId: ASSIGNMENT_NIGHT });
        expect(answered).toBe(true);

        const row = await getDatabase().mutationQueue
            .where('mutationType').equals(SyncMutationName.AttendanceMark).first();
        expect(row?.status).toBe('PENDING'); // the park is cleared BY the re-enqueue — one atomic method
        const payload = row?.payload as AttendanceMarkPayload;
        // EXACT key set: identity + the one decided half + the answer. The
        // unspoken dayMark is ABSENT — the server amend preserves the stored
        // half; restating it here would be this door claiming a half it did
        // not just rule on.
        expect(payload).toEqual({
            attendanceMarkId: MARK_ID,
            farmId: FARM,
            fieldOperatorId: GANESH,
            workDate: WORK_DATE,
            nightMark: 'Worked',
            resolvedLabourAssignmentId: ASSIGNMENT_NIGHT,
        });
    });

    it('a full-day ruling travels as dayMark alone', async () => {
        await parkOneMark();
        const [park] = await listParkedAttendanceContradictions(FARM);

        await answerAttendanceContradiction(park, { shift: 'full', labourAssignmentId: ASSIGNMENT_FULL });

        const row = await getDatabase().mutationQueue
            .where('mutationType').equals(SyncMutationName.AttendanceMark).first();
        expect(row?.payload).toEqual({
            attendanceMarkId: MARK_ID, farmId: FARM, fieldOperatorId: GANESH, workDate: WORK_DATE,
            dayMark: 'Full', resolvedLabourAssignmentId: ASSIGNMENT_FULL,
        });
    });

    it('an answered park no longer lists — the question is gone, the mark stays visible as intent', async () => {
        await parkOneMark();
        const [park] = await listParkedAttendanceContradictions(FARM);
        await answerAttendanceContradiction(park, { shift: 'full', labourAssignmentId: ASSIGNMENT_FULL });
        expect(await listParkedAttendanceContradictions(FARM)).toHaveLength(0);
    });
});
