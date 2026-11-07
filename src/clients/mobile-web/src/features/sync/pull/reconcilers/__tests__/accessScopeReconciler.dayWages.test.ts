// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25, lane MU-1 (founder D-70 option 2, register F124) — the phone keeps no
 * DAY wage for a seat on chosen plots: another person's record on his plot loses its wage per person AND its crew total
 * (each said to be held back, never reading "not stated"), the other money of his plot stays, and the cached wage book is
 * cleared once. A seat on every plot that sees wages (and his own record) keep the wage. A real Dexie, as the pull fills it.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { FarmAccessScopeDto } from '../../../../../infrastructure/api/dtos';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { DailyLog } from '../../../../../types';
import { readLabourReadout, writeLabourReadout } from '../../../../../infrastructure/storage/LabourReadoutCache';
import { reconcileAccessScopes } from '../accessScopeReconciler';

vi.mock('../../../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: { getCurrentFarmId: () => FARM, setCurrentFarmId: vi.fn(), clearCurrentFarmId: vi.fn() },
}));

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const P2 = 'p2000000-0000-4000-8000-000000000002';
const AT = '2026-11-07T06:00:00.000Z';

const scope = (over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({
    farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true,
    seeCompliance: true, seeFarmOverview: true, ...over,
});
const chosen = scope({ plotScope: 'ChosenPlots', plotIds: [P2] });
const everyPlot = scope({ plotScope: 'AllPlots' });

function pricedLog(id: string, maker: string): DailyLog {
    return {
        id,
        date: '2026-10-30',
        context: { selection: [{ cropId: 'grapes', selectedPlotIds: [P2], selectedPlotNames: ['प्लॉट-दोन'] }] },
        dayOutcome: null,
        cropActivities: [],
        irrigation: [],
        labour: [{ id: `${id}-crew`, type: 'HIRED', count: 8, wagePerPerson: 432, totalCost: 3456 }],
        inputs: [{ id: 'in-1', productName: 'युरिया', cost: 777, numbers: { cost: { certainty: 'reported' } }, mix: [] }],
        machinery: [],
        activityExpenses: [],
        meta: { createdAtISO: AT, createdByOperatorId: maker, farmId: FARM },
    } as unknown as DailyLog;
}

async function putLog(db: AgriLogDatabase, log: DailyLog) {
    await db.logs.put({
        id: log.id, schemaVersion: 2, log, date: log.date, createdByOperatorId: log.meta?.createdByOperatorId,
        isDeleted: 0, serverModifiedAtUtc: AT,
    });
}

const run = (db: AgriLogDatabase, scopes: FarmAccessScopeDto[]) =>
    reconcileAccessScopes(db, { accessScopes: scopes } as unknown as SyncPullResponse, {
        userId: ME, pendingLogIds: new Set(), receivedAtUtc: AT,
    });

describe('accessScopeReconciler - D-70 option 2: no day wages on chosen plots', () => {
    let db: AgriLogDatabase;
    beforeEach(async () => {
        db = getDatabase();
        await db.open();
        await Promise.all(db.tables.map(t => t.clear()));
        localStorage.clear();
        await db.farms.put({ id: FARM, payload: { id: FARM, ownerUserId: OWNER }, updatedAt: AT });
        await db.plots.put({ id: P2, farmId: FARM, payload: { id: P2, farmId: FARM, name: 'प्लॉट-दोन' }, updatedAt: AT });
        await putLog(db, pricedLog('owner-log', OWNER));
        await putLog(db, pricedLog('my-log', ME));
    });

    it('another person\'s record on his plot loses the wage and the crew total, each said to be held back; his plot\'s other money stays', async () => {
        await run(db, [chosen]);
        const other = (await db.logs.get('owner-log'))!.log;
        expect(other.labour[0].wagePerPerson).toBeUndefined();
        expect(other.labour[0].wageWithheld).toBe(true);
        expect(other.labour[0].totalCost).toBeUndefined();
        expect(other.labour[0].totalCostWithheld).toBe(true);
        expect(other.labour[0].count).toBe(8);
        expect(other.inputs[0].cost).toBe(777);
        expect(JSON.stringify(other)).not.toContain('3456');

        const mine = (await db.logs.get('my-log'))!.log;
        expect(mine.labour[0].wagePerPerson).toBe(432);
        expect(mine.labour[0].totalCost).toBe(3456);
    });

    it('a seat on every plot that sees wages keeps the wage and the total, as before', async () => {
        await run(db, [everyPlot]);
        const other = (await db.logs.get('owner-log'))!.log;
        expect(other.labour[0].wagePerPerson).toBe(432);
        expect(other.labour[0].totalCost).toBe(3456);
        expect(other.labour[0].wageWithheld).toBeUndefined();
    });

    it('the cached wage book is cleared once when the seat narrows to chosen plots, then left alone', async () => {
        writeLabourReadout(ME, FARM, 'week', { view: 'owner', home: { rojandariStated: 2400 } });
        await run(db, [everyPlot]);
        expect(readLabourReadout(ME, FARM, 'week')).not.toBeNull();

        await run(db, [chosen]);
        expect(readLabourReadout(ME, FARM, 'week')).toBeNull();

        writeLabourReadout(ME, FARM, 'week', { view: 'owner', home: { rojandariStated: null } });
        await run(db, [chosen]);
        expect(readLabourReadout(ME, FARM, 'week')).not.toBeNull();
    });

    // Fix round 1 (review HIGH-1): a crew's total is also stored as a `labour_misc` money entry.
    it('a day-wage money entry (labour_misc) of someone else goes from a chosen-plots seat; his own and the rest of the plot\'s money stay', async () => {
        const cost = (id: string, categoryId: string, by: string) =>
            db.costEntries.put({ id, farmId: FARM, payload: { id, farmId: FARM, plotId: P2, amount: 2468.13, categoryId, createdByUserId: by }, updatedAt: AT });
        const ledger = (id: string, source: string) =>
            db.dayLedgers.put({ id, farmId: FARM, dateKey: '2026-10-30', payload: { id, farmId: FARM, sourceCostEntryId: source, allocations: [{ plotId: P2, allocatedAmount: 100 }] }, updatedAt: AT });
        await cost('misc-owner', 'labour_misc', OWNER);
        await cost('misc-mine', 'labour_misc', ME);
        await cost('fertilizer', 'fertilizer', OWNER);
        await cost('payout', 'labour_payout', OWNER);
        await ledger('ledger-misc', 'misc-owner');
        await ledger('ledger-fertilizer', 'fertilizer');

        await run(db, [everyPlot]);
        expect(await db.costEntries.count()).toBe(4);
        expect(await db.dayLedgers.count()).toBe(2);

        await run(db, [chosen]);
        expect((await db.costEntries.toArray()).map(e => e.id).sort()).toEqual(['fertilizer', 'misc-mine', 'payout']);
        expect((await db.dayLedgers.toArray()).map(l => l.id)).toEqual(['ledger-fertilizer']);
    });
});
