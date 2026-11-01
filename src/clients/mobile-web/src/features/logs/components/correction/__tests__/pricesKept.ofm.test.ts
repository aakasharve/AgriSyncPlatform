/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M fix pass 3, call 1) — on the बदला screen, a seat that
 * did not make the entry and may not check money keeps every price as saved: what he says or taps that is not a price
 * still changes; a price never does (the server refuses such an edit whole — this keeps him from ever sending one).
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import { changesPricedLine } from '../../../../../application/usecases/UpdateLog';
import { hasPricedLine, isPricedPart, keepSavedPrices } from '../pricesKept';

const SAVED = {
    id: 'log-1', date: '2026-10-25', labour: [], cropActivities: [], irrigation: [],
    inputs: [
        { id: 'in-1', productName: 'इथरेल', quantity: 300, unit: 'ml', cost: 500 },
        { id: 'in-2', productName: 'पाणी' },
    ],
    machinery: [{ id: 'm-1', type: 'tractor', hoursUsed: 2, rentalCost: 1000, fuelCost: 200 }],
    activityExpenses: [{ id: 'exp-1', reason: 'डिझेल', category: 'Fuel', totalAmount: 500 }],
} as unknown as DailyLog;

const withBuckets = (over: Partial<Record<'inputs' | 'machinery' | 'activityExpenses', unknown[]>>): DailyLog =>
    ({ ...SAVED, ...over } as unknown as DailyLog);

describe('lane OF-M fix pass 3 — prices kept as saved', () => {
    it('a price changed on a saved line goes back to the saved price; what is not a price stays changed', () => {
        const kept = keepSavedPrices(SAVED, withBuckets({
            inputs: [{ ...SAVED.inputs[0], quantity: 350, cost: 900 }, SAVED.inputs[1]],
            machinery: [{ id: 'm-1', type: 'tractor', hoursUsed: 3, rentalCost: 1500 }],
        }));
        expect(kept.inputs[0]).toMatchObject({ id: 'in-1', quantity: 350, cost: 500 });
        expect(kept.machinery[0]).toMatchObject({ id: 'm-1', hoursUsed: 3, rentalCost: 1000, fuelCost: 200 });
        expect(changesPricedLine(SAVED, kept)).toBe(false);
    });

    it('a priced line said again (a new line in its place) keeps the saved line, its id and its price, with his other words', () => {
        const kept = keepSavedPrices(SAVED, withBuckets({
            inputs: [{ id: 'x', productName: 'इथरेल', quantity: 350, unit: 'ml', cost: 900 }],
            activityExpenses: [{ id: 'y', reason: 'डिझेल पंप', category: 'Fuel', totalAmount: 800 }],
        }));
        expect(kept.inputs).toEqual([{ id: 'in-1', productName: 'इथरेल', quantity: 350, unit: 'ml', cost: 500 }]);
        expect(kept.activityExpenses).toEqual([{ id: 'exp-1', reason: 'डिझेल पंप', category: 'Fuel', totalAmount: 500 }]);
        expect(changesPricedLine(SAVED, kept)).toBe(false);
    });

    it('a new line keeps what it says but no price; a new expense (only its amount) is not added', () => {
        const kept = keepSavedPrices(SAVED, withBuckets({
            inputs: [...SAVED.inputs, { id: 'in-3', productName: 'युरिया', quantity: 2, unit: 'kg', cost: 300 }],
            activityExpenses: [...(SAVED.activityExpenses ?? []), { id: 'exp-2', reason: 'वाहतूक', totalAmount: 150 }],
        }));
        expect(kept.inputs[2]).toEqual({ id: 'in-3', productName: 'युरिया', quantity: 2, unit: 'kg' });
        expect(kept.activityExpenses).toEqual(SAVED.activityExpenses);
        expect(changesPricedLine(SAVED, kept)).toBe(false);
    });

    it('a priced line his words left out stays as saved; a line with no price may go', () => {
        const kept = keepSavedPrices(SAVED, withBuckets({ inputs: [], machinery: [], activityExpenses: [] }));
        expect(kept.inputs).toEqual([SAVED.inputs[0]]);
        expect(kept.machinery).toEqual(SAVED.machinery);
        expect(kept.activityExpenses).toEqual(SAVED.activityExpenses);
        expect(changesPricedLine(SAVED, kept)).toBe(false);
    });

    it('fix pass 5: lines said again in another order keep each its own saved line and price, paired by product, not by place', () => {
        const saved = withBuckets({
            inputs: [
                { id: 'in-1', productName: 'युरिया', quantity: 1, unit: 'kg', cost: 500 },
                { id: 'in-2', productName: 'DAP', quantity: 1, unit: 'kg', cost: 300 },
            ],
        });
        const kept = keepSavedPrices(saved, { ...saved, inputs: [
            { id: 'x', productName: 'DAP', quantity: 2, unit: 'kg', cost: 999 },
            { id: 'y', productName: 'युरिया', quantity: 3, unit: 'kg' },
        ] } as unknown as DailyLog);
        expect(kept.inputs).toEqual([
            { id: 'in-2', productName: 'DAP', quantity: 2, unit: 'kg', cost: 300 },
            { id: 'in-1', productName: 'युरिया', quantity: 3, unit: 'kg', cost: 500 },
        ]);
        expect(changesPricedLine(saved, kept)).toBe(false);
        // Nothing to pair by: the place in the list decides, as before.
        const unnamed = keepSavedPrices(saved, { ...saved, inputs: [{ id: 'z', quantity: 9 }] } as unknown as DailyLog);
        expect(unnamed.inputs).toEqual([{ id: 'in-1', quantity: 9, cost: 500 }, saved.inputs[1]]);
    });

    it('nothing to keep: the same copy comes back (no new object, so the screen does not redraw for nothing)', () => {
        expect(keepSavedPrices(SAVED, SAVED)).toBe(SAVED);
        const kept = keepSavedPrices(SAVED, withBuckets({ inputs: [{ id: 'x', productName: 'इथरेल', cost: 900 }] }));
        expect(keepSavedPrices(SAVED, kept)).toBe(kept);
    });

    it('which parts are priced, read by the same stated-amount rule the save makes money by', () => {
        expect(isPricedPart(SAVED, 'inputs', 'in-1')).toBe(true);
        expect(isPricedPart(SAVED, 'inputs', 'in-2')).toBe(false);
        expect(isPricedPart(SAVED, 'machinery', 'm-1')).toBe(true);
        expect(isPricedPart(SAVED, 'activityExpenses', 'exp-1')).toBe(true);
        expect(isPricedPart(SAVED, 'irrigation', 'w')).toBe(false);
        expect(hasPricedLine(SAVED)).toBe(true);
        expect(hasPricedLine(withBuckets({ inputs: [SAVED.inputs[1]], machinery: [], activityExpenses: [] }))).toBe(false);
    });
});
