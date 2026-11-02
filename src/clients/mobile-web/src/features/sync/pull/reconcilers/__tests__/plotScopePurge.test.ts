/**
 * spec: plr-d10 lane MU-4 (MU design §2 "Scope", §3 G2, §11.6, §11.7) — the phone keeps only what the server says this
 * person's PLOTS allow.
 *
 * A real Dexie (fake-indexeddb) at the SHIPPED version, filled the way the pull fills it (a phone that pulled the whole
 * farm before the owner narrowed this person to {P2, P4}), then the server's scopes reconciled. Proves:
 *   - the narrowing PURGES: P1 / P3 and their seasons, planned steps and crop-list entries; records only on other plots,
 *     the whole farm's made by someone else; money off his plots (a split bill keeps his share line only); tasks, tests,
 *     warnings and attention cards off his plots; a bill photo no money of his names;
 *   - what stays: his plots' records (one spanning plots too), his own whole-farm record and his own unplaced money, a
 *     record with a change still queued (P10), and हजेरी (the farm-day's);
 *   - every PICKER reads only his plots: the plots table and the crop list hold P2 and P4 alone;
 *   - an own-work seat keeps the plot names but none of other people's money;
 *   - every-plot scopes (and an older server that sends no plot scope) change nothing; no Dexie version bump;
 *   - a change refused by the plot rule (`ShramSafal.PlotScope.Forbidden`) is parked with the rule's words.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_VERSION, getDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { FarmAccessScopeDto } from '../../../../../infrastructure/api/dtos';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { DailyLog } from '../../../../../types';
import { reconcileAccessScopes } from '../accessScopeReconciler';
import { refusalHint, refusalReasonOf } from '../../../../logs/components/correction/refusedRevision';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';

vi.mock('../../../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: { getCurrentFarmId: () => FARM, setCurrentFarmId: vi.fn(), clearCurrentFarmId: vi.fn() },
}));

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const P1 = 'p1000000-0000-4000-8000-000000000001';
const P2 = 'p2000000-0000-4000-8000-000000000002';
const P3 = 'p3000000-0000-4000-8000-000000000003';
const P4 = 'p4000000-0000-4000-8000-000000000004';
const AT = '2026-11-02T06:00:00.000Z';

const scope = (over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({
    farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: false, seeAttendance: true, seeTests: true,
    seeCompliance: true, seeFarmOverview: true, ...over,
});
const chosen = (...plots: string[]) => scope({ plotScope: 'ChosenPlots', plotIds: plots });

function logOn(id: string, maker: string, plots: string[]): DailyLog {
    return {
        id,
        date: '2026-10-30',
        context: { selection: plots.length === 0 ? [{ cropId: 'FARM_GLOBAL', selectedPlotIds: [], selectedPlotNames: [] }] : [{ cropId: 'grapes', selectedPlotIds: plots, selectedPlotNames: plots }] },
        dayOutcome: null,
        cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [],
        meta: { createdAtISO: AT, createdByOperatorId: maker, farmId: FARM },
    } as unknown as DailyLog;
}

async function putLog(db: AgriLogDatabase, log: DailyLog) {
    await db.logs.put({
        id: log.id, schemaVersion: 2, log, date: log.date, createdByOperatorId: log.meta?.createdByOperatorId,
        isDeleted: 0, serverModifiedAtUtc: AT,
    });
}

const photo = (id: string, parentType: string, parent: string) => ({
    id, farmId: FARM, linkedEntityId: parent, linkedEntityType: parentType, localPath: '', originalFileName: 'p.jpg',
    mimeType: 'image/jpeg', sizeBytes: 1, status: 'uploaded' as const, remoteAttachmentId: id, createdAt: AT, updatedAt: AT, retryCount: 0,
});

/** A phone that pulled the whole farm before the owner chose its plots. */
async function seedWholeFarm(db: AgriLogDatabase) {
    await db.farms.put({ id: FARM, payload: { id: FARM, ownerUserId: OWNER }, updatedAt: AT });
    for (const plot of [P1, P2, P3, P4]) {
        await db.plots.put({ id: plot, farmId: FARM, payload: { id: plot, farmId: FARM, name: `प्लॉट-${plot.slice(0, 2)}` }, updatedAt: AT });
        await db.cropCycles.put({ id: `cycle-${plot}`, farmId: FARM, plotId: plot, payload: {}, updatedAt: AT });
        await db.plannedTasks.put({ id: `plan-${plot}`, cropCycleId: `cycle-${plot}`, plannedDate: '2026-10-01', payload: {}, updatedAt: AT });
        await db.jobCards.put({ id: `job-${plot}`, farmId: FARM, plotId: plot, status: 'Draft', lineItems: [] } as never);
        await db.testInstances.put({ id: `test-${plot}`, farmId: FARM, plotId: plot } as never);
        await db.complianceSignals.put({ id: `signal-${plot}`, farmId: FARM, plotId: plot } as never);
        await db.attentionCards.put({ cardId: `card-${plot}`, farmId: FARM, plotId: plot, rank: 1, computedAtUtc: AT, farmName: 'शेत' } as never);
    }
    await db.crops.put({ id: 'grapes', data: { id: 'grapes', name: 'द्राक्ष', plots: [P1, P2, P3, P4].map(id => ({ id, name: id })) } } as never);

    await putLog(db, logOn('log-p1', OWNER, [P1]));
    await putLog(db, logOn('log-p2', OWNER, [P2]));
    await putLog(db, logOn('log-p1p2', OWNER, [P1, P2]));
    await putLog(db, logOn('log-farm-owner', OWNER, []));
    await putLog(db, logOn('log-farm-mine', ME, []));
    await putLog(db, logOn('log-p1-mine', ME, [P1]));
    await putLog(db, logOn('log-p1-queued', OWNER, [P1]));

    const money = (id: string, plotId: string | null, by: string, bills: string[] = []) =>
        db.costEntries.put({ id, farmId: FARM, payload: { id, farmId: FARM, plotId, createdByUserId: by, amount: 1, clientAttachmentIds: bills }, updatedAt: AT });
    await money('cost-p1', P1, OWNER);
    await money('cost-p2', P2, OWNER, ['bill-p2']);
    await money('cost-split', null, OWNER);
    await money('cost-unallocated', null, OWNER, ['bill-shared']);
    await money('cost-mine', null, ME);
    await db.financeCorrections.put({ id: 'fc-p1', costEntryId: 'cost-p1', payload: {}, updatedAt: AT });
    await db.dayLedgers.put({
        id: 'ledger-split', farmId: FARM, dateKey: '2026-10-30', updatedAt: AT,
        payload: { id: 'ledger-split', sourceCostEntryId: 'cost-split', createdByUserId: OWNER, allocations: [{ plotId: P1, allocatedAmount: 3500.51 }, { plotId: P2, allocatedAmount: 2500.33 }] },
    });
    await db.attendanceMarks.put({ id: 'mark', farmId: FARM, fieldOperatorId: 'op', workDate: '2026-10-30', updatedAt: AT, payload: { id: 'mark', farmId: FARM } as never });
    await db.attachments.bulkPut([
        photo('photo-p1', 'DailyLog', 'log-p1'), photo('photo-p2', 'DailyLog', 'log-p2'), photo('receipt-p1', 'CostEntry', 'cost-p1'),
        photo('bill-p2', 'Bill', FARM), photo('bill-shared', 'Bill', FARM),
    ]);
}

const pull = (scopes: FarmAccessScopeDto[]) => ({ accessScopes: scopes } as unknown as SyncPullResponse);
const reconcile = (db: AgriLogDatabase, scopes: FarmAccessScopeDto[], pending = new Set<string>(['log-p1-queued'])) =>
    db.transaction('rw', [
        db.logs, db.attachments, db.uploadQueue, db.appMeta, db.farms, db.plots, db.cropCycles, db.costEntries,
        db.financeCorrections, db.dayLedgers, db.plannedTasks, db.attentionCards, db.attendanceMarks, db.jobCards,
        db.testInstances, db.testRecommendations, db.complianceSignals, db.crops, db.farmerProfile,
    ], () => reconcileAccessScopes(db, pull(scopes), { userId: ME, pendingLogIds: pending, receivedAtUtc: AT }));

const ids = async (rows: Promise<{ id?: string; cardId?: string }[]>) => (await rows).map(r => r.id ?? r.cardId).sort();

describe('a narrowing to {P2, P4} purges what lies outside his plots', () => {
    let db: AgriLogDatabase;
    beforeEach(async () => {
        db = getDatabase();
        await db.delete();
        await db.open();
        await seedWholeFarm(db);
    });

    it('keeps only his plots, their seasons and steps — the pickers (plots, crop list) offer P2 and P4 alone', async () => {
        await reconcile(db, [chosen(P2, P4)]);
        expect(await ids(db.plots.toArray())).toEqual([P2, P4].sort());
        expect(await ids(db.cropCycles.toArray())).toEqual([`cycle-${P2}`, `cycle-${P4}`].sort());
        expect(await ids(db.plannedTasks.toArray())).toEqual([`plan-${P2}`, `plan-${P4}`].sort());
        const crop = await db.crops.get('grapes') as unknown as { data: { plots: { id: string }[] } };
        expect(crop.data.plots.map(p => p.id).sort()).toEqual([P2, P4].sort());
    });

    it('keeps a record on his plots (one spanning plots too), his own whole-farm one and one with a change queued; nothing else', async () => {
        await reconcile(db, [chosen(P2, P4)]);
        expect(await ids(db.logs.toArray())).toEqual(['log-farm-mine', 'log-p1-queued', 'log-p1p2', 'log-p2'].sort());
    });

    it('keeps his plots\' money and his own unplaced submission; a split bill keeps his share line only', async () => {
        await reconcile(db, [chosen(P2, P4)]);
        expect(await ids(db.costEntries.toArray())).toEqual(['cost-mine', 'cost-p2']);
        expect(await db.financeCorrections.count()).toBe(0);
        const ledger = await db.dayLedgers.get('ledger-split');
        expect((ledger?.payload as { allocations: { plotId: string }[] }).allocations.map(a => a.plotId)).toEqual([P2]);
        expect(JSON.stringify(ledger)).not.toContain('3500.51');
    });

    it('keeps tasks, tests, warnings and attention on his plots only; हजेरी stays the farm-day\'s', async () => {
        await reconcile(db, [chosen(P2, P4)]);
        for (const [table, prefix] of [[db.jobCards, 'job'], [db.testInstances, 'test'], [db.complianceSignals, 'signal'], [db.attentionCards, 'card']] as const) {
            expect(await ids((table as { toArray(): Promise<{ id?: string; cardId?: string }[]> }).toArray())).toEqual([`${prefix}-${P2}`, `${prefix}-${P4}`].sort());
        }
        expect(await db.attendanceMarks.count()).toBe(1);
    });

    it('removes a removed record\'s photo, a removed money\'s receipt and a bill no money of his names', async () => {
        await reconcile(db, [chosen(P2, P4)]);
        expect(await ids(db.attachments.toArray())).toEqual(['bill-p2', 'photo-p2']);
    });

    it('remembers the server\'s plot scope for the screens', async () => {
        await reconcile(db, [chosen(P2, P4)]);
        const stored = await db.appMeta.get('shramsafal_access_scopes_v1');
        expect(JSON.stringify(stored?.value)).toContain('"plotScope":"ChosenPlots"');
    });
});

describe('an own-work seat and every-plot scopes', () => {
    let db: AgriLogDatabase;
    beforeEach(async () => {
        db = getDatabase();
        await db.delete();
        await db.open();
        await seedWholeFarm(db);
    });

    it('own work: every plot\'s name stays, other people\'s money and records leave', async () => {
        await reconcile(db, [scope({ plotScope: 'OwnWork', ownRecordsOnly: true, seeFarmOverview: false })]);
        expect(await ids(db.plots.toArray())).toEqual([P1, P2, P3, P4].sort());
        expect(await ids(db.costEntries.toArray())).toEqual(['cost-mine']);
        expect(await ids(db.logs.toArray())).toEqual(['log-farm-mine', 'log-p1-mine', 'log-p1-queued'].sort());
    });

    it('every plot (and an older server with no plot scope) changes nothing; no Dexie version bump', async () => {
        await reconcile(db, [scope({ plotScope: 'AllPlots' })]);
        await reconcile(db, [scope()]);
        expect(await db.plots.count()).toBe(4);
        expect(await db.logs.count()).toBe(7);
        expect(await db.costEntries.count()).toBe(5);
        expect(DATABASE_VERSION).toBe(db.verno);
    });
});

describe('a write refused by the plot rule', () => {
    it('is parked with the rule\'s words, never pointing at anyone', () => {
        expect(refusalReasonOf('ShramSafal.PlotScope.Forbidden')).toBe('plotClosed');
        const mr = refusalHint(SyncMutationName.CreateDailyLog, 'ShramSafal.PlotScope.Forbidden', 'mr') ?? '';
        expect(mr).toContain('श्रमसफलच्या नियमानुसार');
        expect(mr).toContain('या फोनवर ठेवलं आहे');
        expect(mr).not.toMatch(/मालक|दिसत नाही|तुम्हाला दाखवल/);
        expect(refusalHint(SyncMutationName.AddCostEntry, 'ShramSafal.PlotScope.Forbidden', 'en')).toContain("By ShramSafal's rules");
    });
});
