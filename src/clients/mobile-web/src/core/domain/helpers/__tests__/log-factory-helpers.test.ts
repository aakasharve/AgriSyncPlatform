import { describe, it, expect } from 'vitest';
import { sumMachineryCost, computeReceiptTotal, ensureLabourAssignmentIds } from '../log-factory-helpers';
import type { MachineryEvent, DailyLog, LabourEvent } from '../../../../types';
import type { IdGenerator } from '../../services/IdGenerator';

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

// ---------------------------------------------------------------------------
// Labour V1 Task 7.3 — ensureLabourAssignmentIds
// spec: 2026-07-13-labour-attendance-approval-design
// ---------------------------------------------------------------------------

function makeIdGen(): IdGenerator {
    let n = 0;
    return { generate: () => `minted-${++n}` };
}

function makeLog(labour: LabourEvent[]): DailyLog {
    return { id: 'log-1', labour } as unknown as DailyLog;
}

describe('ensureLabourAssignmentIds', () => {
    it('mints an id on every labour event that lacks one', () => {
        const logs = [makeLog([
            { id: 'l1', type: 'HIRED' } as LabourEvent,
            { id: 'l2', type: 'CONTRACT' } as LabourEvent,
        ])];

        ensureLabourAssignmentIds(logs, makeIdGen());

        expect(logs[0].labour[0].labourAssignmentId).toBe('minted-1');
        expect(logs[0].labour[1].labourAssignmentId).toBe('minted-2');
    });

    it('MUTATES IN PLACE — the caller\'s own reference sees the ids', () => {
        // This is the whole point of the helper. `confirmAndSave` returns
        // Promise<void> and every caller then hands ITS OWN array to
        // enqueueLogsForSync. If this ever starts returning a copy instead,
        // ids reach Dexie but never reach the wire and the server rejects
        // every log the farmer writes.
        const event: LabourEvent = { id: 'l1', type: 'HIRED' } as LabourEvent;
        const callersOwnReference = [makeLog([event])];

        const returned = ensureLabourAssignmentIds(callersOwnReference, makeIdGen());

        expect(returned).toBeUndefined();
        expect(event.labourAssignmentId).toBe('minted-1');
        expect(callersOwnReference[0].labour[0]).toBe(event);
    });

    it('is idempotent — an existing id is never renumbered', () => {
        const logs = [makeLog([
            { id: 'l1', type: 'HIRED', labourAssignmentId: 'already-on-the-wire' } as LabourEvent,
            { id: 'l2', type: 'HIRED' } as LabourEvent,
        ])];

        ensureLabourAssignmentIds(logs, makeIdGen());
        ensureLabourAssignmentIds(logs, makeIdGen());

        expect(logs[0].labour[0].labourAssignmentId).toBe('already-on-the-wire');
        expect(logs[0].labour[1].labourAssignmentId).toBe('minted-1');
    });

    it('covers every log in the batch (the plot-split fan-out)', () => {
        const logs = [
            makeLog([{ id: 'l1', type: 'HIRED' } as LabourEvent]),
            makeLog([{ id: 'l2', type: 'HIRED' } as LabourEvent]),
        ];

        ensureLabourAssignmentIds(logs, makeIdGen());

        expect(logs[0].labour[0].labourAssignmentId).toBe('minted-1');
        expect(logs[1].labour[0].labourAssignmentId).toBe('minted-2');
    });

    it('tolerates logs with no labour at all', () => {
        const logs = [makeLog([]), { id: 'log-2' } as unknown as DailyLog];
        expect(() => ensureLabourAssignmentIds(logs, makeIdGen())).not.toThrow();
    });
});
