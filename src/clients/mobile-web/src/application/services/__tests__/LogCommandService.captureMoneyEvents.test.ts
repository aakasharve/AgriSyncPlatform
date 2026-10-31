/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-07-13-labour-attendance-approval-design (Phase 3 / Decision 3a,
 * 2026-07-19).
 *
 * `LogCommandServiceImpl.confirmAndSave` -> `captureMoneyEventsFromLog` is the
 * ONE place a saved log's labour/inputs/machinery/activity-expenses turn into
 * real finance CostEntries. Two real bugs lived here:
 *
 *  1. `farmId` was never read from the log at all, so every captured expense
 *     fell through to a stale cached farmId (wrong farm for a multi-farm
 *     user who just switched) or the literal string 'farm_unknown' — and
 *     the sync-contract's `AddCostEntryPayload.farmId` is `ZGuid` (bare
 *     UUID), so a non-UUID farmId silently failed payload validation exactly
 *     like the `me_<uuid>` costEntryId bug (see financeCommandService.test.ts).
 *
 *  2. NO-MULTIPLY violation: a labour entry with only `count`+`wagePerPerson`
 *     (no explicit `totalCost`) was multiplied client-side into a real,
 *     synced CostEntry — inventing a total the farmer never stated and the
 *     server (LedgerDerivationService) deliberately refuses to store.
 *
 * This suite exercises the REAL `LogCommandServiceImpl` against real Dexie
 * (fake-indexeddb) + the real MutationQueue/PayloadValidator, proving both
 * fixes end-to-end from the actual production call site.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { LogCommandServiceImpl } from '../LogCommandService';
import { financeService } from '../../../features/finance/financeService';
import type { LogsRepository } from '../../ports';
import type { DailyLog, LabourEvent } from '../../../types';

const FARM_ID = '33333333-3333-3333-3333-333333333333';

vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => FARM_ID,
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

const fakeRepo = {
    batchSave: vi.fn().mockResolvedValue(undefined),
} as unknown as LogsRepository;

function makeLog(labour: LabourEvent[]): DailyLog {
    return {
        id: `log-${labour[0]?.id ?? 'x'}`,
        date: '2026-07-19',
        context: {
            selection: [{ cropId: 'FARM_GLOBAL', cropName: 'Farm-wide', selectedPlotIds: [], selectedPlotNames: [] }],
        },
        cropActivities: [],
        irrigation: [],
        labour,
        inputs: [],
        machinery: [],
    } as unknown as DailyLog;
}

async function pendingAddCostEntryRows() {
    const db = getDatabase();
    return db.mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray();
}

describe('LogCommandServiceImpl.confirmAndSave — money capture (Decision 3a)', () => {
    beforeEach(async () => {
        // Deliberately does NOT call resetDatabase() — closing/reopening the
        // Dexie handle mid-run races financeService's fire-and-forget
        // `refreshInBackground()` from the previous test (an unhandled
        // DatabaseClosedError rejection). Clearing the one table these tests
        // touch is enough for exact-count assertions to be trustworthy.
        await getDatabase().mutationQueue.clear();
        // The farm the app is working on is a farm this phone knows (the farm-wide log's own stamp is
        // checked against it, exactly as the log's own sync does — L2a R-3).
        await getDatabase().farms.put({ id: FARM_ID, payload: { id: FARM_ID }, updatedAt: '2026-07-19T00:00:00.000Z' });
        vi.clearAllMocks();
    });

    it('a farm-wide log: the expense goes to the farm the log was saved under (the ACTIVE farm then)', async () => {
        const service = new LogCommandServiceImpl(fakeRepo);
        const log = makeLog([
            { id: 'l1', type: 'HIRED', count: 4, wagePerPerson: 400, totalCost: 1600 } as LabourEvent,
        ]);

        await service.confirmAndSave([log]);
        await new Promise(resolve => setTimeout(resolve, 0));

        const pending = await pendingAddCostEntryRows();
        expect(pending).toHaveLength(1);
        const payload = pending[0].payload as { farmId: string; amount: number; categoryId: string };
        expect(payload.farmId).toBe(FARM_ID);
        expect(payload.amount).toBe(1600);
        expect(payload.categoryId).toBe('labour_misc');
    });

    it('NO-MULTIPLY: count+wagePerPerson with NO explicit totalCost enqueues nothing — never a fabricated rate*count total', async () => {
        const service = new LogCommandServiceImpl(fakeRepo);
        const log = makeLog([
            { id: 'l2', type: 'HIRED', count: 4, wagePerPerson: 400 } as LabourEvent, // no totalCost stated
        ]);

        await service.confirmAndSave([log]);
        await new Promise(resolve => setTimeout(resolve, 0));

        const pending = await pendingAddCostEntryRows();
        expect(pending).toHaveLength(0);
    });

    it('still captures a labour expense normally when an explicit totalCost IS stated (regression guard)', async () => {
        const service = new LogCommandServiceImpl(fakeRepo);
        const log = makeLog([
            { id: 'l3', type: 'HIRED', maleCount: 2, wagePerPerson: 300, totalCost: 600 } as LabourEvent,
        ]);

        await service.confirmAndSave([log]);
        await new Promise(resolve => setTimeout(resolve, 0));

        const pending = await pendingAddCostEntryRows();
        expect(pending).toHaveLength(1);
        expect((pending[0].payload as { amount: number }).amount).toBe(600);
    });
});

/**
 * Labour V1 Task 7.3 — the mint is at this ONE shared boundary, and it must
 * land on the caller's own array. Every caller of confirmAndSave then passes
 * that same reference to enqueueLogsForSync, so an id that only exists on some
 * internal copy would be persisted locally and never sent, and the server
 * rejects a missing/empty LabourAssignmentId as a malformed payload.
 */
describe('LogCommandServiceImpl.confirmAndSave — labourAssignmentId mint (Task 7.3)', () => {
    beforeEach(async () => {
        await getDatabase().mutationQueue.clear();
        vi.clearAllMocks();
    });

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it('mints a UUID onto the CALLER\'S OWN log objects, not a copy', async () => {
        const service = new LogCommandServiceImpl(fakeRepo);
        const event = { id: 'l1', type: 'HIRED', count: 3 } as LabourEvent;
        const callersOwnLogs = [makeLog([event])];

        await service.confirmAndSave(callersOwnLogs);

        // Read back through the caller's reference — this is exactly what
        // enqueueLogsForSync receives.
        const minted = callersOwnLogs[0].labour[0].labourAssignmentId;
        expect(minted).toBeDefined();
        expect(minted).toMatch(UUID);
        expect(event.labourAssignmentId).toBe(minted);
    });

    it('mints for a farm-global log, whose labour never passes through the plot split', async () => {
        // makeLog() builds a FARM_GLOBAL selection with no plots — the branch
        // that would have had NO id at all if the mint lived inside
        // allocateLabourForPlot.
        const service = new LogCommandServiceImpl(fakeRepo);
        const logs = [makeLog([{ id: 'l2', type: 'CONTRACT' } as LabourEvent])];

        await service.confirmAndSave(logs);

        expect(logs[0].labour[0].labourAssignmentId).toMatch(UUID);
    });

    it('gives each labour event in a multi-log batch its own distinct id', async () => {
        const service = new LogCommandServiceImpl(fakeRepo);
        const logs = [
            makeLog([{ id: 'l3', type: 'HIRED' } as LabourEvent]),
            makeLog([{ id: 'l4', type: 'HIRED' } as LabourEvent]),
        ];

        await service.confirmAndSave(logs);

        const a = logs[0].labour[0].labourAssignmentId;
        const b = logs[1].labour[0].labourAssignmentId;
        expect(a).toMatch(UUID);
        expect(b).toMatch(UUID);
        expect(a).not.toBe(b);
    });

    it('does not renumber an engagement that already carries an id', async () => {
        const service = new LogCommandServiceImpl(fakeRepo);
        const existing = '11111111-2222-3333-4444-555555555555';
        const logs = [makeLog([{ id: 'l5', type: 'HIRED', labourAssignmentId: existing } as LabourEvent])];

        await service.confirmAndSave(logs);
        await service.confirmAndSave(logs);

        expect(logs[0].labour[0].labourAssignmentId).toBe(existing);
    });

    it('carries a stated durationHours through untouched', async () => {
        const service = new LogCommandServiceImpl(fakeRepo);
        const logs = [makeLog([{ id: 'l6', type: 'HIRED', count: 2, durationHours: 4 } as LabourEvent])];

        await service.confirmAndSave(logs);

        expect(logs[0].labour[0].durationHours).toBe(4);
    });
});

/**
 * spec: pre-launch-repair L2a (R-3) — a log's money goes where the LOG goes: the farm of the log's own
 * plot, never the farm the app happens to show; a log whose plot this phone cannot place keeps its money
 * on the phone instead of sending it to a guessed farm.
 */
describe('LogCommandServiceImpl.confirmAndSave — the money follows the log’s own farm (L2a R-3)', () => {
    const FARM_A = '44444444-4444-4444-4444-444444444444';
    const PLOT_ON_A = '55555555-5555-5555-5555-555555555555';

    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.farms.put({ id: FARM_A, payload: { id: FARM_A }, updatedAt: '2026-07-19T00:00:00.000Z' });
        await db.plots.put({ id: PLOT_ON_A, farmId: FARM_A, payload: { id: PLOT_ON_A, farmId: FARM_A }, updatedAt: '2026-07-19T00:00:00.000Z' });
        vi.clearAllMocks();
    });

    function plotLog(plotId: string, id: string): DailyLog {
        return {
            id: `log-${id}`,
            date: '2026-07-19',
            context: { selection: [{ cropId: 'FARM_GLOBAL', cropName: 'Farm-wide', selectedPlotIds: [plotId], selectedPlotNames: ['A-1'] }] },
            cropActivities: [], irrigation: [], inputs: [], machinery: [],
            labour: [{ id, type: 'HIRED', count: 2, totalCost: 800 } as LabourEvent],
        } as unknown as DailyLog;
    }

    it('a log on a plot of farm A, saved while the app shows another farm, sends its money to farm A', async () => {
        const service = new LogCommandServiceImpl(fakeRepo);
        await service.confirmAndSave([plotLog(PLOT_ON_A, 'r3a')]);
        await new Promise(resolve => setTimeout(resolve, 0));

        const pending = await pendingAddCostEntryRows();
        expect(pending).toHaveLength(1);
        const payload = pending[0].payload as { farmId: string; amount: number; plotId?: string };
        expect(payload.farmId).toBe(FARM_A);
        expect(payload.farmId).not.toBe(FARM_ID);
        expect(payload.plotId).toBe(PLOT_ON_A);
        expect(payload.amount).toBe(800);
    });

    it('a log whose plot this phone cannot place keeps its money on the phone — nothing sent to a guessed farm', async () => {
        const service = new LogCommandServiceImpl(fakeRepo);
        const unknownPlot = '66666666-6666-6666-6666-666666666666';
        await service.confirmAndSave([plotLog(unknownPlot, 'r3b')]);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(await pendingAddCostEntryRows()).toHaveLength(0);
    });

    // L2a review m3 — the farm lookup runs AFTER the log is saved; if it throws, the save must still
    // succeed and the log's money is "no farm known": kept on the phone (the local money entry exists, with
    // no farm), nothing queued, nothing sent to the session's farm.
    it('a farm lookup that throws: the save still succeeds and the money is kept, not sent', async () => {
        const db = getDatabase();
        const lookup = vi.spyOn(db.plots, 'get').mockRejectedValueOnce(new Error('lookup failed'));
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const added = vi.spyOn(financeService, '_addEvent');
        const service = new LogCommandServiceImpl(fakeRepo);

        const saved = [plotLog(PLOT_ON_A, 'r3c')];
        await expect(service.confirmAndSave(saved)).resolves.toBeUndefined();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(lookup).toHaveBeenCalled();
        expect(fakeRepo.batchSave).toHaveBeenCalledTimes(1);
        // Lane OF-S fix 1 (B002): a crew's money is keyed by its ENGAGEMENT id (minted on save), so a later move of
        // the entry can find it on the server and on any phone.
        const engagementId = saved[0].labour[0].labourAssignmentId;
        expect(engagementId).toMatch(/^[0-9a-f-]{36}$/);
        expect(added).toHaveBeenCalledWith(expect.objectContaining({ sourceId: `log-r3c:labour:${engagementId}`, amount: 800, farmId: '' }));
        expect(await pendingAddCostEntryRows()).toHaveLength(0);
        lookup.mockRestore();
        errors.mockRestore();
        added.mockRestore();
    });
});
