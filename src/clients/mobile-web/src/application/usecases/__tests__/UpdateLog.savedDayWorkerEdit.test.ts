/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LABOUR V2 R1, Task 23 — ADDING OR REMOVING WORKERS ON AN ALREADY-SAVED DAY.
 *
 * spec: 2026-08-28-labour-v2-release-1
 *
 * THE REPORTED DEFECT, in the founder's words: "the मुकादम says four more came
 * in the evening. The owner adds them, gets a green 'saved' confirmation, and
 * within one sync those four are deleted from his phone."
 *
 * WHAT IS ACTUALLY TRUE, AND IS NOT CHANGED BY THIS TASK. Nothing in this
 * system can add or remove a labour engagement on a day that is already on the
 * server:
 *
 *   - `buildLabourCorrections` skips an engagement it has never seen before
 *     (`UpdateLog.ts`, "a newly added or fully removed engagement is not a
 *     correction of an existing one"), and it only ever WALKS `finalLog`, so a
 *     removed one is not mentioned to the server either.
 *   - The edit branch enqueues no sync mutation of any kind (12b.7b deleted the
 *     only one), and `PushSyncBatchHandler`'s mutation list carries no
 *     add/remove-engagement case — `create_daily_log` carries `labour` at
 *     CREATION and nowhere else.
 *   - `CorrectLabourCommand` can correct the quantity, duration and attribution
 *     of an EXISTING assignment. It cannot create one and it cannot delete one.
 *
 * So the change is written to `db.logs` and reverted by the next pull. That is
 * asserted here rather than wished away.
 *
 * WHAT THIS TASK CHANGES IS THE CLAIM. `updateLog` already reported
 * `hasUnsentChanges` — "something here reached no server". That is TRUE and it
 * is not enough, because the toast built from it still leads with
 * `sync.onPhone` ("लक्षात ठेवलं ✓"), which is a claim about the HANDSET, and
 * for this particular shape of edit the handset does not keep it either. So the
 * use case now also reports whether the edit changed WHICH engagements the day
 * has — the one shape whose local write does not survive — and the wording
 * layer drops the phone claim for it (`saveToastMessages`).
 *
 * REAL Dexie and the REAL repository — a mock cannot prove what a reload sees.
 *
 * THE RECONCILER IS DELIBERATELY NOT IMPORTED HERE, and that is not a gap being
 * glossed. `reconcileLogs` pulls in the `sync-contract` package, whose `zod`
 * import fails to resolve in this workspace — the same pre-existing breakage
 * that stops `UpdateLog.convergence.test.ts` (and 25 sibling files) from
 * LOADING at all. A proof that cannot run is not a proof, so the deletion is
 * established from the source instead, and the source is unambiguous:
 * `logsReconciler.resolveLabour` (`:478-492`) returns the SERVER's engagement
 * list whole whenever it is non-empty, replacing whatever the handset holds.
 * The same function's own remarks name the reason this task cannot be fixed
 * rather than blocked — "if a labour engagement is ever removed server-side, by
 * a removal feature THAT DOES NOT EXIST YET".
 *
 * What IS proved here mechanically is the other half, and it is the half the
 * confirmation is built on: the edit reaches no server by any route.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockEnqueue = vi.fn();
vi.mock('../../../infrastructure/sync/MutationQueue', () => ({
    mutationQueue: { enqueue: (...args: unknown[]) => mockEnqueue(...args) },
}));

const mockPostCorrection = vi.fn();
vi.mock('../../../features/labour/data/labourCorrectionsClient', () => ({
    postLabourCorrection: (...args: unknown[]) => mockPostCorrection(...args),
}));

// The SAME three-function stub `UpdateLog.test.ts` uses, and for the same
// reason: the real module reaches the `sync-contract` package, whose `zod`
// import does not resolve in this workspace and takes any file that touches it
// out of the run entirely. `wholeOrOmitted` / `finiteOrOmitted` are reproduced
// exactly (omit-don't-coerce), because `buildLabourCorrections` depends on them
// to decide what travels.
const mockResolveFarmId = vi.fn();
vi.mock('../../../features/logs/services/logSyncMutationService', () => ({
    resolveLogFarmId: (...args: unknown[]) => mockResolveFarmId(...args),
    wholeOrOmitted: (value: number | undefined) =>
        typeof value === 'number' && Number.isInteger(value) ? value : undefined,
    finiteOrOmitted: (value: number | undefined) =>
        typeof value === 'number' && Number.isFinite(value) ? value : undefined,
}));

import { updateLog } from '../UpdateLog';
import { DexieLogsRepository } from '../../../infrastructure/storage/DexieLogsRepository';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { DailyLog, LabourEvent } from '../../../types';
import type { FarmerProfile } from '../../../domain/types/farm.types';

const FARM = 'f1f1f1f1-1111-4111-8111-111111111111';
const PLOT_A = 'aaaa1111-1111-4111-8111-111111111111';
const LOG = '09090909-0000-4000-8000-000000000000';
const MORNING = 'e1e1e1e1-1111-4111-8111-111111111111';
const EVENING = 'e2e2e2e2-2222-4222-8222-222222222222';

const repo = DexieLogsRepository.getInstance();
const actor = { id: 'user-1' } as unknown as FarmerProfile;

const labour = (over: Partial<LabourEvent> = {}): LabourEvent => ({
    id: 'l1',
    type: 'HIRED',
    labourAssignmentId: MORNING,
    count: 8,
    activity: 'छाटणी',
    ...over,
} as LabourEvent);

/** The four who came in the evening — a SECOND engagement, not a bigger first one. */
const evening = (): LabourEvent => labour({
    id: 'l2',
    labourAssignmentId: undefined,
    count: 4,
    activity: 'बांधणी',
});

const makeLog = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: LOG,
    date: '2026-08-13',
    context: {
        selection: [{
            cropId: 'c1', cropName: 'Grapes',
            selectedPlotIds: [PLOT_A], selectedPlotNames: ['Plot'],
        }],
    },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [labour()],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
    meta: { createdAtISO: '2026-08-13T04:00:00.000Z', createdByOperatorId: 'op1', farmId: FARM },
    ...over,
} as unknown as DailyLog);

const submit = (updatedData: Partial<DailyLog>, reason = 'संध्याकाळी आणखी चार आले') =>
    updateLog({ logId: LOG, updatedData, actorId: 'mukadam-7', reason }, repo, actor);

beforeEach(async () => {
    const db = getDatabase();
    await Promise.all([
        db.logs.clear(), db.plots.clear(), db.farms.clear(),
        db.auditEvents.clear(), db.outbox.clear(),
    ]);
    vi.clearAllMocks();
    mockResolveFarmId.mockResolvedValue(FARM);
    mockPostCorrection.mockResolvedValue({
        labourAssignmentId: MORNING,
        workerCount: 6,
        maleCount: null,
        femaleCount: null,
        durationHours: 8,
        timeBasis: 'Assumed',
        attributedFieldOperatorIds: [],
        correctionsRecorded: 1,
        alreadyApplied: false,
    });

    const now = '2026-08-13T00:00:00.000Z';
    await db.farms.put({ id: FARM, payload: { id: FARM }, updatedAt: now });
    await db.plots.put({
        id: PLOT_A, farmId: FARM, payload: { id: PLOT_A, farmId: FARM }, updatedAt: now,
    });
});

// ---------------------------------------------------------------------------
// 1. The defect itself: the four are written to the handset and addressed to
//    nothing. Both halves of "sent nowhere" are checked — the direct correction
//    POST and the sync queue — because either one alone would leave the other
//    as an unexamined escape hatch.
// ---------------------------------------------------------------------------

describe('four more came in the evening', () => {
    it('is written to the phone and addressed to no server, by any route', async () => {
        await repo.batchSave([makeLog()]);

        const existing = await repo.getById(LOG) as DailyLog;
        const result = await submit({ ...existing, labour: [labour(), evening()] });

        expect(result.success).toBe(true);
        // Not a correction: the four are not a change to an engagement the
        // server already holds, so `buildLabourCorrections` skips them.
        expect(mockPostCorrection).not.toHaveBeenCalled();
        // And not a queued mutation either — the edit branch enqueues nothing,
        // so no worker will ever pick this up and no retry can exist. "will
        // not", not "not yet".
        expect(mockEnqueue).not.toHaveBeenCalled();
        // They ARE on the phone. This is the moment the farmer is shown a
        // confirmation, and it is the only moment at which it is true.
        expect((await repo.getById(LOG))!.labour).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// 2. The evidence the confirmation needs. `hasUnsentChanges` says the SERVER
//    was not told; this says the HANDSET will not keep it either, which is the
//    half the phone claim is made on.
// ---------------------------------------------------------------------------

describe('updateLog reports when the phone will not keep the edit', () => {
    it('flags an ADDED engagement', async () => {
        const existing = makeLog();
        await repo.batchSave([existing]);

        const result = await submit({ ...existing, labour: [labour(), evening()] });

        expect(result.success).toBe(true);
        expect(result.labourEngagementSetChanged).toBe(true);
    });

    it('flags a REMOVED engagement — the wrong headcount the owner wants gone', async () => {
        // The reverse report: a headcount recorded in error. It is removed from
        // the form, removed from `db.logs`, mentioned to no server, and restored
        // by the next pull. Nothing in this system can delete a labour
        // engagement, so the app must not imply that this one is gone.
        const existing = makeLog({ labour: [labour(), labour({ id: 'l2', labourAssignmentId: EVENING, count: 4 })] });
        await repo.batchSave([existing]);

        const result = await submit({ ...existing, labour: [labour()] }, 'ही नोंद चुकीची होती');

        expect(result.success).toBe(true);
        expect(result.labourEngagementSetChanged).toBe(true);
    });

    it('does NOT flag a headcount correction, which genuinely does survive', async () => {
        // 8 -> 6 on the SAME engagement is the case the correction route was
        // built for: it reaches the server, comes back down, and the phone
        // claim over it is true. Over-reporting here would strip the
        // reassurance off the one labour edit that works.
        const existing = makeLog();
        await repo.batchSave([existing]);

        const result = await submit({ ...existing, labour: [labour({ count: 6 })] }, 'मोजून पाहिलं');

        expect(result.persistedLabourCorrections).toBe(1);
        expect(result.labourEngagementSetChanged).toBe(false);
    });

    it('does NOT flag an edit that leaves labour alone', async () => {
        const existing = makeLog();
        await repo.batchSave([existing]);

        const result = await submit(
            { ...existing, irrigation: [{ id: 'irr-1', method: 'Drip', durationHours: 3 }] } as Partial<DailyLog>,
            'ठिबक तीन तास',
        );

        // The irrigation half is unsent and the record still stands on the
        // phone — `hasUnsentChanges` covers that, and the phone claim stays.
        expect(result.hasUnsentChanges).toBe(true);
        expect(result.labourEngagementSetChanged).toBe(false);
    });
});
