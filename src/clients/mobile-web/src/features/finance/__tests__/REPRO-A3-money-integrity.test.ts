/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 0 RUNTIME REPRODUCTION — PROBE A3 (money integrity).
 *
 * spec: docs/superpowers/specs/2026-08-14-FOUNDER-DIRECTION-after-phase-A.md §2 (A3), §6
 *
 * EVIDENCE ONLY. Nothing here is a fix. Every test below drives the REAL
 * production code path (real financeCommandService -> real command class ->
 * real PayloadValidator -> real MutationQueue -> real Dexie via
 * fake-indexeddb). No mocks: a mocked queue or validator would hide exactly
 * the defect being measured.
 *
 * A failing test in this file is the reproduction. A passing test is a
 * refutation of the corresponding Phase A claim.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { categorizeRejection } from '../../../infrastructure/sync/RejectionPolicy';
import { AddCostEntryCommand } from '../../../application/usecases/sync/AddCostEntryCommand';
import { CreateDailyLogCommand } from '../../../application/usecases/sync/CreateDailyLogCommand';
import { financeCommandService } from '../financeCommandService';
import type { MoneySourcePayload } from '../finance.types';

const FARM = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const COST_ENTRY = '33333333-3333-3333-3333-333333333333';
const PLOT = '44444444-4444-4444-4444-444444444444';
const LOG = '55555555-5555-5555-5555-555555555555';

/**
 * VERBATIM from the server allow-list:
 *   src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/
 *   PushSyncBatchHandler.cs:1166
 *
 *   if (!PayloadHasOnly(payload, "financeCorrectionId", "costEntryId",
 *       "correctedAmount", "currencyCode", "reason", "correctedByUserId"))
 *
 * PayloadHasOnly (same file, :1475-1492) rejects the WHOLE mutation if ANY
 * property name is outside this set (OrdinalIgnoreCase).
 */
const SERVER_CORRECT_COST_ENTRY_ALLOWLIST = [
    'financeCorrectionId',
    'costEntryId',
    'correctedAmount',
    'currencyCode',
    'reason',
    'correctedByUserId',
];

/** VERBATIM from PushSyncBatchHandler.cs:1168-1170 — what the server sends back. */
const SERVER_REJECTION = {
    errorCode: 'ShramSafal.SyncInvalidPayload',
    errorMessage: 'correct_cost_entry payload contains unsupported fields.',
};

async function flush(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

async function rowsOf(type: string) {
    return getDatabase().mutationQueue.where('mutationType').equals(type).toArray();
}

beforeEach(async () => {
    await getDatabase().mutationQueue.clear();
});

// ---------------------------------------------------------------------------
// WITNESS — prints the exact bytes the client puts in the outbox, so the
// verdicts below are readable without a debugger. Always passes.
// ---------------------------------------------------------------------------
describe('A3 WITNESS — actual outbox bytes', () => {
    it('dumps the correction payload and the income/expense payloads', async () => {
        financeCommandService.applyAdjustment({
            adjustsMoneyEventId: COST_ENTRY,
            correctedFields: { amount: 1200 },
            reason: 'Wrong amount entered',
            correctedByUserId: USER,
        });

        const income = financeCommandService.createMoneyEventFromSource({
            type: 'Manual',
            sourceId: 'witness-income',
            dateTime: '2026-08-14T12:00:00Z',
            eventType: 'Income',
            category: 'Other',
            farmId: FARM,
            plotId: PLOT,
            amount: 50000,
            notes: 'Grape sale',
            qty: 500,
            unit: 'kg',
            unitPrice: 100,
            paymentMode: 'UPI',
            vendorName: 'Nashik Mandi',
            createdByUserId: USER,
        } as MoneySourcePayload);

        await flush();

        const correction = (await rowsOf(SyncMutationName.CorrectCostEntry))[0];
        const cost = (await rowsOf(SyncMutationName.AddCostEntry)).find(
            r => (r.payload as { costEntryId: string }).costEntryId === income.id
        )!;

        console.log('\n=== correct_cost_entry OUTBOX PAYLOAD ===');
        console.log(JSON.stringify(correction.payload, null, 2));
        console.log('server allow-list:', SERVER_CORRECT_COST_ENTRY_ALLOWLIST.join(', '));

        console.log('\n=== local MoneyEvent (income, ₹50,000 EARNED) ===');
        console.log(JSON.stringify(
            { type: income.type, amount: income.amount, qty: income.qty, unit: income.unit, unitPrice: income.unitPrice, paymentMode: income.paymentMode, vendorName: income.vendorName },
            null, 2));

        console.log('\n=== add_cost_entry OUTBOX PAYLOAD for that same income ===');
        console.log(JSON.stringify(cost.payload, null, 2));
        console.log('mutationType sent to server:', cost.mutationType, '\n');

        expect(correction).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// CLAIM A3.1 — every cost correction is silently and permanently rejected
// ---------------------------------------------------------------------------
describe('A3.1 — cost corrections', () => {
    it('the payload the client enqueues contains ONLY keys the server allow-list accepts', async () => {
        financeCommandService.applyAdjustment({
            adjustsMoneyEventId: COST_ENTRY,
            correctedFields: { amount: 1200 },
            reason: 'Wrong amount entered',
            correctedByUserId: USER,
        });

        await flush();

        const rows = await rowsOf(SyncMutationName.CorrectCostEntry);
        expect(rows).toHaveLength(1);

        const enqueued = rows[0].payload as Record<string, unknown>;
        const keysServerWillRefuse = Object.keys(enqueued)
            .filter(k => !SERVER_CORRECT_COST_ENTRY_ALLOWLIST.includes(k))
            .sort();

        // Any non-empty result here means PayloadHasOnly returns false and the
        // WHOLE mutation is refused — the farmer's correction never lands.
        expect(keysServerWillRefuse).toEqual([]);
    });

    it('classifies the real server rejection as PERMANENT so it reaches OfflineConflictPage', () => {
        // BackgroundSyncWorker.ts:311 feeds exactly these two fields in.
        // PERMANENT -> markRejectedUserReview -> visible in OfflineConflictPage.
        // RETRYABLE -> markFailed -> 5 silent retries -> parked FAILED forever,
        //              and ConflictResolutionService.list() only reads
        //              REJECTED_USER_REVIEW, so the farmer is never told.
        expect(categorizeRejection(SERVER_REJECTION)).toBe('PERMANENT');
    });
});

// ---------------------------------------------------------------------------
// CLAIM A3.2 — income is stored as expenditure
// ---------------------------------------------------------------------------
describe('A3.2 — income vs expense', () => {
    const base = {
        type: 'Manual' as const,
        dateTime: '2026-08-14T12:00:00Z',
        category: 'Other' as const,
        farmId: FARM,
        plotId: PLOT,
        amount: 50000,
        notes: 'identical text on both',
        createdByUserId: USER,
    };

    it('an Income money event produces a payload distinguishable from an Expense money event', async () => {
        const income = financeCommandService.createMoneyEventFromSource({
            ...base,
            sourceId: 'a32-income-1',
            eventType: 'Income',
        } as MoneySourcePayload);

        const expense = financeCommandService.createMoneyEventFromSource({
            ...base,
            sourceId: 'a32-expense-1',
            eventType: 'Expense',
        } as MoneySourcePayload);

        expect(income.type).toBe('Income');
        expect(expense.type).toBe('Expense');

        await flush();

        const rows = await rowsOf(SyncMutationName.AddCostEntry);
        const find = (id: string) =>
            rows.find(r => (r.payload as { costEntryId: string }).costEntryId === id)!
                .payload as Record<string, unknown>;

        // Drop the one field that is trivially different (a fresh uuid per
        // event). Everything that carries MEANING must still differ, because
        // ₹50,000 earned and ₹50,000 spent are opposite facts.
        const { costEntryId: _i, ...incomeMeaning } = find(income.id);
        const { costEntryId: _e, ...expenseMeaning } = find(expense.id);

        expect(incomeMeaning).not.toEqual(expenseMeaning);
    });

    it('preserves qty / unit / unitPrice / paymentMode / vendorName / attachments across the outbox boundary', async () => {
        const event = financeCommandService.createMoneyEventFromSource({
            ...base,
            sourceId: 'a32-lossy-1',
            eventType: 'Expense',
            qty: 12,
            unit: 'kg',
            unitPrice: 90,
            paymentMode: 'UPI',
            vendorName: 'Patil Agro Centre',
            attachments: ['att-1'],
        } as MoneySourcePayload);

        await flush();

        const rows = await rowsOf(SyncMutationName.AddCostEntry);
        const payload = rows.find(
            r => (r.payload as { costEntryId: string }).costEntryId === event.id
        )!.payload as Record<string, unknown>;

        const dropped = ['qty', 'unit', 'unitPrice', 'paymentMode', 'vendorName', 'attachments']
            .filter(k => !(k in payload));

        expect(dropped).toEqual([]);
    });

    it('keeps `Input` distinguishable from `Other` on the wire', async () => {
        const input = financeCommandService.createMoneyEventFromSource({
            ...base,
            sourceId: 'a32-cat-input',
            eventType: 'Expense',
            category: 'Input',
        } as MoneySourcePayload);

        const other = financeCommandService.createMoneyEventFromSource({
            ...base,
            sourceId: 'a32-cat-other',
            eventType: 'Expense',
            category: 'Other',
        } as MoneySourcePayload);

        await flush();

        const rows = await rowsOf(SyncMutationName.AddCostEntry);
        const cat = (id: string) =>
            (rows.find(r => (r.payload as { costEntryId: string }).costEntryId === id)!
                .payload as { categoryId: string }).categoryId;

        expect(cat(input.id)).not.toBe(cat(other.id));
    });
});

// ---------------------------------------------------------------------------
// CLAIM A3.3 — double-tap creates two cost entries
//
// Server dedupe is real and is keyed on (device_id, client_request_id):
//   ssf.sync_mutations, UNIQUE INDEX ix_sync_mutations_device_id_client_request_id
//   (migration 20260222080909_AddAuditEvents.cs:282-283)
// so the ONLY thing that can stop a duplicate is a STABLE clientRequestId.
// ---------------------------------------------------------------------------
describe('A3.3 — idempotency keys', () => {
    it('enqueuing the same logical cost entry twice produces the SAME idempotency key', async () => {
        const payload = {
            costEntryId: COST_ENTRY,
            farmId: FARM,
            categoryId: 'fuel' as const,
            description: 'Diesel for pump',
            amount: 500,
            currencyCode: 'INR',
            entryDate: '2026-08-14',
            // Added when `direction` became a required field on the client twin.
            // It is inert for these two tests — they measure the IDEMPOTENCY KEY,
            // which is derived from `costEntryId` alone — and no assertion in
            // this block was touched.
            direction: 'Expense' as const,
        };

        const first = await AddCostEntryCommand.enqueue({ ...payload });
        const second = await AddCostEntryCommand.enqueue({ ...payload });

        expect(second).toBe(first);
    });

    it('CONTRAST (harness sanity check): create_daily_log DOES produce a stable key', async () => {
        const payload = {
            dailyLogId: LOG,
            farmId: FARM,
            plotId: PLOT,
            logDate: '2026-08-14',
        };

        const first = await CreateDailyLogCommand.enqueue({ ...payload });
        const second = await CreateDailyLogCommand.enqueue({ ...payload });

        expect(second).toBe(first);
        expect(first).toBe(`${SyncMutationName.CreateDailyLog}:${LOG}`);

        // And the queue holds exactly ONE row — the second enqueue collided on
        // the [deviceId+clientRequestId] index and returned the existing key.
        const rows = await rowsOf(SyncMutationName.CreateDailyLog);
        expect(rows).toHaveLength(1);
    });

    it('CONTRAST: the same double-enqueue on add_cost_entry leaves TWO queue rows', async () => {
        const payload = {
            costEntryId: COST_ENTRY,
            farmId: FARM,
            categoryId: 'fuel' as const,
            description: 'Diesel for pump',
            amount: 500,
            currencyCode: 'INR',
            entryDate: '2026-08-14',
            // Added when `direction` became a required field on the client twin.
            // It is inert for these two tests — they measure the IDEMPOTENCY KEY,
            // which is derived from `costEntryId` alone — and no assertion in
            // this block was touched.
            direction: 'Expense' as const,
        };

        await AddCostEntryCommand.enqueue({ ...payload });
        await AddCostEntryCommand.enqueue({ ...payload });

        const rows = await rowsOf(SyncMutationName.AddCostEntry);
        expect(rows).toHaveLength(1);
    });
});
