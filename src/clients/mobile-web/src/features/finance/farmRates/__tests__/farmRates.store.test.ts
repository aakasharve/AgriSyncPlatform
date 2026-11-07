/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 *
 * The phone's copy of each farm's own rate list, on a real Dexie (fake-indexeddb) at the SHIPPED version — no bump:
 *   - a pull's rates are MERGED by id per farm; a later pull with fewer (or none) never empties the list (pre-flight T2);
 *   - a row the phone cannot read is never kept (it would read as a made-up rate);
 *   - the purge: no see money → the farm's whole list goes; no see wages → its work rates go; a farm gone → its list goes;
 *   - the shared list's mirror (`priceConfigs`) is merged too now (T2 — it used to be replaced by each delta);
 *   - the old price book's drafts left on this phone are found (D-43), never deleted.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, type AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { FarmAccessScopeDto } from '../../../../infrastructure/api/dtos';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { reconcileFinance } from '../../../sync/pull/reconcilers/financeReconciler';
import { reconcileAccessScopes } from '../../../sync/pull/reconcilers/accessScopeReconciler';
import { farmRatesMetaKey, mergeFarmRates, purgeFarmRatesOutOfScope, readFarmRates, readUnreadableFarmRates } from '../farmRatesStore';
import { MAX_AUTO_RETRY_COUNT } from '../../../../infrastructure/sync/retryCap';
import { categorizeRejection } from '../../../../infrastructure/sync/RejectionPolicy';
import { readQueuedFarmRates, readRateDrafts } from '../farmRateQueue';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const FARM_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const OWNER = '22222222-2222-4222-8222-222222222222';
const AT = '2026-11-06T06:00:00.000Z';

const rate = (id: string, over: Record<string, unknown> = {}) => ({
    id, rateLineId: `line-${id}`, farmId: FARM, version: 1, kind: 'Input', itemName: 'युरिया', unit: 'पोते', basis: 'PerUnit',
    workerCategory: null, amount: 1350, currencyCode: 'INR', effectiveFrom: '2026-11-01', season: null, endsOn: null, retired: false,
    suggestionId: null, createdByUserId: OWNER, createdAtUtc: '2026-11-01T05:00:00.5Z', ...over,
});

const scope = (over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({
    farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true,
    seeCompliance: true, seeFarmOverview: true, ...over,
});

const pull = (over: Partial<SyncPullResponse> = {}) => ({
    costEntries: [], financeCorrections: [], priceConfigs: [], ...over,
}) as unknown as SyncPullResponse;

let db: AgriLogDatabase;

beforeEach(async () => {
    db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
});

describe('merge by id, per farm', () => {
    it('each pull adds and replaces by id; a later pull with nothing never empties the list', async () => {
        await reconcileFinance(db, pull({ farmRates: [rate('a'), rate('b', { farmId: FARM_B })] } as never), AT);
        await reconcileFinance(db, pull({ farmRates: [rate('a2', { rateLineId: 'line-a', version: 2, amount: 1400 })] } as never), AT);
        await reconcileFinance(db, pull(), AT);
        expect((await readFarmRates(FARM, db)).map(r => [r.id, r.amount])).toEqual([['a', 1350], ['a2', 1400]]);
        expect((await readFarmRates(FARM_B, db)).map(r => r.id)).toEqual(['b']);
    });

    it('a row the phone cannot read is not kept (never a made-up ₹ 0)', async () => {
        const unreadable = await mergeFarmRates(db, [rate('ok'), rate('bad', { amount: 0 }), { id: 'x' }, 'junk'], AT);
        expect(unreadable).toBe(3);
        expect((await readFarmRates(FARM, db)).map(r => r.id)).toEqual(['ok']);
    });

    it('pre-flight T2: the shared list mirror is MERGED by id — an empty delta no longer empties it', async () => {
        await reconcileFinance(db, pull({ priceConfigs: [{ id: 'p1', itemName: 'जुना', unitPrice: 90 }] }), AT);
        await reconcileFinance(db, pull({ priceConfigs: [] }), AT);
        await reconcileFinance(db, pull({ priceConfigs: [{ id: 'p2', itemName: 'नवा', unitPrice: 95 }] }), AT);
        const held = (await db.appMeta.get('shramsafal_finance_price_configs_v1'))?.value as { id: string }[];
        expect(held.map(p => p.id)).toEqual(['p1', 'p2']);
    });
});

describe('the purge follows what the server says he may read', () => {
    beforeEach(async () => {
        await mergeFarmRates(db, [rate('in'), rate('work', { kind: 'Work', unit: null, basis: 'PerDay' }), rate('b', { farmId: FARM_B })], AT);
    });

    it('no see wages: the work rates go, the input prices stay', async () => {
        const removed = await purgeFarmRatesOutOfScope(db, new Map([[FARM, scope({ seeWages: false })]]), new Set(), AT);
        expect(removed).toBe(1);
        expect((await readFarmRates(FARM, db)).map(r => r.id)).toEqual(['in']);
        expect((await readFarmRates(FARM_B, db)).map(r => r.id)).toEqual(['b']);
    });

    it('no see money: the farm\'s whole list goes; a farm gone loses its list', async () => {
        await purgeFarmRatesOutOfScope(db, new Map([[FARM, scope({ seeMoney: false, seeWages: false })]]), new Set([FARM_B]), AT);
        expect(await db.appMeta.get(farmRatesMetaKey(FARM))).toBeUndefined();
        expect(await db.appMeta.get(farmRatesMetaKey(FARM_B))).toBeUndefined();
    });

    it('the access reconciler runs it on every pull that carries scopes', async () => {
        const outcome = await reconcileAccessScopes(db, pull({ accessScopes: [scope({ seeWages: false })] }), {
            userId: OWNER, pendingLogIds: new Set(), receivedAtUtc: AT,
        });
        expect(outcome.removedMoneyRows).toBeGreaterThanOrEqual(1);
        expect((await readFarmRates(FARM, db)).map(r => r.id)).toEqual(['in']);
    });
});

describe('what the phone still holds (P10; D-43)', () => {
    it('its own unsent and refused changes for this farm (an applied one is the server\'s)', async () => {
        const row = (clientRequestId: string, status: string, farmId = FARM, errorCode?: string) => db.mutationQueue.add({
            deviceId: 'd', clientRequestId, clientCommandId: clientRequestId, mutationType: SyncMutationName.SetFarmRate,
            payload: { farmRateId: clientRequestId, farmId, rateLineId: 'L', change: 'set' }, status, createdAt: AT, updatedAt: AT,
            retryCount: 0, ...(errorCode ? { errorCode } : {}),
        } as never);
        await row('w', 'PENDING');
        await row('r', 'REJECTED_USER_REVIEW', FARM, 'ShramSafal.FarmRate.Forbidden');
        await row('a', 'APPLIED');
        await row('other', 'PENDING', FARM_B);
        const queued = await readQueuedFarmRates(FARM, db);
        expect(queued.map(q => [q.payload.farmRateId, q.state, q.errorCode])).toEqual([
            ['w', 'waiting', undefined], ['r', 'refused', 'ShramSafal.FarmRate.Forbidden'],
        ]);
    });

    it('drafts the old price book left: both outbox shapes, his own shared-list rows; never deleted', async () => {
        const legacy = (clientRequestId: string, payload: Record<string, unknown>, status = 'REJECTED_USER_REVIEW') => db.mutationQueue.add({
            deviceId: 'd', clientRequestId, clientCommandId: clientRequestId, mutationType: SyncMutationName.SetPriceConfig, payload,
            status, createdAt: AT, updatedAt: AT, retryCount: 0,
        } as never);
        await legacy('old-shape', { configId: 'pb_1', category: 'फवारणी मजूर', unitPrice: 400, currencyCode: 'INR', unitType: 'दिवस', effectiveDate: '2026-10-01' });
        await legacy('contract-shape', { itemName: 'गंधक', unitPrice: 60, currencyCode: 'INR', effectiveFrom: '2026-10-02', version: 1 });
        await legacy('placeholder-unit', { category: 'तणनाशक', unitPrice: 700, unitType: 'unit' });
        await legacy('applied', { itemName: 'घेतला', unitPrice: 5 }, 'APPLIED');
        await db.appMeta.put({
            key: 'shramsafal_finance_price_configs_v1',
            value: [{ id: 'mine', itemName: 'माझा जुना दर', unitPrice: 88, createdByUserId: OWNER }, { id: 'theirs', itemName: 'दुसऱ्याचा', unitPrice: 77, createdByUserId: 'x' }],
            updatedAt: AT,
        });
        const drafts = await readRateDrafts(OWNER, db);
        expect(drafts.map(d => [d.itemName, d.amount, d.unit ?? null, d.source])).toEqual([
            ['फवारणी मजूर', 400, 'दिवस', 'outbox'],
            ['गंधक', 60, null, 'outbox'],
            ['तणनाशक', 700, null, 'outbox'],
            ['माझा जुना दर', 88, null, 'shared-list'],
        ]);
        expect(await db.mutationQueue.where('mutationType').equals(SyncMutationName.SetPriceConfig).count()).toBe(4);
    });
});

// ── fix round 1 (review F1 / F3 / F5) ─────────────────────────────────────────────────────────────────────────────
describe('fix round 1', () => {
    it('F1: a seat that reads only its own records loses the whole list, even holding see money and see wages', async () => {
        await mergeFarmRates(db, [rate('in'), rate('work', { kind: 'Work', unit: null, basis: 'PerDay' })], AT);
        const removed = await purgeFarmRatesOutOfScope(db, new Map([[FARM, scope({ ownRecordsOnly: true })]]), new Set(), AT);
        expect(removed).toBe(2);
        expect(await db.appMeta.get(farmRatesMetaKey(FARM))).toBeUndefined();
    });

    it('F5: rows the phone cannot read are COUNTED on their farm (or as nameless); a whole read of the farm replaces its count', async () => {
        await mergeFarmRates(db, [rate('ok'), rate('bad', { amount: 0 }), { id: 'x' }], AT);
        expect(await readUnreadableFarmRates(FARM, db)).toBe(2); // one on FARM, one naming no farm
        await mergeFarmRates(db, [rate('bad2', { amount: -1 })], AT);
        expect(await readUnreadableFarmRates(FARM, db)).toBe(3);
        await mergeFarmRates(db, [rate('ok')], AT, FARM); // the REST read: FARM's whole list, all readable
        expect(await readUnreadableFarmRates(FARM, db)).toBe(1); // only the nameless one is left
        expect(await readUnreadableFarmRates(FARM_B, db)).toBe(1);
    });

    it('F3: a change that gave up after its retries reads as refused (not saved), one still retrying as waiting', async () => {
        const add = (clientRequestId: string, retryCount: number) => db.mutationQueue.add({
            deviceId: 'd', clientRequestId, clientCommandId: clientRequestId, mutationType: SyncMutationName.SetFarmRate,
            payload: { farmRateId: clientRequestId, farmId: FARM, rateLineId: 'L', change: 'retire' }, status: 'FAILED',
            createdAt: AT, updatedAt: AT, retryCount, errorCode: 'ShramSafal.FarmRate.LineNotFound',
        } as never);
        await add('capped', MAX_AUTO_RETRY_COUNT);
        await add('retrying', 1);
        const queued = await readQueuedFarmRates(FARM, db);
        expect(queued.map(q => [q.payload.farmRateId, q.state])).toEqual([['capped', 'refused'], ['retrying', 'waiting']]);
    });

    it('F2 / F3: the two command-shape refusals park for good; a stop that came before its rate keeps retrying', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.FarmRate.UnknownSuggestion' })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: 'ShramSafal.FarmRate.KindChangeNotAllowed' })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: 'ShramSafal.FarmRate.Forbidden' })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: 'ShramSafal.FarmRate.LineNotFound' })).toBe('RETRYABLE');
    });
});
