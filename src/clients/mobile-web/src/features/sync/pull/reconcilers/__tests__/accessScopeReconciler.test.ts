/**
 * lane MU-3 (plan step 4a; founder D-22 / D-26) — the phone keeps only what the server lets this person read.
 *
 * A real Dexie (fake-indexeddb) at the SHIPPED version, filled the way the pull fills it, then the server's
 * scopes reconciled. Proves: a farm the server says (by name) he no longer reads is purged, and never one merely
 * absent or one he registered (fix 1, F9); money / wages / attendance /
 * other people's records go where the scope says; the outbox's records, photos still uploading and this
 * person's OWN records are never touched (P10); an older server's pull (no scopes) changes nothing; there
 * is no Dexie version bump; and the save path refuses a farm the server stopped sending.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_VERSION, getDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { FarmAccessScopeDto } from '../../../../../infrastructure/api/dtos';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { DailyLog } from '../../../../../types';
import { reconcileAccessScopes, withoutMoney } from '../accessScopeReconciler';
import {
    assertFarmsInScope, FarmOutOfScopeError, OUT_OF_SCOPE_FARMS_META_KEY, readAccessScopes,
} from '../../../../../infrastructure/storage/accessScopeStore';
import { LogCommandServiceImpl } from '../../../../../application/services/LogCommandService';
import type { LogsRepository } from '../../../../../application/ports';

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const FARM_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const FARM_GONE = 'cccccccc-0000-4000-8000-00000000000c';
const FARM_MINE = 'dddddddd-0000-4000-8000-00000000000d';
const FARM_NEW = 'eeeeeeee-0000-4000-8000-00000000000e';
const AT = '2026-11-01T06:00:00.000Z';
// The finance reconciler's cost-entry mirror in appMeta (financeReconciler.ts).
const COST_MIRROR = 'shramsafal_finance_cost_entries_v1';

let currentFarm = FARM_A;
vi.mock('../../../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => currentFarm,
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

/** The server's explicit word for a farm this phone named and may no longer read (fix 1, F9): every flag false. */
const removed = (farmId: string, status: 'Paused' | 'Waiting' | 'Removed' = 'Removed'): FarmAccessScopeDto => ({
    farmId, status, ownRecordsOnly: false, seeMoney: false, seeWages: false, seeAttendance: false, seeTests: false,
    seeCompliance: false, seeFarmOverview: false,
});

const scope = (farmId: string, over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({
    farmId,
    ownRecordsOnly: false,
    seeMoney: true,
    seeWages: true,
    seeAttendance: true,
    seeTests: true,
    seeCompliance: true,
    seeFarmOverview: true,
    ...over,
});

function pricedLog(id: string, farmId: string, maker: string): DailyLog {
    return {
        id,
        date: '2026-10-30',
        context: { selection: [] },
        dayOutcome: null,
        cropActivities: [],
        irrigation: [],
        labour: [{ id: `${id}-crew`, type: 'HIRED', count: 8, wagePerPerson: 432, totalCost: 3456 }],
        inputs: [{ id: 'in-1', productName: 'युरिया', cost: 777, numbers: { cost: { certainty: 'reported' }, dose: { certainty: 'reported' } }, mix: [] }],
        machinery: [{ id: 'm-1', type: 'tractor', ownership: 'rented', hoursUsed: 3, rentalCost: 1500, fuelCost: 600 }],
        activityExpenses: [{ id: 'e-1', reason: 'बियाणे', items: [{ id: 'i-1', name: 'बियाणे', qty: 2, unitPrice: 1100, total: 2200 }], totalAmount: 2200 }],
        financialSummary: { totalLabourCost: 3456, totalInputCost: 777, totalMachineryCost: 2100, grandTotal: 6333 },
        meta: { createdAtISO: AT, createdByOperatorId: maker, farmId },
    } as unknown as DailyLog;
}

async function putLog(db: AgriLogDatabase, log: DailyLog, fromServer = true) {
    await db.logs.put({
        id: log.id,
        schemaVersion: 2,
        log,
        date: log.date,
        createdByOperatorId: log.meta?.createdByOperatorId,
        isDeleted: 0,
        ...(fromServer ? { serverModifiedAtUtc: AT } : {}),
    });
}

async function seed(db: AgriLogDatabase) {
    for (const farmId of [FARM_A, FARM_GONE]) {
        await db.farms.put({ id: farmId, payload: { id: farmId }, updatedAt: AT });
        await db.plots.put({ id: `plot-${farmId}`, farmId, payload: {}, updatedAt: AT });
        await db.cropCycles.put({ id: `cycle-${farmId}`, farmId, plotId: `plot-${farmId}`, payload: {}, updatedAt: AT });
        await db.plannedTasks.put({ id: `plan-${farmId}`, cropCycleId: `cycle-${farmId}`, plannedDate: '2026-10-01', payload: {}, updatedAt: AT });
        await db.costEntries.put({ id: `cost-${farmId}`, farmId, payload: { id: `cost-${farmId}`, farmId, amount: 9876 }, updatedAt: AT });
        await db.financeCorrections.put({ id: `fc-${farmId}`, costEntryId: `cost-${farmId}`, payload: {}, updatedAt: AT });
        await db.dayLedgers.put({ id: `ledger-${farmId}`, farmId, dateKey: '2026-10-30', payload: {}, updatedAt: AT });
        await db.attendanceMarks.put({
            id: `mark-${farmId}`, farmId, fieldOperatorId: 'op', workDate: '2026-10-30', updatedAt: AT,
            payload: { id: `mark-${farmId}`, farmId } as never,
        });
        await db.attachments.put({
            id: `receipt-${farmId}`, farmId, linkedEntityId: `cost-${farmId}`, linkedEntityType: 'CostEntry', localPath: '',
            originalFileName: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 1, status: 'uploaded', remoteAttachmentId: `receipt-${farmId}`,
            createdAt: AT, updatedAt: AT, retryCount: 0,
        });
    }

    await db.appMeta.put({
        key: COST_MIRROR,
        value: [{ id: `cost-${FARM_A}`, farmId: FARM_A }, { id: `cost-${FARM_GONE}`, farmId: FARM_GONE }],
        updatedAt: AT,
    });
    await putLog(db, pricedLog('owner-log', FARM_A, OWNER));
    await putLog(db, pricedLog('my-log', FARM_A, ME));
    await putLog(db, pricedLog('gone-log', FARM_GONE, OWNER));
    await putLog(db, pricedLog('pending-log', FARM_GONE, OWNER));
    await putLog(db, pricedLog('phone-only-log', FARM_A, 'owner'), false);
}

const run = (db: AgriLogDatabase, scopes: FarmAccessScopeDto[] | undefined, pending = new Set(['pending-log'])) =>
    reconcileAccessScopes(db, { accessScopes: scopes } as unknown as SyncPullResponse, {
        userId: ME, pendingLogIds: pending, receivedAtUtc: AT,
    });

let db: AgriLogDatabase;

beforeEach(async () => {
    db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
    await seed(db);
    currentFarm = FARM_A;
});

describe('accessScopeReconciler (lane MU-3)', () => {
    it('purges a farm the server says by name he no longer reads — and never the outbox, a phone-only record or anything of a farm it still sends', async () => {
        const outcome = await run(db, [scope(FARM_A), removed(FARM_GONE)]);

        expect(outcome.outOfScopeFarmIds).toEqual([FARM_GONE]);
        expect(await db.farms.get(FARM_GONE)).toBeUndefined();
        expect(await db.plots.get(`plot-${FARM_GONE}`)).toBeUndefined();
        expect(await db.cropCycles.get(`cycle-${FARM_GONE}`)).toBeUndefined();
        expect(await db.plannedTasks.get(`plan-${FARM_GONE}`)).toBeUndefined();
        expect(await db.costEntries.get(`cost-${FARM_GONE}`)).toBeUndefined();
        expect(await db.financeCorrections.get(`fc-${FARM_GONE}`)).toBeUndefined();
        expect(await db.dayLedgers.get(`ledger-${FARM_GONE}`)).toBeUndefined();
        expect(await db.attendanceMarks.get(`mark-${FARM_GONE}`)).toBeUndefined();
        expect(await db.attachments.get(`receipt-${FARM_GONE}`)).toBeUndefined();
        expect(await db.logs.get('gone-log')).toBeUndefined();

        // P10 — a record with a change still in the outbox is unsynced intent, not cache.
        expect(await db.logs.get('pending-log')).toBeDefined();
        // Farm A is untouched, every amount of it included.
        expect(await db.farms.get(FARM_A)).toBeDefined();
        expect(await db.costEntries.get(`cost-${FARM_A}`)).toBeDefined();
        expect((await db.logs.get('owner-log'))!.log.inputs[0].cost).toBe(777);
        expect(await db.logs.get('phone-only-log')).toBeDefined();
        const mirror = (await db.appMeta.get(COST_MIRROR))!.value as { farmId: string }[];
        expect(mirror.map(r => r.farmId)).toEqual([FARM_A]);
        expect((await readAccessScopes(db))!.scopes).toEqual([scope(FARM_A), removed(FARM_GONE)]);
    });

    it('without SEE MONEY: no money row stays, another person\'s record loses every amount (shown as withheld, never ₹0), his own record is whole', async () => {
        await run(db, [scope(FARM_A, { seeMoney: false, seeWages: false }), scope(FARM_GONE)]);

        expect(await db.costEntries.get(`cost-${FARM_A}`)).toBeUndefined();
        expect(await db.financeCorrections.get(`fc-${FARM_A}`)).toBeUndefined();
        expect(await db.dayLedgers.get(`ledger-${FARM_A}`)).toBeUndefined();
        expect(await db.attachments.get(`receipt-${FARM_A}`)).toBeUndefined();
        expect(await db.costEntries.get(`cost-${FARM_GONE}`)).toBeDefined(); // a farm where he sees money keeps its money

        const other = (await db.logs.get('owner-log'))!.log;
        const text = JSON.stringify(other);
        for (const amount of ['777', '1500', '600', '2200', '1100', '432', '3456', '6333']) {
            expect(text).not.toContain(amount);
        }
        expect(other.financialSummary).toBeUndefined();
        expect(other.labour[0].count).toBe(8);
        expect(other.inputs[0].productName).toBe('युरिया');
        expect(other.machinery[0].hoursUsed).toBe(3);
        expect((other.inputs[0] as { numbers?: Record<string, unknown> }).numbers?.dose).toBeDefined();

        const mine = (await db.logs.get('my-log'))!.log;
        expect(mine.inputs[0].cost).toBe(777);
        expect(mine.labour[0].wagePerPerson).toBe(432);
        expect((await db.logs.get('phone-only-log'))!.log.inputs[0].cost).toBe(777);
    });

    it('without SEE WAGES (money kept): only the per-person wage on another person\'s labour goes — a crew total is money (fix 1, F4)', async () => {
        await run(db, [scope(FARM_A, { seeWages: false }), scope(FARM_GONE)]);
        const other = (await db.logs.get('owner-log'))!.log;
        expect(other.labour[0].wagePerPerson).toBeUndefined();
        expect(other.labour[0].wageWithheld).toBe(true);
        expect(other.labour[0].totalCost).toBe(3456);
        expect(other.labour[0].count).toBe(8);
        expect(other.inputs[0].cost).toBe(777);
        expect(await db.costEntries.get(`cost-${FARM_A}`)).toBeDefined();
    });

    it('OWN RECORDS ONLY: every record someone else made goes, his own and the phone\'s own stay; no attendance without हजेरी', async () => {
        await run(db, [scope(FARM_A, { ownRecordsOnly: true, seeMoney: false, seeWages: false, seeAttendance: false, seeFarmOverview: false }), scope(FARM_GONE)]);
        expect(await db.logs.get('owner-log')).toBeUndefined();
        expect(await db.logs.get('my-log')).toBeDefined();
        expect(await db.logs.get('phone-only-log')).toBeDefined();
        expect(await db.attendanceMarks.get(`mark-${FARM_A}`)).toBeUndefined();
        expect(await db.plannedTasks.get(`plan-${FARM_A}`)).toBeUndefined();
    });

    it('an older server (no scopes on the wire) changes nothing at all', async () => {
        const before = await db.logs.count();
        const outcome = await run(db, undefined);
        expect(outcome.applied).toBe(false);
        expect(await db.logs.count()).toBe(before);
        expect(await db.farms.get(FARM_GONE)).toBeDefined();
        expect(await db.costEntries.count()).toBe(2);
    });

    it('an unreadable outbox touches no record at all', async () => {
        await reconcileAccessScopes(db, { accessScopes: [scope(FARM_A, { ownRecordsOnly: true, seeMoney: false })] } as unknown as SyncPullResponse, {
            userId: ME, pendingLogIds: undefined, receivedAtUtc: AT,
        });
        expect(await db.logs.get('owner-log')).toBeDefined();
        expect((await db.logs.get('owner-log'))!.log.inputs[0].cost).toBe(777);
    });

    it('needs no Dexie version bump: the shipped version, existing stores only', () => {
        expect(DATABASE_VERSION).toBe(25);
        expect(db.verno).toBe(25);
        for (const name of ['farms', 'plots', 'cropCycles', 'costEntries', 'financeCorrections', 'dayLedgers', 'attendanceMarks',
            'plannedTasks', 'attachments', 'logs', 'jobCards', 'testInstances', 'testRecommendations', 'complianceSignals', 'appMeta']) {
            expect(db.tables.map(t => t.name)).toContain(name);
        }
    });

    it('the save path refuses a farm the server stopped sending, with words he can read — and nothing is written', async () => {
        await run(db, [scope(FARM_A), removed(FARM_GONE, 'Paused')]);
        expect(((await db.appMeta.get(OUT_OF_SCOPE_FARMS_META_KEY))!.value as { farmIds: string[] }).farmIds).toEqual([FARM_GONE]);
        await expect(assertFarmsInScope([FARM_A], db)).resolves.toBeUndefined();

        currentFarm = FARM_GONE;
        const batchSave = vi.fn().mockResolvedValue(undefined);
        const service = new LogCommandServiceImpl({ batchSave } as unknown as LogsRepository);
        const fresh = { ...pricedLog('new-log', FARM_GONE, ME), meta: { createdAtISO: AT, createdByOperatorId: ME } } as DailyLog;
        const refusal = await service.confirmAndSave([fresh]).catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(FarmOutOfScopeError);
        expect((refusal as FarmOutOfScopeError).messageMr).not.toMatch(/AI|policy|permission|role|access/i);
        expect(batchSave).not.toHaveBeenCalled();

        // The owner lets him back in: the next pull lists the farm and the refusal lifts.
        await run(db, [scope(FARM_A), scope(FARM_GONE)]);
        await expect(assertFarmsInScope([FARM_GONE], db)).resolves.toBeUndefined();
    });

    it('F9: a farm merely ABSENT from the answer is never wiped; nor one he registered; nor anything when the phone does not know who he is', async () => {
        await db.farms.put({ id: FARM_MINE, payload: { id: FARM_MINE, ownerUserId: ME }, updatedAt: AT });
        await db.plots.put({ id: `plot-${FARM_MINE}`, farmId: FARM_MINE, payload: {}, updatedAt: AT });

        const absent = await run(db, [scope(FARM_A)]);
        expect(absent.outOfScopeFarmIds).toEqual([]);
        expect(await db.farms.get(FARM_GONE)).toBeDefined();
        expect(await db.logs.get('gone-log')).toBeDefined();
        expect(await db.costEntries.get(`cost-${FARM_GONE}`)).toBeDefined();

        const mine = await run(db, [scope(FARM_A), removed(FARM_MINE), removed(FARM_GONE)]);
        expect(mine.outOfScopeFarmIds).toEqual([FARM_GONE]);
        expect(await db.farms.get(FARM_MINE)).toBeDefined();
        expect(await db.plots.get(`plot-${FARM_MINE}`)).toBeDefined();

        // A farm row this phone made and has not sent yet is unsent intent (P10), whatever the answer says.
        await db.farms.put({ id: FARM_NEW, payload: { id: FARM_NEW }, syncStatus: 'provisional', updatedAt: AT });
        await run(db, [scope(FARM_A), removed(FARM_NEW)]);
        expect(await db.farms.get(FARM_NEW)).toBeDefined();

        await seed(db);
        const unknown = await reconcileAccessScopes(db, { accessScopes: [scope(FARM_A), removed(FARM_GONE)] } as unknown as SyncPullResponse, {
            userId: null, pendingLogIds: new Set(), receivedAtUtc: AT,
        });
        expect(unknown.outOfScopeFarmIds).toEqual([]);
        expect(await db.farms.get(FARM_GONE)).toBeDefined();
    });

    it('F2: without SEE MONEY a bill photo goes — the new Bill marker and every farm-linked bill of an earlier build', async () => {
        for (const [id, type] of [['bill-new', 'Bill'], ['bill-old', 'Farm']] as const) {
            await db.attachments.put({
                id, farmId: FARM_A, linkedEntityId: FARM_A, linkedEntityType: type, localPath: '', originalFileName: 'bill.jpg',
                mimeType: 'image/jpeg', sizeBytes: 1, status: 'uploaded', remoteAttachmentId: id, createdAt: AT, updatedAt: AT, retryCount: 0,
            });
        }

        await run(db, [scope(FARM_A, { seeMoney: false, seeWages: false }), scope(FARM_GONE)]);
        expect(await db.attachments.get('bill-new')).toBeUndefined();
        expect(await db.attachments.get('bill-old')).toBeUndefined();
    });

    it('F2: a seat that sees money keeps its bills', async () => {
        await db.attachments.put({
            id: 'bill-new', farmId: FARM_A, linkedEntityId: FARM_A, linkedEntityType: 'Bill', localPath: '', originalFileName: 'bill.jpg',
            mimeType: 'image/jpeg', sizeBytes: 1, status: 'uploaded', remoteAttachmentId: 'bill-new', createdAt: AT, updatedAt: AT, retryCount: 0,
        });
        await run(db, [scope(FARM_A), scope(FARM_GONE)]);
        expect(await db.attachments.get('bill-new')).toBeDefined();
    });

    it('F3/F10: without SEE MONEY another person\'s record that mentions money keeps its work and loses its words; a withheld wage says so', async () => {
        const said = {
            ...pricedLog('said-log', FARM_A, OWNER),
            fullTranscript: 'आज ५ मजूर, प्रत्येकी ४०० रुपये',
            cropActivities: [{ id: 'c1', title: 'छाटणी', sourceText: 'छाटणी केली', systemInterpretation: 'छाटणी', notes: 'चांगली' }],
        } as unknown as DailyLog;
        await putLog(db, said);
        const plain = {
            ...pricedLog('plain-log', FARM_A, OWNER), labour: [], inputs: [], machinery: [], activityExpenses: [],
            fullTranscript: 'आज बागेत छाटणी केली',
        } as unknown as DailyLog;
        delete (plain as { financialSummary?: unknown }).financialSummary;
        await putLog(db, plain);

        await run(db, [scope(FARM_A, { seeMoney: false, seeWages: false }), scope(FARM_GONE)]);

        const kept = (await db.logs.get('said-log'))!.log;
        expect(kept.wordsWithheldForMoney).toBe(true);
        expect(kept.fullTranscript).toBeUndefined();
        expect(kept.cropActivities[0]).toEqual({ id: 'c1', title: 'छाटणी' });
        expect(kept.labour[0].wageWithheld).toBe(true);
        expect(kept.labour[0].totalCostWithheld).toBe(true);
        expect(kept.labour[0].count).toBe(8);
        expect((await db.logs.get('plain-log'))!.log.fullTranscript).toBe('आज बागेत छाटणी केली');
        expect((await db.logs.get('my-log'))!.log.wordsWithheldForMoney).toBeUndefined();
    });

    it('F7: job cards are the farm\'s work — kept, another worker\'s pay taken off without SEE WAGES; a कामगार keeps only his own', async () => {
        const card = (id: string, worker: string) => ({
            id, farmId: FARM_A, plotId: `plot-${FARM_A}`, createdByUserId: OWNER, assignedWorkerUserId: worker, plannedDate: '2026-10-30',
            status: 'Assigned', estimatedTotalAmount: 6129, estimatedTotalCurrency: 'INR', createdAtUtc: AT, modifiedAtUtc: AT,
            lineItems: [{ activityType: 'spray', expectedHours: 4, ratePerHourAmount: 1532, ratePerHourCurrencyCode: 'INR' }],
        });
        await db.jobCards.bulkPut([card('jc-other', OWNER), card('jc-mine', ME)] as never);

        await run(db, [scope(FARM_A, { seeMoney: false, seeWages: false }), scope(FARM_GONE)]);
        const other = (await db.jobCards.get('jc-other'))!;
        expect(other.estimatedTotalAmount).toBeNull();
        expect(other.lineItems[0].ratePerHourAmount).toBeNull();
        expect(other.lineItems[0].expectedHours).toBe(4);
        expect((await db.jobCards.get('jc-mine'))!.estimatedTotalAmount).toBe(6129);

        await run(db, [scope(FARM_A, { ownRecordsOnly: true, seeMoney: false, seeWages: false, seeFarmOverview: false }), scope(FARM_GONE)]);
        expect(await db.jobCards.get('jc-other')).toBeUndefined();
        expect(await db.jobCards.get('jc-mine')).toBeDefined();
    });

    it('item 14: a gone farm\'s plots leave the crop list, and a कामगार\'s profile keeps only himself', async () => {
        await db.crops.bulkPut([
            { id: 'crop-a', data: { id: 'crop-a', name: 'Grapes', plots: [{ id: `plot-${FARM_A}` }, { id: `plot-${FARM_GONE}` }] }, updatedAtMs: 1 },
            { id: 'crop-gone', data: { id: 'crop-gone', name: 'Onion', plots: [{ id: `plot-${FARM_GONE}` }] }, updatedAtMs: 1 },
        ] as never);
        await db.farmerProfile.put({
            id: 'self', updatedAtMs: 1,
            data: { name: 'x', operators: [{ id: ME, name: 'मी' }, { id: OWNER, name: 'मालक' }] },
        } as never);

        await run(db, [scope(FARM_A, { ownRecordsOnly: true, seeMoney: false, seeWages: false, seeFarmOverview: false }), removed(FARM_GONE)]);

        const crops = await db.crops.toArray();
        expect(crops.map(c => c.id)).toEqual(['crop-a']);
        expect((crops[0].data as { plots: { id: string }[] }).plots.map(p => p.id)).toEqual([`plot-${FARM_A}`]);
        const profile = (await db.farmerProfile.get('self'))!.data as { operators: { id: string }[] };
        expect(profile.operators.map(o => o.id)).toEqual([ME]);
    });

    it('withoutMoney returns the very same record when it states no money', () => {
        const plain = { ...pricedLog('x', FARM_A, OWNER), labour: [], inputs: [], machinery: [], activityExpenses: [], financialSummary: undefined } as unknown as DailyLog;
        delete (plain as { financialSummary?: unknown }).financialSummary;
        expect(withoutMoney(plain)).toBe(plain);
    });
});
