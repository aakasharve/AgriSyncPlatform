/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reading a cost entry back must not invent which way the money moved.
 *
 * THE DEFECT. `mapCostEntryToMoneyEvent` set `type: 'Expense'` for every row
 * it read, unconditionally. Every money event the farmer recorded — income and
 * expense alike — was pushed as `add_cost_entry`, so a ₹50,000 grape sale came
 * back on a reinstalled phone as ₹50,000 SPENT and his profit rendered as a
 * loss. The hard-coded literal was the last link in that chain.
 *
 * WHAT THESE TESTS PIN, in order of how much they matter:
 *   1. A stated Income reads back as Income.
 *   2. A row with NO stated direction reads back as `'Unknown'` — never
 *      `'Expense'` (`P4`). This is the one that governs every row already on
 *      the server, and it is deliberately the less convenient answer: an
 *      Unknown row is counted in neither total.
 *   3. The six line-detail fields survive the round trip, and an unstated one
 *      arrives as `undefined` rather than a zero or an empty string.
 *
 * These drive the REAL financeService through its real snapshot listener —
 * the same path `postReconcileEvents` uses after a pull.
 *
 * spec: 2026-08-14-FOUNDER-DECISIONS-launch-cohort-and-scope
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';

import { financeService } from '../financeService';

const FARM = '11111111-1111-4111-8111-111111111111';

/** Shape of one `costEntries[]` row as the pull delivers it. */
type PulledCostEntry = Record<string, unknown>;

function base(id: string): PulledCostEntry {
    return {
        id,
        farmId: FARM,
        categoryId: 'fuel',
        description: 'Diesel for pump',
        amount: 500,
        currencyCode: 'INR',
        entryDate: '2026-08-15',
        createdByUserId: '22222222-2222-4222-8222-222222222222',
        createdAtUtc: '2026-08-15T06:00:00.000Z',
        modifiedAtUtc: '2026-08-15T06:00:00.000Z',
        isCorrected: false,
    };
}

/**
 * Feeds a pull snapshot in through the window event `financeService` listens
 * on, then reads the events back out. Synchronous by construction — the
 * listener applies the snapshot directly.
 */
function applySnapshot(costEntries: PulledCostEntry[]) {
    window.dispatchEvent(
        new CustomEvent('agrisync:finance-sync-payload', {
            detail: { costEntries, corrections: [], priceConfigs: [] },
        }),
    );
    return financeService.getMoneyEvents();
}

describe('financeService — a cost entry reads back with the direction it was given', () => {
    it('reads a stated Income as Income', () => {
        const events = applySnapshot([
            { ...base('a1111111-1111-4111-8111-111111111111'), direction: 'Income', amount: 50000 },
        ]);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('Income');
        expect(events[0].amount).toBe(50000);
    });

    it('reads a stated Expense as Expense', () => {
        const events = applySnapshot([
            { ...base('a2222222-2222-4222-8222-222222222222'), direction: 'Expense' },
        ]);

        expect(events[0].type).toBe('Expense');
    });

    it('reads a row with NO direction as Unknown, never as Expense', () => {
        // Every cost entry on the server today is this row. Some of them are
        // sales. Answering "Expense" here is the whole defect.
        const events = applySnapshot([base('a3333333-3333-4333-8333-333333333333')]);

        expect(events[0].type).toBe('Unknown');
        expect(events[0].type).not.toBe('Expense');
    });

    it('reads an explicit null direction as Unknown', () => {
        // A row whose column is NULL serialises as JSON null rather than an
        // absent key. Both are the same fact and must read the same way.
        const events = applySnapshot([
            { ...base('a4444444-4444-4444-8444-444444444444'), direction: null },
        ]);

        expect(events[0].type).toBe('Unknown');
    });

    it('reads an unrecognised direction as Unknown rather than guessing', () => {
        // A string this client cannot read is not evidence of a direction.
        const events = applySnapshot([
            { ...base('a5555555-5555-4555-8555-555555555555'), direction: 'expense' },
        ]);

        expect(events[0].type).toBe('Unknown');
    });

    it('does not let the amount decide the direction', () => {
        // A negative number is not a direction (P1). Whatever the sign, an
        // unstated direction stays unstated.
        const events = applySnapshot([
            { ...base('a6666666-6666-4666-8666-666666666666'), amount: -500 },
        ]);

        expect(events[0].type).toBe('Unknown');
    });

    it('rebuilds the six line-detail fields from the wire', () => {
        const events = applySnapshot([
            {
                ...base('a7777777-7777-4777-8777-777777777777'),
                direction: 'Expense',
                qty: 12,
                unit: 'kg',
                unitPrice: 90,
                paymentMode: 'UPI',
                vendorName: 'Patil Agro Centre',
                clientAttachmentIds: ['att-1'],
            },
        ]);

        const event = events[0];
        expect(event.qty).toBe(12);
        expect(event.unit).toBe('kg');
        expect(event.unitPrice).toBe(90);
        expect(event.paymentMode).toBe('UPI');
        expect(event.vendorName).toBe('Patil Agro Centre');
        expect(event.attachments).toEqual(['att-1']);
    });

    it('leaves an unstated line-detail field undefined, not zero and not empty', () => {
        // A 0 quantity and a blank vendor read like the farmer answered. He
        // did not.
        const events = applySnapshot([
            { ...base('a8888888-8888-4888-8888-888888888888'), direction: 'Expense' },
        ]);

        const event = events[0];
        expect(event.qty).toBeUndefined();
        expect(event.unit).toBeUndefined();
        expect(event.unitPrice).toBeUndefined();
        expect(event.paymentMode).toBeUndefined();
        expect(event.vendorName).toBeUndefined();
        expect(event.attachments).toBeUndefined();
    });

    it('keeps "said none" distinct from "said nothing" for attachments', () => {
        const events = applySnapshot([
            {
                ...base('a9999999-9999-4999-8999-999999999999'),
                direction: 'Expense',
                clientAttachmentIds: [],
            },
        ]);

        expect(events[0].attachments).toEqual([]);
        expect(events[0].attachments).not.toBeUndefined();
    });

    it('an Unknown row lands in NEITHER total, and that is the intended cost', async () => {
        // Stated, not hidden. Excluding it is right — it belongs to neither
        // side — but it does mean a farmer whose history predates the column
        // sees totals that no longer silently absorb it. The disclosure of that
        // on screen is tracked separately; the arithmetic is pinned here.
        const { financeSelectors } = await import('../financeSelectors');

        applySnapshot([
            { ...base('b1111111-1111-4111-8111-111111111111'), direction: 'Income', amount: 900 },
            { ...base('b2222222-2222-4222-8222-222222222222'), direction: 'Expense', amount: 300 },
            { ...base('b3333333-3333-4333-8333-333333333333'), amount: 50000 },
        ]);

        expect(financeSelectors.getTotalIncome()).toBe(900);
        expect(financeSelectors.getTotalCost()).toBe(300);
    });
});
