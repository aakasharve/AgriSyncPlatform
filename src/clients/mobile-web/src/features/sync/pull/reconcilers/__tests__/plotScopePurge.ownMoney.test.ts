/**
 * spec: plr-d10 lane MU-4 fix pass 1 (M5 / D-28, L4) — on a real Dexie (fake-indexeddb) at the SHIPPED version:
 *   - M5: a seat WITHOUT see money keeps his own money submissions (with their status) and their finance-screen mirror
 *     rows; nothing else of the farm's money stays; a farm he no longer reads takes his rows too;
 *   - L4: with no signed-in person known, the plot purge touches no money row at all (whose is whose is not knowable).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { FarmAccessScopeDto } from '../../../../../infrastructure/api/dtos';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import { reconcileAccessScopes } from '../accessScopeReconciler';

vi.mock('../../../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: { getCurrentFarmId: () => FARM, setCurrentFarmId: vi.fn(), clearCurrentFarmId: vi.fn() },
}));

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const P1 = 'p1000000-0000-4000-8000-000000000001';
const P2 = 'p2000000-0000-4000-8000-000000000002';
const AT = '2026-11-02T06:00:00.000Z';
const MIRROR = 'shramsafal_finance_cost_entries_v1'; // gitleaks:allow (a storage name, not a secret)

const scope = (over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({
    farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: false, seeAttendance: true, seeTests: true,
    seeCompliance: true, seeFarmOverview: true, ...over,
});

async function seedMoney(db: AgriLogDatabase) {
    await db.farms.put({ id: FARM, payload: { id: FARM, ownerUserId: OWNER }, updatedAt: AT });
    const money = (id: string, plotId: string | null, by: string) =>
        db.costEntries.put({ id, farmId: FARM, payload: { id, farmId: FARM, plotId, createdByUserId: by, amount: 1, reviewStatus: 'Pending' }, updatedAt: AT });
    await money('cost-owner-p1', P1, OWNER);
    await money('cost-owner-split', null, OWNER);
    await money('cost-mine-p1', P1, ME);
    await money('cost-mine-unplaced', null, ME);
    await db.dayLedgers.put({
        id: 'ledger-split', farmId: FARM, dateKey: '2026-10-30', updatedAt: AT,
        payload: { id: 'ledger-split', sourceCostEntryId: 'cost-owner-split', createdByUserId: OWNER, allocations: [{ plotId: P1, allocatedAmount: 10 }, { plotId: P2, allocatedAmount: 20 }] },
    });
    await db.appMeta.put({
        key: MIRROR, updatedAt: AT,
        value: [
            { id: 'cost-owner-p1', farmId: FARM, plotId: P1, createdByUserId: OWNER },
            { id: 'cost-mine-p1', farmId: FARM, plotId: P1, createdByUserId: ME },
        ],
    });
}

const pull = (scopes: FarmAccessScopeDto[]) => ({ accessScopes: scopes } as unknown as SyncPullResponse);
const reconcile = (db: AgriLogDatabase, scopes: FarmAccessScopeDto[], userId: string | null) =>
    db.transaction('rw', [
        db.logs, db.attachments, db.uploadQueue, db.appMeta, db.farms, db.plots, db.cropCycles, db.costEntries,
        db.financeCorrections, db.dayLedgers, db.plannedTasks, db.attentionCards, db.attendanceMarks, db.jobCards,
        db.testInstances, db.testRecommendations, db.complianceSignals, db.crops, db.farmerProfile, db.scheduleSubscriptions,
    ], () => reconcileAccessScopes(db, pull(scopes), { userId, pendingLogIds: new Set<string>(), receivedAtUtc: AT }));

const ids = async (rows: Promise<{ id: string }[]>) => (await rows).map(r => r.id).sort();

describe('his own money submissions reach him without see money (M5, D-28)', () => {
    let db: AgriLogDatabase;
    beforeEach(async () => {
        db = getDatabase();
        await db.delete();
        await db.open();
        await seedMoney(db);
    });

    it('keeps his own money rows and their mirror rows; nothing else of the farm\'s money', async () => {
        await reconcile(db, [scope({ seeMoney: false })], ME);
        expect(await ids(db.costEntries.toArray())).toEqual(['cost-mine-p1', 'cost-mine-unplaced']);
        const mirror = (await db.appMeta.get(MIRROR))?.value as { id: string }[];
        expect(mirror.map(r => r.id)).toEqual(['cost-mine-p1']);
        expect(await db.dayLedgers.count()).toBe(0);
    });

    it('a farm he no longer reads (the server says Removed) takes his rows too', async () => {
        await reconcile(db, [scope({ status: 'Removed' })], ME);
        expect(await db.costEntries.count()).toBe(0);
    });
});

describe('with no signed-in person known, the plot purge touches no money (L4)', () => {
    let db: AgriLogDatabase;
    beforeEach(async () => {
        db = getDatabase();
        await db.delete();
        await db.open();
        await seedMoney(db);
    });

    it('leaves every money row, ledger line and mirror row as it was', async () => {
        await reconcile(db, [scope({ plotScope: 'ChosenPlots', plotIds: [P2] })], null);
        expect(await ids(db.costEntries.toArray())).toEqual(['cost-mine-p1', 'cost-mine-unplaced', 'cost-owner-p1', 'cost-owner-split']);
        const ledger = await db.dayLedgers.get('ledger-split');
        expect((ledger?.payload as { allocations: unknown[] }).allocations).toHaveLength(2);
        expect(((await db.appMeta.get(MIRROR))?.value as unknown[])).toHaveLength(2);
    });
});
