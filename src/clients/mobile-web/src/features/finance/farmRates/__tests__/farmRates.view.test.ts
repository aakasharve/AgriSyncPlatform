/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 * What the दरपत्रक reads for one farm, online and offline (a real Dexie, fake-indexeddb, no version bump):
 *   - online: the server's rows are merged into this phone's copy and its "may write" / "sees work rates" are remembered;
 *   - offline: the remembered answer stands; before any answer, the role the server last told this phone stands in;
 *   - a seat that does not read work rates never sees one, even one this phone still held;
 *   - drafts and suggestions are offered only to a person who may set rates.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, type AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

const h = vi.hoisted(() => ({ server: null as unknown, suggestions: [] as unknown[], offline: false, suggestionCalls: 0 }));
vi.mock('../farmRatesApi', () => ({
    fetchFarmRates: async () => {
        if (h.offline) throw new Error('offline');
        const s = h.server as { rates?: unknown[] } | null;
        return s ? { rawRates: s.rates ?? [], unreadable: 0, ...s } : s;
    },
    fetchRateSuggestions: async () => { h.suggestionCalls++; if (h.offline) throw new Error('offline'); return h.suggestions; },
}));

import { loadFarmRatesView } from '../useFarmRates';
import { mergeFarmRates } from '../farmRatesStore';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ME = '22222222-2222-4222-8222-222222222222';
const AT = '2026-11-06T06:00:00.000Z';
const rate = (id: string, kind: 'Input' | 'Work' = 'Input') => ({
    id, rateLineId: `line-${id}`, farmId: FARM, version: 1, kind, itemName: 'युरिया', unit: kind === 'Input' ? 'पोते' : null,
    basis: kind === 'Input' ? 'PerUnit' : 'PerDay', workerCategory: null, amount: 1350, currencyCode: 'INR', effectiveFrom: '2026-11-01',
    season: null, endsOn: null, retired: false, suggestionId: null, createdByUserId: ME, createdAtUtc: '2026-11-01T05:00:00.5Z',
});

let db: AgriLogDatabase;

beforeEach(async () => {
    db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
    h.offline = false;
    h.server = null;
    h.suggestions = [];
    h.suggestionCalls = 0;
});

describe('online', () => {
    it('merges the server\'s rows, takes its "may write", and offers drafts and suggestions to him', async () => {
        h.server = { mayWrite: true, seeInputPrices: true, seeWorkRates: true, rates: [rate('a'), rate('w', 'Work')] };
        h.suggestions = [{ id: 's', itemName: 'पोटॅश', unitPrice: 1700, currencyCode: 'INR', effectiveFrom: '2026-10-01' }];
        await db.mutationQueue.add({
            deviceId: 'd', clientRequestId: 'old', clientCommandId: 'old', mutationType: SyncMutationName.SetPriceConfig,
            payload: { category: 'जुना', unitPrice: 90 }, status: 'REJECTED_USER_REVIEW', createdAt: AT, updatedAt: AT, retryCount: 0,
        } as never);
        const view = await loadFarmRatesView(FARM, { isPrimaryHolder: false, selfUserId: ME }, db);
        expect(view.fromServer).toBe(true);
        expect(view.mayWrite).toBe(true);
        expect(view.rows.map(r => r.id).sort()).toEqual(['a', 'w']);
        expect(view.suggestions).toHaveLength(1);
        expect(view.drafts.map(d => d.itemName)).toEqual(['जुना']);
    });

    it('a seat the server says may not write gets no drafts and no suggestions', async () => {
        h.server = { mayWrite: false, seeInputPrices: true, seeWorkRates: false, rates: [rate('a')] };
        h.suggestions = [{ id: 's', itemName: 'पोटॅश', unitPrice: 1700, currencyCode: 'INR', effectiveFrom: '2026-10-01' }];
        const view = await loadFarmRatesView(FARM, { isPrimaryHolder: true, selfUserId: ME }, db);
        expect(view.mayWrite).toBe(false);
        expect(view.seeWorkRates).toBe(false);
        expect(view.suggestions).toEqual([]);
        expect(view.drafts).toEqual([]);
    });
});

describe('offline', () => {
    it('the remembered answer stands, and a work rate this phone still held is not shown without see wages', async () => {
        h.server = { mayWrite: false, seeInputPrices: true, seeWorkRates: false, rates: [rate('a')] };
        await loadFarmRatesView(FARM, { selfUserId: ME }, db);
        await mergeFarmRates(db, [rate('w', 'Work')], AT);
        h.offline = true;
        const view = await loadFarmRatesView(FARM, { isPrimaryHolder: true, selfUserId: ME }, db);
        expect(view.fromServer).toBe(false);
        expect(view.mayWrite).toBe(false);
        expect(view.rows.map(r => r.id)).toEqual(['a']);
    });

    it('before any answer, the role the server last told this phone stands in (the server still decides on arrival)', async () => {
        h.offline = true;
        expect((await loadFarmRatesView(FARM, { isPrimaryHolder: true, selfUserId: ME }, db)).mayWrite).toBe(true);
        expect((await loadFarmRatesView(FARM, { isPrimaryHolder: false, selfUserId: ME }, db)).mayWrite).toBe(false);
        expect((await loadFarmRatesView(FARM, { selfUserId: ME }, db)).mayWrite).toBe(false);
    });

    it('no farm open: nothing is read', async () => {
        const view = await loadFarmRatesView(null, { selfUserId: ME }, db);
        expect(view).toMatchObject({ loading: false, rows: [], mayWrite: false });
    });
});

// ── fix round 1 (review F1 / F5 / F7) ─────────────────────────────────────────────────────────────────────────────
describe('fix round 1', () => {
    it('F1: the server says this seat reads no rate (own records only): no row is shown, even one the phone still held', async () => {
        await mergeFarmRates(db, [rate('a'), rate('w', 'Work')], AT);
        h.server = { mayWrite: false, seeInputPrices: false, seeWorkRates: false, rates: [] };
        const view = await loadFarmRatesView(FARM, { selfUserId: ME }, db);
        expect(view.seeInputPrices).toBe(false);
        expect(view.rows).toEqual([]);
    });

    it('F1 offline: the pull scopes say own records only → no row, the rule instead', async () => {
        await mergeFarmRates(db, [rate('a')], AT);
        await db.appMeta.put({
            key: 'shramsafal_access_scopes_v1',
            value: { receivedAtUtc: AT, scopes: [{ farmId: FARM, ownRecordsOnly: true, seeMoney: true, seeWages: true, seeAttendance: false,
                seeTests: false, seeCompliance: false, seeFarmOverview: false }] },
            updatedAt: AT,
        });
        h.offline = true;
        const view = await loadFarmRatesView(FARM, { selfUserId: ME }, db);
        expect(view).toMatchObject({ seeInputPrices: false, seeWorkRates: false, rows: [] });
    });

    it('F5: rows the phone could not read are said (a REST read counts them for its farm)', async () => {
        h.server = { mayWrite: true, seeInputPrices: true, seeWorkRates: true, rates: [rate('a'), { ...rate('bad'), amount: 0 }] };
        expect((await loadFarmRatesView(FARM, { selfUserId: ME }, db)).unreadable).toBe(1);
        h.server = { mayWrite: true, seeInputPrices: true, seeWorkRates: true, rates: [rate('a')] };
        expect((await loadFarmRatesView(FARM, { selfUserId: ME }, db)).unreadable).toBeUndefined();
    });

    it('F7: suggestions are asked for only by a person who may set rates', async () => {
        h.server = { mayWrite: false, seeInputPrices: true, seeWorkRates: true, rates: [] };
        await loadFarmRatesView(FARM, { selfUserId: ME }, db);
        expect(h.suggestionCalls).toBe(0);
        h.server = { mayWrite: true, seeInputPrices: true, seeWorkRates: true, rates: [] };
        await loadFarmRatesView(FARM, { selfUserId: ME }, db);
        expect(h.suggestionCalls).toBe(1);
    });
});
