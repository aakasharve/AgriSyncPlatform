import { describe, it, expect } from 'vitest';
import { sumMachineryCost, computeReceiptTotal } from '../log-factory-helpers';
import type { MachineryEvent } from '../../../../types';

// ---------------------------------------------------------------------------
// W2.P4.T3 — TDD for sumMachineryCost fix and computeReceiptTotal
// ---------------------------------------------------------------------------

function makeMachine(rentalCost?: number, fuelCost?: number): MachineryEvent {
    return {
        id: 'test-machine',
        type: 'tractor',
        ownership: 'rented',
        hoursUsed: 2,
        rentalCost,
        fuelCost,
    };
}

describe('sumMachineryCost', () => {
    it('sums rental AND fuel cost (the key under-count fix: 100+40=140, old || gave 100)', () => {
        const events = [makeMachine(100, 40)];
        expect(sumMachineryCost(events)).toBe(140);
    });

    it('rental only → returns rental cost', () => {
        const events = [makeMachine(100, undefined)];
        expect(sumMachineryCost(events)).toBe(100);
    });

    it('fuel only → returns fuel cost', () => {
        const events = [makeMachine(undefined, 40)];
        expect(sumMachineryCost(events)).toBe(40);
    });

    it('neither rental nor fuel → 0', () => {
        const events = [makeMachine(undefined, undefined)];
        expect(sumMachineryCost(events)).toBe(0);
    });

    it('rental=0, fuel=50 → 50 (validates ?? semantics: 0+50=50)', () => {
        const events = [makeMachine(0, 50)];
        expect(sumMachineryCost(events)).toBe(50);
    });

    it('multiple machines sum correctly', () => {
        const events = [makeMachine(100, 40), makeMachine(200, 60)];
        expect(sumMachineryCost(events)).toBe(400);
    });

    it('empty array → 0', () => {
        expect(sumMachineryCost([])).toBe(0);
    });
});

describe('computeReceiptTotal', () => {
    it('sums all four cost parts', () => {
        const result = computeReceiptTotal({
            labourCost: 500,
            machineCost: 140,
            inputCost: 200,
            expenseCost: 60,
        });
        expect(result).toBe(900);
    });

    it('handles all-zero inputs', () => {
        const result = computeReceiptTotal({
            labourCost: 0,
            machineCost: 0,
            inputCost: 0,
            expenseCost: 0,
        });
        expect(result).toBe(0);
    });

    it('handles single non-zero part', () => {
        const result = computeReceiptTotal({
            labourCost: 0,
            machineCost: 250,
            inputCost: 0,
            expenseCost: 0,
        });
        expect(result).toBe(250);
    });
});
