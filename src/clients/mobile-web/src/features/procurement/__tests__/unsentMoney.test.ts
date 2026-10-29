// @vitest-environment jsdom
/**
 * spec: pre-launch-repair L2b (R-4; founder D-41 phase A) — "फोनवर राहिलेल्या नोंदी — पाठवायच्या":
 *   - lists EXACTLY what never reached the server: bill lines (by their derived id OR — for bills sent by older
 *     builds under random ids — by their `<billId>:<lineId>` description), kept money (a log's money with no
 *     farm known re-derives its farm from the log, L2a reviewer m2), bill photos never queued;
 *   - claims nothing before the first download;
 *   - sends only to the farm given, under the ORIGINAL id, so a second send adds nothing;
 *   - survives a restart (everything is read from durable stores, nothing from the session).
 * Real Dexie (fake-indexeddb), real MutationQueue + validator, real procurement store; only the photo queue
 * and the upload worker are stubbed.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureAttachment = vi.fn();
vi.mock('../../../application/use-cases/CaptureAttachment', () => ({ captureAttachment: (...a: unknown[]) => captureAttachment(...a) }));
vi.mock('../../../infrastructure/sync/AttachmentUploadWorker', () => ({ attachmentUploadWorker: { triggerNow: vi.fn() } }));

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { procurementRepository } from '../../../services/procurementRepository';
import { financeService } from '../../finance/financeService';
import { moneyEntryIdFor } from '../../finance/moneyEntryIdentity';
import { holdMoney, readHeldMoney } from '../../finance/heldMoney';
import { resetUnqueueableLogs } from '../../sync/status/unqueueableLogs';
import { listUnsentMoney, recoveredPhotoIdFor, sendUnsentGroup } from '../unsentMoney';
import type { ProcurementExpense } from '../procurement.types';
import type { MoneySourcePayload } from '../../finance/finance.types';

const FARM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLOT_A1 = '11111111-1111-4111-8111-111111111111';
const PLOT_A2 = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-29T00:00:00Z';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const line = (id: string, amount: number) => ({ id, name: id, totalAmount: amount, category: 'FERTILIZER' });
const bill = (id: string, over: Partial<ProcurementExpense> = {}): ProcurementExpense => ({
    id, date: '2026-10-20', createdAt: NOW, scope: 'FARM', vendorName: `दुकान ${id}`,
    lineItems: [line(`${id}-l1`, 100), line(`${id}-l2`, 200)] as never, subtotal: 300, grandTotal: 300,
    aiExtracted: true, userVerified: true, ...over,
});
const money = (sourceId: string, over: Partial<MoneySourcePayload> = {}): MoneySourcePayload => ({
    type: 'VoiceLog', sourceId, dateTime: '2026-10-21T12:00:00', eventType: 'Expense', category: 'Input', amount: 450, ...over,
});

/** What THIS phone queued (the old build's seeded row is not counted). */
async function queuedIds(): Promise<string[]> {
    const rows = await getDatabase().mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray();
    return rows.filter(r => r.deviceId !== 'old').map(r => (r.payload as { costEntryId: string }).costEntryId).sort();
}

beforeEach(async () => {
    const db = getDatabase();
    await Promise.all([
        db.mutationQueue.clear(), db.costEntries.clear(), db.uiPrefs.clear(), db.syncCursors.clear(),
        db.plots.clear(), db.cropCycles.clear(), db.farms.clear(), db.logs.clear(), db.attachments.clear(),
    ]);
    localStorage.clear();
    financeService._updateEvents(() => []);
    resetUnqueueableLogs();
    captureAttachment.mockResolvedValue({ id: 'ignored', status: 'pending' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await db.farms.put({ id: FARM_A, payload: { id: FARM_A }, updatedAt: NOW } as never);
    await db.plots.bulkPut([
        { id: PLOT_A1, farmId: FARM_A, payload: { id: PLOT_A1, farmId: FARM_A }, updatedAt: NOW },
        { id: PLOT_A2, farmId: FARM_A, payload: { id: PLOT_A2, farmId: FARM_A }, updatedAt: NOW },
    ]);

    // Bill A — both lines sent by an OLD build: random ids, description = the line's key. One still in the
    // outbox (applied), one only in the server's copy from the last download.
    procurementRepository.saveExpense(bill('A'));
    await db.mutationQueue.add({
        deviceId: 'old', clientRequestId: 'x1', clientCommandId: 'x1', mutationType: SyncMutationName.AddCostEntry,
        payload: { costEntryId: '99999999-9999-4999-8999-999999999991', description: 'A:A-l1' }, status: 'APPLIED',
        createdAt: NOW, updatedAt: NOW, retryCount: 0,
    });
    await db.costEntries.put({ id: '99999999-9999-4999-8999-999999999992', farmId: FARM_A, payload: { description: 'A:A-l2' }, updatedAt: NOW });

    // Bill B — line 1 queued under its derived id, line 2 never.
    procurementRepository.saveExpense(bill('B', { farmId: FARM_A }));
    await db.costEntries.put({ id: moneyEntryIdFor('B:B-l1'), farmId: FARM_A, payload: { description: 'B:B-l1' }, updatedAt: NOW });

    // Bill C — saved before bills knew their farm; never sent.
    procurementRepository.saveExpense(bill('C', { lineItems: [line('C-l1', 700)] as never, grandTotal: 700 }));

    // Bill D — its money arrived, its photo was never queued.
    procurementRepository.saveExpense(bill('D', { lineItems: [line('D-l1', 50)] as never, grandTotal: 50, receiptImageUrl: PNG }));
    await db.costEntries.put({ id: 'd-on-server', farmId: FARM_A, payload: { description: 'D:D-l1' }, updatedAt: NOW });

    // A two-plot log saved while its farm was not known: its money was kept, and its plots are known NOW.
    await db.logs.put({ id: 'log-L', schemaVersion: 1, date: '2026-10-21',
        log: { id: 'log-L', date: '2026-10-21', context: { selection: [{ cropId: 'crop_x', cropName: 'x', selectedPlotIds: [PLOT_A1, PLOT_A2] }] } } as never } as never);
    await holdMoney({ costEntryId: moneyEntryIdFor('log-L:input:e1'), payload: money('log-L:input:e1', { farmId: null, logId: 'log-L' }), reason: 'no-farm', heldAt: NOW });

    // Money on a phone-only plot — stays on the phone.
    await holdMoney({ costEntryId: moneyEntryIdFor('log-P:labour:e1'), payload: money('log-P:labour:e1', { farmId: FARM_A, plotId: 'p_legacy', logId: 'log-P' }), reason: 'plot-not-on-server', heldAt: NOW });
});
afterEach(() => vi.restoreAllMocks());

describe('R-4 — what is still on this phone', () => {
    it('claims nothing before the first download — it cannot tell what the server holds', async () => {
        expect(await listUnsentMoney()).toEqual({ ready: false, groups: [] });
    });

    it('lists exactly the unsent — never what an old build already sent under another id', async () => {
        await mutationQueue.setCursor(NOW);
        const { ready, groups } = await listUnsentMoney();
        expect(ready).toBe(true);
        const byKey = Object.fromEntries(groups.map(g => [g.key, g]));
        expect(Object.keys(byKey).sort()).toEqual(['bill:B', 'bill:C', 'bill:D', 'log:log-L', 'log:log-P']);

        expect(byKey['bill:B'].entries.map(e => e.costEntryId)).toEqual([moneyEntryIdFor('B:B-l2')]);
        expect(byKey['bill:B']).toMatchObject({ total: 200, proposedFarmId: FARM_A, sendable: true });
        expect(byKey['bill:C']).toMatchObject({ total: 700, proposedFarmId: null, sendable: true });
        expect(byKey['bill:D']).toMatchObject({ entries: [], total: 0, photoDataUrl: PNG });
        // m2: the log's money finds its farm from the log, now that the log's plots are known.
        expect(byKey['log:log-L']).toMatchObject({ total: 450, proposedFarmId: FARM_A, sendable: true });
        expect(byKey['log:log-P']).toMatchObject({ sendable: false });
    });

    it('sends only to the confirmed farm, under the ORIGINAL id — a second send adds nothing', async () => {
        await mutationQueue.setCursor(NOW);
        const c = (await listUnsentMoney()).groups.find(g => g.key === 'bill:C')!;
        const first = await sendUnsentGroup(c, FARM_A);
        expect(first).toMatchObject({ queued: 1, kept: 0 });
        expect(await queuedIds()).toEqual([moneyEntryIdFor('C:C-l1')]);
        const row = (await getDatabase().mutationQueue.toArray()).find(r => r.deviceId !== 'old')!.payload as { farmId: string; description: string };
        expect(row).toMatchObject({ farmId: FARM_A, description: 'C:C-l1' });
        expect(procurementRepository.getExpenseById('C')?.farmId).toBe(FARM_A);

        await sendUnsentGroup(c, FARM_A);
        expect(await queuedIds()).toEqual([moneyEntryIdFor('C:C-l1')]);
        expect((await listUnsentMoney()).groups.map(g => g.key)).not.toContain('bill:C');
    });

    it('a kept log\'s money goes out once and leaves the kept list; a bill photo is queued once, as itself', async () => {
        await mutationQueue.setCursor(NOW);
        const groups = (await listUnsentMoney()).groups;
        await sendUnsentGroup(groups.find(g => g.key === 'log:log-L')!, FARM_A);
        expect(await queuedIds()).toEqual([moneyEntryIdFor('log-L:input:e1')]);
        expect((await readHeldMoney()).map(r => r.payload.sourceId)).toEqual(['log-P:labour:e1']);

        const d = groups.find(g => g.key === 'bill:D')!;
        const sent = await sendUnsentGroup(d, FARM_A);
        expect(sent.photoQueued).toBe(true);
        expect(captureAttachment).toHaveBeenCalledTimes(1);
        expect(captureAttachment).toHaveBeenCalledWith(expect.objectContaining({ farmId: FARM_A, attachmentId: recoveredPhotoIdFor('D'), mimeType: 'image/png' }));
        expect(procurementRepository.getExpenseById('D')?.attachmentIds).toEqual([recoveredPhotoIdFor('D')]);
        expect((await listUnsentMoney()).groups.map(g => g.key)).not.toContain('bill:D');
    });

    it('survives a restart: the session forgets, the list does not', async () => {
        await mutationQueue.setCursor(NOW);
        const before = (await listUnsentMoney()).groups.map(g => g.key);
        financeService._updateEvents(() => []);
        resetUnqueueableLogs();
        const after = (await listUnsentMoney()).groups.map(g => g.key);
        expect(after).toEqual(before);
    });
});
