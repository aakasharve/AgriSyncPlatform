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
        vi.clearAllMocks();
    });

    it('propagates the ACTIVE farm id (SessionStore) into the enqueued expense for an explicit stated total', async () => {
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
