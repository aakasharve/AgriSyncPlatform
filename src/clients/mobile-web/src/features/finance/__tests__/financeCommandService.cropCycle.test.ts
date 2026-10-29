// @vitest-environment jsdom
/**
 * spec: pre-launch-repair L2b (R-2; alignment N1) — a money entry tagged to a plot or crop must LEAVE THE PHONE.
 *
 * The phone sent its own crop label as the crop-season id (`cropCycleId: event.cropId` — `crop_<name>`,
 * `c_<uuid>` or `''`), the outbox's own check refused it, and the bill or voice expense was kept on the phone
 * with only a session note. Through the REAL MutationQueue + PayloadValidator over fake-indexeddb.
 *
 * REPRODUCTION FIRST: the payload the old code built for a plot-tagged bill and for a single-crop voice expense
 * fails the contract — that is why neither was ever queued. Then the fixed path: the server's own crop season,
 * resolved from the plot and the entry's date — or no season at all — and the entry queued.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../infrastructure/sync/PayloadValidator';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { financeCommandService } from '../financeCommandService';
import { financeService } from '../financeService';
import { moneyEntryIdFor } from '../moneyEntryIdentity';
import { readHeldMoney } from '../heldMoney';
import { getUnqueueableLogCount, resetUnqueueableLogs } from '../../sync/status/unqueueableLogs';
import type { MoneySourcePayload } from '../finance.types';

const FARM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FARM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLOT_A = '11111111-1111-4111-8111-111111111111';
const PLOT_B = '22222222-2222-4222-8222-222222222222';
const CYCLE_OLD = '33333333-3333-4333-8333-333333333333';
const CYCLE_NOW = '44444444-4444-4444-8444-444444444444';

type Queued = { costEntryId: string; plotId?: string; cropCycleId?: string; farmId: string };

async function queued(): Promise<Queued[]> {
    const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray();
    return rows.map(r => r.payload as Queued);
}

const bill = (sourceId: string, over: Partial<MoneySourcePayload> = {}): MoneySourcePayload => ({
    type: 'Procurement', sourceId, dateTime: '2026-10-20T00:00:00.000Z', eventType: 'Expense', category: 'Input',
    farmId: FARM_A, amount: 600, createdByUserId: 'owner', attachments: [], ...over,
});

const OLD_SHAPE = {
    costEntryId: '55555555-5555-4555-8555-555555555555', farmId: FARM_A, categoryId: 'other', description: 'b:l',
    amount: 600, currencyCode: 'INR', entryDate: '2026-10-20', direction: 'Expense', attachments: [],
};

beforeEach(async () => {
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.plots.clear(), db.cropCycles.clear(), db.uiPrefs.clear()]);
    financeService._updateEvents(() => []);
    resetUnqueueableLogs();
    SessionStore.clearCurrentFarmId();
    const now = '2026-10-01T00:00:00Z';
    await db.plots.bulkPut([
        { id: PLOT_A, farmId: FARM_A, payload: { id: PLOT_A, farmId: FARM_A }, updatedAt: now },
        { id: PLOT_B, farmId: FARM_B, payload: { id: PLOT_B, farmId: FARM_B }, updatedAt: now },
    ]);
    await db.cropCycles.bulkPut([
        { id: CYCLE_OLD, farmId: FARM_A, plotId: PLOT_A, updatedAt: now,
            payload: { id: CYCLE_OLD, cropName: 'Grapes', startDate: '2025-10-01', endDate: '2026-04-30', modifiedAtUtc: now } },
        { id: CYCLE_NOW, farmId: FARM_A, plotId: PLOT_A, updatedAt: now,
            payload: { id: CYCLE_NOW, cropName: 'Grapes', startDate: '2026-06-01', modifiedAtUtc: now } },
    ]);
});
afterEach(() => vi.restoreAllMocks());

describe('reproduction — what the old code put on the wire is refused by the contract (N1)', () => {
    it.each([
        ['a plot-tagged bill (crop label from the pull, toCropId)', 'crop_grapes'],
        ['a crop made on this phone (useCropPlotState)', 'c_9f1c2b0e-7f3a-4c55-9d1e-2a8b5c4d7e91'],
        ['a PLOT bill with no crop picked', ''],
    ])('%s → cropCycleId %j fails validation, so it was never queued', (_what, cropLabel) => {
        const result = validatePayload(SyncMutationName.AddCostEntry, { ...OLD_SHAPE, plotId: PLOT_A, cropCycleId: cropLabel });
        expect(result.ok).toBe(false);
    });
});

describe('the fix — the server crop season, or none; the entry is queued', () => {
    it('a plot-tagged bill names the plot and the season that contains its date — never the phone crop label', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        financeCommandService.createMoneyEventFromSource(bill('bill-1:line-1', { plotId: PLOT_A, cropId: 'crop_grapes' }));
        await vi.waitFor(async () => expect(await queued()).toHaveLength(1));
        const [row] = await queued();
        expect(row).toMatchObject({ costEntryId: moneyEntryIdFor('bill-1:line-1'), plotId: PLOT_A, cropCycleId: CYCLE_NOW });
        expect(JSON.stringify(row)).not.toContain('crop_');
        expect(getUnqueueableLogCount()).toBe(0);
    });

    it('a single-crop voice expense on one plot: queued with the season of the LOG\'s date (last season for an old log)', async () => {
        financeCommandService.createMoneyEventFromSource({
            ...bill('log-1:input:e1', { plotId: PLOT_A, cropId: 'c_9f1c2b0e-7f3a-4c55-9d1e-2a8b5c4d7e91' }),
            type: 'VoiceLog', dateTime: '2026-02-10T12:00:00', logId: 'log-1',
        });
        await vi.waitFor(async () => expect(await queued()).toHaveLength(1));
        expect((await queued())[0]).toMatchObject({ plotId: PLOT_A, cropCycleId: CYCLE_OLD });
    });

    it('a single-crop voice expense naming no plot: queued as whole-farm — no plot, no season (a crop alone names none)', async () => {
        financeCommandService.createMoneyEventFromSource({ ...bill('log-2:labour:e1', { cropId: 'crop_grapes' }), type: 'VoiceLog' });
        await vi.waitFor(async () => expect(await queued()).toHaveLength(1));
        const [row] = await queued();
        expect(row.plotId).toBeUndefined();
        expect(row.cropCycleId).toBeUndefined();
    });

    it('a date no season contains (bought before planting): the plot, and no season — never the nearest one', async () => {
        financeCommandService.createMoneyEventFromSource(bill('bill-2:line-1', { plotId: PLOT_A, dateTime: '2026-05-15T00:00:00.000Z' }));
        await vi.waitFor(async () => expect(await queued()).toHaveLength(1));
        const [row] = await queued();
        expect(row.plotId).toBe(PLOT_A);
        expect(row.cropCycleId).toBeUndefined();
    });

    it.each([
        ['a legacy phone-only plot (p_)', 'p_0b9a7c55-1d2e-4f3a-8b6c-7d8e9f0a1b2c'],
        ['a plot of ANOTHER farm', PLOT_B],
        ['a plot this phone does not know', '66666666-6666-4666-8666-666666666666'],
    ])('%s: NOT sent and not turned into a whole-farm entry — kept on the phone, written down, reported', async (_what, plotId) => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        financeCommandService.createMoneyEventFromSource(bill(`bill-3:${plotId}`, { plotId }));
        await vi.waitFor(async () => expect(await readHeldMoney()).toHaveLength(1));
        expect(await queued()).toEqual([]);
        expect(getUnqueueableLogCount()).toBe(1);
        const [kept] = await readHeldMoney();
        expect(kept).toMatchObject({ costEntryId: moneyEntryIdFor(`bill-3:${plotId}`), reason: 'plot-not-on-server' });
        expect(kept.payload).toMatchObject({ plotId, farmId: FARM_A, amount: 600 });
    });

    it('placing the entry throws (a malformed season row): kept on the phone, written down — never lost (P10)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await getDatabase().cropCycles.put(
            { id: 'bad-cycle', farmId: FARM_A, plotId: PLOT_A, updatedAt: '2026-10-01T00:00:00Z', payload: null } as never);
        financeCommandService.createMoneyEventFromSource(bill('bill-4:line-1', { plotId: PLOT_A }));
        await vi.waitFor(async () => expect(await readHeldMoney()).toHaveLength(1));
        expect(await queued()).toEqual([]);
        const [kept] = await readHeldMoney();
        expect(kept).toMatchObject({ costEntryId: moneyEntryIdFor('bill-4:line-1'), reason: 'refused-on-phone' });
    });
});

describe('R-1 — one identity per entry, however often it is made', () => {
    it('the id is derived from the source key: the same source always gives the same id, another source another', () => {
        expect(moneyEntryIdFor('bill-9:line-1')).toBe(moneyEntryIdFor('bill-9:line-1'));
        expect(moneyEntryIdFor('bill-9:line-1')).not.toBe(moneyEntryIdFor('bill-9:line-2'));
        expect(moneyEntryIdFor('bill-9:line-1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('a retry after the money list reloaded (the in-memory guard cannot see it) re-sends the SAME id — one queue row', async () => {
        financeCommandService.createMoneyEventFromSource(bill('bill-4:line-1'));
        await vi.waitFor(async () => expect(await queued()).toHaveLength(1));
        financeService._updateEvents(() => []); // the cache reloads from the server rows
        financeCommandService.createMoneyEventFromSource(bill('bill-4:line-1'));
        await new Promise(resolve => setTimeout(resolve, 20));
        const rows = await queued();
        expect(rows).toHaveLength(1);
        expect(rows[0].costEntryId).toBe(moneyEntryIdFor('bill-4:line-1'));
    });

    it('an entry read back from the server (its id, not its source key) is recognised and not made again', async () => {
        const id = moneyEntryIdFor('bill-5:line-1');
        const template = financeCommandService.createMoneyEventFromSource(bill('other'));
        await new Promise(resolve => setTimeout(resolve, 20));
        await getDatabase().mutationQueue.clear();
        // How `mapCostEntryToMoneyEvent` shows a server row: its id as the source id, type Manual.
        financeService._updateEvents(() => [{ ...template, id, sourceId: id, sourceType: 'Manual' }]);
        financeCommandService.createMoneyEventFromSource(bill('bill-5:line-1'));
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(await queued()).toEqual([]);
    });
});
