/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LABOUR_PHASE2 PHASE 4 — CONVERGENCE, end to end (§A7.1, journey L4).
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 *
 * "A farmer corrects 8 to 6, reloads, and sees 6. A second device sees 6.
 *  History still explains 8 to 6, with actor and time."
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `UpdateLog.test.ts`. That file proves the
 * use case CALLS `repo.save` — against a `vi.fn()`. A mock cannot prove a
 * reload: `repo.save` writes a `DexieLogRecord`, and the defect class this phase
 * keeps meeting is a write that lands in the wrong shape, drops a column, or is
 * undone by the next pull. So every assertion here goes through REAL Dexie
 * (fake-indexeddb), the REAL `DexieLogsRepository`, the REAL
 * `resolveLogFarmId` reading real seeded plot/farm rows, and the REAL
 * `reconcileLogs`. The only mock is the HTTP client, which is not this client's
 * to prove.
 *
 * "RELOAD" IS MODELLED AS `repo.getById` — the production read path. Nothing in
 * this file inspects `db.logs` directly to assert current truth; a test that
 * reads a private shape can pass while every screen shows the old number.
 *
 * "SECOND DEVICE" IS MODELLED THROUGH `reconcileLogs`, not by hand. Phase 3 made
 * `DailyLogDto.labour` real, so a second phone's copy is whatever the reconciler
 * writes from the server's projection. Asserting a hand-built record would prove
 * only that this test can build one.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPostCorrection = vi.fn();
vi.mock('../../../features/labour/data/labourCorrectionsClient', () => ({
    postLabourCorrection: (...args: unknown[]) => mockPostCorrection(...args),
}));

import { updateLog } from '../UpdateLog';
import { reconcileLogs } from '../../../features/sync/pull/reconcilers/logsReconciler';
import { DexieLogsRepository } from '../../../infrastructure/storage/DexieLogsRepository';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { DailyLog, LabourEvent } from '../../../types';
import type { FarmerProfile } from '../../../domain/types/farm.types';
import type {
    DailyLogDto,
    LabourEngagementDto,
    SyncPullResponse,
} from '../../../infrastructure/api/AgriSyncClient';

const FARM = 'f1f1f1f1-1111-4111-8111-111111111111';
const PLOT_A = 'aaaa1111-1111-4111-8111-111111111111';
const PLOT_B = 'bbbb2222-2222-4222-8222-222222222222';
const LOG = '0g0g0g0g-0000-4000-8000-000000000000'.replace(/g/g, '9');
const ENGAGEMENT = 'e1e1e1e1-1111-4111-8111-111111111111';

const repo = DexieLogsRepository.getInstance();
const actor = { id: 'user-1' } as unknown as FarmerProfile;

const labour = (over: Partial<LabourEvent> = {}): LabourEvent => ({
    id: 'l1',
    type: 'HIRED',
    labourAssignmentId: ENGAGEMENT,
    count: 8,
    activity: 'छाटणी',
    ...over,
} as LabourEvent);

/**
 * One log, in whichever of the three scopes the caller asks for. The scope IS
 * the plot set — `Farm` names none, `Plot` names one, `MultiPlot` names several
 * — which is exactly how `resolveLogFarmId` tells them apart.
 */
const makeLog = (plotIds: string[], over: Partial<DailyLog> = {}): DailyLog => ({
    id: LOG,
    date: '2026-08-13',
    context: {
        selection: plotIds.length === 0
            ? [{ cropId: 'FARM_GLOBAL', cropName: 'Farm', selectedPlotIds: [], selectedPlotNames: [] }]
            : [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: plotIds, selectedPlotNames: plotIds.map(() => 'Plot') }],
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
    financialSummary: {
        totalLabourCost: 3200, totalInputCost: 0, totalMachineryCost: 0,
        totalActivityExpenses: 0, grandTotal: 3200,
    },
    ...over,
} as unknown as DailyLog);

/** What the server projects back once it holds the corrected engagement. */
const engagementDto = (workerCount: number): LabourEngagementDto => ({
    labourAssignmentId: ENGAGEMENT,
    dailyLogId: LOG,
    engagementType: 'Hired',
    workerCount,
    maleCount: null,
    femaleCount: null,
    wagePerPerson: null,
    contractUnit: null,
    contractQuantity: null,
    totalCost: null,
    durationHours: 8,
    timeBasis: 'Assumed',
    shift: null,
    task: 'छाटणी',
    notes: null,
    workerNames: [],
    createdAtUtc: '2026-08-13T04:00:00.000Z',
    linkedActivityId: null,
    attributedOperators: [],
});

const logDto = (workerCount: number, over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id: LOG,
    farmId: FARM,
    plotId: PLOT_A,
    cropCycleId: 'cycle-1',
    operatorUserId: 'op1',
    logDate: '2026-08-13',
    createdAtUtc: '2026-08-13T04:00:00.000Z',
    modifiedAtUtc: '2026-08-13T06:00:00.000Z',
    plotIds: [PLOT_A],
    tasks: [],
    verificationEvents: [],
    labour: [engagementDto(workerCount)],
    ...over,
} as unknown as DailyLogDto);

const correct = (existing: DailyLog, to: number, reason = 'मोजून पाहिलं') =>
    updateLog(
        {
            logId: LOG,
            updatedData: { ...existing, labour: [labour({ count: to })] },
            actorId: 'mukadam-7',
            reason,
        },
        repo,
        actor,
    );

beforeEach(async () => {
    const db = getDatabase();
    await Promise.all([
        db.logs.clear(), db.plots.clear(), db.farms.clear(),
        db.auditEvents.clear(), db.outbox.clear(),
    ]);
    vi.clearAllMocks();
    mockPostCorrection.mockResolvedValue({
        labourAssignmentId: ENGAGEMENT,
        workerCount: 6,
        maleCount: null,
        femaleCount: null,
        durationHours: 8,
        timeBasis: 'Assumed',
        attributedFieldOperatorIds: [],
        correctionsRecorded: 1,
        alreadyApplied: false,
    });

    // Server-issued reference data, exactly as the pull writes it. The resolver
    // requires it: a plot or farm this device has not pulled makes the log
    // uncorrectable, by design.
    const now = '2026-08-13T00:00:00.000Z';
    await db.farms.put({ id: FARM, payload: { id: FARM }, updatedAt: now });
    await db.plots.bulkPut([
        { id: PLOT_A, farmId: FARM, payload: { id: PLOT_A, farmId: FARM }, updatedAt: now },
        { id: PLOT_B, farmId: FARM, payload: { id: PLOT_B, farmId: FARM }, updatedAt: now },
    ]);
});

// ---------------------------------------------------------------------------
// 1. The headline: 8 -> 6 -> reload -> 6.
// ---------------------------------------------------------------------------

describe('a correction survives a reload', () => {
    it('shows 6 through the production read path after correcting 8 to 6', async () => {
        const existing = makeLog([PLOT_A]);
        await repo.batchSave([existing]);
        expect((await repo.getById(LOG))!.labour[0].count).toBe(8);

        const result = await correct(existing, 6);

        expect(result.success).toBe(true);
        expect(result.persistedLabourCorrections).toBe(1);
        // THE reload. Not `db.logs.get` — the same call every screen makes.
        expect((await repo.getById(LOG))!.labour[0].count).toBe(6);
    });

    it('a refused correction leaves 8 on the phone, matching the server', async () => {
        mockPostCorrection.mockRejectedValue(new Error('Request failed with status code 403'));
        const existing = makeLog([PLOT_A]);
        await repo.batchSave([existing]);

        const result = await correct(existing, 6);

        expect(result.success).toBe(false);
        // The divergence this phase exists to end, pointed the other way: 6 on
        // the phone over 8 on the server would be self-inflicted.
        expect((await repo.getById(LOG))!.labour[0].count).toBe(8);
    });
});

// ---------------------------------------------------------------------------
// 2. All three scopes. `resolveLogFarmId` is real here and reads the seeded
//    rows, so this is the actual routing decision, not a stubbed one.
// ---------------------------------------------------------------------------

describe('correction works for Plot, MultiPlot and Farm logs', () => {
    it.each([
        ['Plot', [PLOT_A]],
        ['MultiPlot', [PLOT_A, PLOT_B]],
        ['Farm', [] as string[]],
    ])('%s: routes to the farm and the corrected value survives a reload', async (_scope, plotIds) => {
        const existing = makeLog(plotIds);
        await repo.batchSave([existing]);

        const result = await correct(existing, 6);

        expect(result.success).toBe(true);
        // The route the correction was addressed to. A farm-wide log used to
        // resolve to null here and every correction on one was refused.
        expect(mockPostCorrection).toHaveBeenCalledTimes(1);
        expect(mockPostCorrection.mock.calls[0][0]).toBe(FARM);
        expect(mockPostCorrection.mock.calls[0][1]).toBe(ENGAGEMENT);
        expect(mockPostCorrection.mock.calls[0][2].quantity).toEqual({ workerCount: 6 });
        expect((await repo.getById(LOG))!.labour[0].count).toBe(6);
    });

    it('a farm-wide log whose farm this device never pulled is refused, not guessed', async () => {
        await getDatabase().farms.clear();
        const existing = makeLog([]);
        await repo.batchSave([existing]);

        const result = await correct(existing, 6);

        expect(result.success).toBe(false);
        expect(mockPostCorrection).not.toHaveBeenCalled();
        expect((await repo.getById(LOG))!.labour[0].count).toBe(8);
    });

    it('a MultiPlot log keeps naming every plot it named, after the correction', async () => {
        // `P7`'s spatial twin: correcting a headcount must not quietly narrow
        // the record's own assertion about where the work happened.
        const existing = makeLog([PLOT_A, PLOT_B]);
        await repo.batchSave([existing]);

        await correct(existing, 6);

        const reloaded = await repo.getById(LOG);
        expect(reloaded!.context.selection[0].selectedPlotIds).toEqual([PLOT_A, PLOT_B]);
    });
});

// ---------------------------------------------------------------------------
// 3. The second device — asserted through the reconciler.
// ---------------------------------------------------------------------------

describe('a second device sees the corrected number', () => {
    it('a clean device reconstructs the log with 6, from the pull alone', async () => {
        const db = getDatabase();
        expect(await repo.getById(LOG)).toBeNull();

        await reconcileLogs(db, { dailyLogs: [logDto(6)] } as unknown as SyncPullResponse, new Map(), new Set());

        expect((await repo.getById(LOG))!.labour[0].count).toBe(6);
    });

    it('a device still holding 8 is corrected to 6 by the pull', async () => {
        const db = getDatabase();
        await repo.batchSave([makeLog([PLOT_A])]);

        await reconcileLogs(db, { dailyLogs: [logDto(6)] } as unknown as SyncPullResponse, new Map(), new Set());

        expect((await repo.getById(LOG))!.labour[0].count).toBe(6);
    });

    it('the pull does not undo a correction this device just made', async () => {
        // The corrected phone and the server now agree. The pull must land on 6
        // and stay on 6 — a reconciler that re-adopted a stale projection would
        // recreate §A7.1 one sync later.
        const existing = makeLog([PLOT_A]);
        await repo.batchSave([existing]);
        await correct(existing, 6);

        await reconcileLogs(
            getDatabase(),
            { dailyLogs: [logDto(6)] } as unknown as SyncPullResponse,
            new Map(), new Set(),
        );

        expect((await repo.getById(LOG))!.labour[0].count).toBe(6);
    });
});

// ---------------------------------------------------------------------------
// 4. `P3` — current truth and history are different things, held in different
//    places, and the everyday view reads only one of them.
// ---------------------------------------------------------------------------

describe('history explains 8 -> 6, and the everyday view does not consume it', () => {
    it('records the actor, the reason and the time in the audit ledger', async () => {
        const existing = makeLog([PLOT_A]);
        await repo.batchSave([existing]);
        await getDatabase().auditEvents.clear();

        await correct(existing, 6, 'मोजून पाहिलं');

        const events = await getDatabase().auditEvents.where('resourceId').equals(LOG).toArray();
        expect(events).toHaveLength(1);
        expect(events[0].actorId).toBe('mukadam-7');
        expect(events[0].details).toBe('मोजून पाहिलं');
        expect(Date.parse(events[0].timestamp)).not.toBeNaN();
    });

    it('the audit ledger is APPENDED to, never rewritten', async () => {
        const existing = makeLog([PLOT_A]);
        await repo.batchSave([existing]);
        await getDatabase().auditEvents.clear();

        await correct(existing, 6, 'first');
        await correct(await repo.getById(LOG) as DailyLog, 5, 'second');

        const events = await getDatabase().auditEvents.where('resourceId').equals(LOG).toArray();
        // As a SET, not a sequence: `where(...)` walks the `resourceId` index
        // and returns rows in primary-key order, and the primary key is a random
        // uuid. What is being asserted is that the second correction ADDED a row
        // rather than replacing the first one — order is the store's business.
        expect(events).toHaveLength(2);
        expect(new Set(events.map(event => event.details))).toEqual(new Set(['first', 'second']));
        expect((await repo.getById(LOG))!.labour[0].count).toBe(5);
    });

    it('the everyday read path returns current truth without touching the audit ledger', async () => {
        // `P3` in its structural form. `getAll` is what the ledger screens call;
        // if it ever started merging audit rows, a farmer's daily view would
        // become a diff log. `db.auditEvents` has no production reader at all
        // today, and this is the assertion that notices if that changes.
        const existing = makeLog([PLOT_A]);
        await repo.batchSave([existing]);
        await correct(existing, 6);

        const db = getDatabase();
        const auditSpy = vi.spyOn(db.auditEvents, 'where');
        const all = await repo.getAll();

        expect(all.find(log => log.id === LOG)!.labour[0].count).toBe(6);
        expect(auditSpy).not.toHaveBeenCalled();
        auditSpy.mockRestore();
    });

    it('a pull does not delete the local patch history a correction created', async () => {
        // `PatchEvent` is the before-snapshot taken when a VERIFIED log is
        // edited, and the wire has no field for it. Before Phase 4 no patch ever
        // reached Dexie; now one does, and the next pull carrying this log must
        // not erase it.
        const existing = makeLog([PLOT_A], {
            verification: { status: 'APPROVED', required: true },
        } as unknown as Partial<DailyLog>);
        await repo.batchSave([existing]);

        await correct(existing, 6);
        expect((await repo.getById(LOG))!.patches).toHaveLength(1);

        await reconcileLogs(
            getDatabase(),
            { dailyLogs: [logDto(6)] } as unknown as SyncPullResponse,
            new Map(), new Set(),
        );

        const reloaded = await repo.getById(LOG);
        expect(reloaded!.patches).toHaveLength(1);
        expect(reloaded!.patches![0].previousState.labour![0].count).toBe(8);
        expect(reloaded!.patches![0].actorId).toBe('mukadam-7');
    });
});

// ---------------------------------------------------------------------------
// 5. The sync watermark the local write must not erase.
// ---------------------------------------------------------------------------

describe('a local edit does not disarm the pull freshness guard', () => {
    it('keeps serverModifiedAtUtc, so a stale pull still cannot overwrite the edit', async () => {
        const db = getDatabase();
        // A log this device pulled at 06:00 and then corrected.
        await repo.batchSave([makeLog([PLOT_A])]);
        await reconcileLogs(db, { dailyLogs: [logDto(8)] } as unknown as SyncPullResponse, new Map(), new Set());
        expect((await db.logs.get(LOG))!.serverModifiedAtUtc).toBe('2026-08-13T06:00:00.000Z');

        const existing = await repo.getById(LOG) as DailyLog;
        await correct({ ...existing, irrigation: [{ id: 'irr-1', method: 'Drip', durationHours: 3 }] } as DailyLog, 6);

        expect((await db.logs.get(LOG))!.serverModifiedAtUtc).toBe('2026-08-13T06:00:00.000Z');

        // The same pull replayed says nothing new. It must be skipped whole —
        // otherwise it would rebuild the log and take the irrigation edit with
        // it, on a response that had no news about this log at all.
        await reconcileLogs(db, { dailyLogs: [logDto(8)] } as unknown as SyncPullResponse, new Map(), new Set());

        const reloaded = await repo.getById(LOG);
        expect(reloaded!.labour[0].count).toBe(6);
        expect(reloaded!.irrigation).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// 6. FINAL REVIEW F-1 — the pull the correction itself guarantees.
//
//    Section 5 above proves a STALE pull cannot touch the edit, and replays an
//    identical DTO to do it. That is not the pull that happens in production.
//    `CorrectLabourHandler` calls `MarkLabourCorrected(now)`, which ADVANCES
//    `DailyLog.ModifiedAtUtc` — deliberately, so a correction reaches a second
//    device at all — so the very next delta carries this log with a FRESHER
//    timestamp, the freshness guard passes on its merits, and `reconcileLogs`
//    rebuilds the record whole.
//
//    These tests assert what then actually happens, including the part that is
//    a loss. A test that asserted the loss away would be a fix in the test file.
// ---------------------------------------------------------------------------

/** The same log, restated by the server an hour later — a genuine delta row. */
const freshLogDto = (workerCount: number) =>
    logDto(workerCount, { modifiedAtUtc: '2026-08-13T07:00:00.000Z' });

describe('a FRESH pull rebuilds the log, and the save said so in advance', () => {
    /** Pull once so the local row carries a watermark, then edit both halves. */
    async function correctBothHalves() {
        const db = getDatabase();
        await repo.batchSave([makeLog([PLOT_A])]);
        await reconcileLogs(db, { dailyLogs: [logDto(8)] } as unknown as SyncPullResponse, new Map(), new Set());

        const existing = await repo.getById(LOG) as DailyLog;
        return correct(
            { ...existing, irrigation: [{ id: 'irr-1', method: 'Drip', durationHours: 3 }] } as DailyLog,
            6,
        );
    }

    it('replaces the non-labour half of the edit, because the server was never told it', async () => {
        const db = getDatabase();
        const result = await correctBothHalves();
        expect(result.success).toBe(true);
        expect((await repo.getById(LOG))!.irrigation).toHaveLength(1);

        // Fifteen seconds later, the delta the correction caused.
        await reconcileLogs(db, { dailyLogs: [freshLogDto(6)] } as unknown as SyncPullResponse, new Map(), new Set());

        const reloaded = await repo.getById(LOG);
        // The labour correction survives — it is on the server, and comes back.
        expect(reloaded!.labour[0].count).toBe(6);
        // The irrigation correction does NOT. `UpdateLog` posts only labour, so
        // the server's `tasks` never heard about it and `toDailyLog` rebuilds
        // irrigation from `tasks`. This is the loss F-1 named; it is asserted
        // here rather than wished away, so that the day a task-push path exists
        // this test fails and someone reads the sentence below.
        expect(reloaded!.irrigation).toHaveLength(0);
    });

    it('the save flags the half it could not send, so the toast can say it', async () => {
        // THE GUARD. Without this the farmer gets a green `फोनवर सेव्ह ✓` over an
        // edit that is half-reverted within the sync interval, which is exactly
        // what ruling `R19` produced by deleting the caveat.
        const result = await correctBothHalves();

        expect(result.persistedLabourCorrections).toBe(1);
        expect(result.hasUnsentChanges).toBe(true);
    });

    it('says nothing extra when the whole edit WAS sent', async () => {
        // A headcount-only correction has no unsent half, and announcing an
        // absence there would be a nag on the correction path (`P9`).
        const existing = makeLog([PLOT_A]);
        await repo.batchSave([existing]);

        const result = await correct(existing, 6);

        expect(result.persistedLabourCorrections).toBe(1);
        expect(result.hasUnsentChanges).toBe(false);
    });

    it('flags an ADDED engagement, which no correction can carry and the pull deletes', async () => {
        // `buildLabourCorrections` skips a newly added engagement by design —
        // "not a correction of an existing one". So it is saved locally, sent
        // nowhere, and then removed by `resolveLabour`, which lets a non-empty
        // server answer win. Same defect as the irrigation one, on the labour
        // half of the same submit.
        const db = getDatabase();
        await repo.batchSave([makeLog([PLOT_A])]);
        await reconcileLogs(db, { dailyLogs: [logDto(8)] } as unknown as SyncPullResponse, new Map(), new Set());

        const existing = await repo.getById(LOG) as DailyLog;
        const result = await updateLog(
            {
                logId: LOG,
                updatedData: {
                    ...existing,
                    labour: [
                        labour({ count: 6 }),
                        labour({ id: 'l2', labourAssignmentId: undefined, count: 2, activity: 'बांधणी' }),
                    ],
                },
                actorId: 'mukadam-7',
                reason: 'दोन जास्त आले',
            },
            repo,
            actor,
        );

        expect(result.success).toBe(true);
        expect(result.persistedLabourCorrections).toBe(1);
        expect(result.hasUnsentChanges).toBe(true);

        await reconcileLogs(db, { dailyLogs: [freshLogDto(6)] } as unknown as SyncPullResponse, new Map(), new Set());
        expect((await repo.getById(LOG))!.labour).toHaveLength(1);
    });

    it('flags a change no LabourCorrectionRequest has a field for', async () => {
        // An attribution, a wage or a task name moves on the handset only: the
        // request carries quantity and duration and nothing else. Treating "some
        // correction touched this id" as "this engagement was sent" would hide
        // exactly this case, which is why the check compares the engagement with
        // the correctable fields removed.
        const existing = makeLog([PLOT_A]);
        await repo.batchSave([existing]);

        const result = await updateLog(
            {
                logId: LOG,
                updatedData: { ...existing, labour: [labour({ count: 6, activity: 'बांधणी' })] },
                actorId: 'mukadam-7',
                reason: 'काम वेगळं होतं',
            },
            repo,
            actor,
        );

        expect(result.persistedLabourCorrections).toBe(1);
        expect(result.hasUnsentChanges).toBe(true);
    });

    it('does not raise the caveat for a re-serialised but unchanged record', async () => {
        // `finalLog` is `{...existingLog, ...updatedData}` and the form REBUILDS
        // its objects, so a naive `JSON.stringify` diff would report a change
        // whenever key order differed and put a true-but-pointless sentence on
        // every edit. The comparison is order-stable for exactly this reason.
        const existing = makeLog([PLOT_A], {
            irrigation: [{ id: 'irr-1', method: 'Drip', durationHours: 3 }],
        } as unknown as Partial<DailyLog>);
        await repo.batchSave([existing]);

        const result = await correct(
            { ...existing, irrigation: [{ durationHours: 3, id: 'irr-1', method: 'Drip' }] } as DailyLog,
            6,
        );

        expect(result.hasUnsentChanges).toBe(false);
    });
});
