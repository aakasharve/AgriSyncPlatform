/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE (founder 27 Nov, answer 7: "the machine cost reads the rate card").
 * The "अंदाजे" machine cost of a record line, kept apart from confirmed money. It exists ONLY when every piece of it is his:
 *   - the record line states no machine money at all (a stated rupee, even 0, is the truth and is never estimated over);
 *   - the line can mean exactly ONE machine of his farm (same kind, ownership not contradicted); two possible machines = no estimate;
 *   - that machine has a rate he typed, in effect on the record's day (no rate = no estimate, never a default);
 *   - the rate is per hour and the line states the hours he said: estimate = rate x hours, to the paisa;
 *   - any other basis, or hours not said: the rate is shown with "the record does not say how much", and no amount (P4).
 * It never changes the record (P7): the function reads, it writes nothing.
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog, MachineryEvent } from '../../../../types';
import { LogVerificationStatus } from '../../../../domain/types/log.types';
import type { FarmRateRow } from '../../farmRates/farmRateSchema';
import { estimatedTotal, machineEstimates, type EstimateMachine } from '../machineEstimate';

const FARM = '00000000-0000-4000-8000-0000000000f1';
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const TRACTOR = '00000000-0000-4000-8000-00000000a001';
const TRACTOR_2 = '00000000-0000-4000-8000-00000000a002';
const BLOWER = '00000000-0000-4000-8000-00000000a003';

const tractor: EstimateMachine = { id: TRACTOR, name: 'जॉन डियर', machineType: 'tractor', ownership: 'owned' };
const blower: EstimateMachine = { id: BLOWER, name: 'मित्रा ब्लोअर', machineType: 'blower', ownership: 'owned' };

const rate = (over: Partial<FarmRateRow> = {}): FarmRateRow => ({
    id: `v-${over.rateLineId ?? TRACTOR}-${over.version ?? 1}`, rateLineId: TRACTOR, farmId: FARM, version: 1, kind: 'Work', itemName: 'जॉन डियर',
    unit: null, basis: 'PerHour', workerCategory: null, amount: 800, currencyCode: 'INR', effectiveFrom: '2026-11-01', season: null, endsOn: null,
    retired: false, suggestionId: null, createdByUserId: OWNER, createdAtUtc: '2026-11-01T05:00:00.000Z', ...over,
});

const line = (over: Partial<MachineryEvent> = {}): MachineryEvent => ({ id: 'm1', type: 'tractor', ownership: 'owned', hoursUsed: 3, ...over });

const log = (machinery: MachineryEvent[], over: Partial<DailyLog> = {}): DailyLog => ({
    id: 'log-1', date: '2026-11-25', context: { selection: [] }, dayOutcome: null, cropActivities: [], irrigation: [], labour: [], inputs: [],
    machinery, ...over,
} as unknown as DailyLog);

describe('the अंदाजे machine cost of a record line', () => {
    it('rate he typed x hours he said, kept to the paisa', () => {
        const lines = machineEstimates([log([line({ hoursUsed: 2.5 })])], [tractor], [rate({ amount: 812.5 })]);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ logId: 'log-1', machineLineId: 'm1', dateKey: '2026-11-25', machine: tractor });
        expect(lines[0].estimate).toMatchObject({ kind: 'estimate', hours: 2.5, amount: 2031.25 });
        expect(estimatedTotal(lines)).toBe(2031.25);
    });

    it('no rate on the machine: no estimate and nothing to show (never a default)', () => {
        expect(machineEstimates([log([line()])], [tractor], [])).toEqual([]);
        expect(machineEstimates([log([line()])], [tractor], [rate({ rateLineId: TRACTOR_2 })])).toEqual([]);
        expect(estimatedTotal([])).toBeNull();
    });

    it('a stated rupee is the truth: rent, fuel, even a stated 0, and the line is not estimated', () => {
        for (const stated of [{ rentalCost: 1200 }, { fuelCost: 300 }, { rentalCost: 0 }]) {
            expect(machineEstimates([log([line(stated)])], [tractor], [rate()])).toEqual([]);
        }
    });

    it('hours not said, unknown, or not his: the rate is shown with no amount', () => {
        const cases: Partial<MachineryEvent>[] = [
            { hoursUsed: undefined },
            { hoursUsed: 0 },
            { numbers: { hoursUsed: { certainty: 'unknown' } } },
            { provenance: 'assumed' },
            { provenance: 'derived' },
            { provenanceVerified: false },
        ];
        for (const over of cases) {
            const [only] = machineEstimates([log([line(over)])], [tractor], [rate()]);
            expect(only.estimate).toEqual({ kind: 'noQuantity', rate: rate() });
        }
    });

    it('he said the hours roughly ("अंदाजे ३ तास"): still his number, still an estimate', () => {
        const [only] = machineEstimates([log([line({ numbers: { hoursUsed: { certainty: 'approximate', quantity: 3 } } })])], [tractor], [rate()]);
        expect(only.estimate).toMatchObject({ kind: 'estimate', amount: 2400 });
    });

    it('a rate per day, acre, trip or task: the record does not say how much, so no amount', () => {
        for (const basis of ['PerDay', 'PerAcre', 'PerTrip', 'PerTask'] as const) {
            const [only] = machineEstimates([log([line()])], [tractor], [rate({ basis })]);
            expect(only.estimate.kind).toBe('noQuantity');
        }
    });

    it('two tractors on the farm: the line could be either, so no estimate', () => {
        const second: EstimateMachine = { id: TRACTOR_2, name: 'महिंद्रा', machineType: 'tractor', ownership: 'owned' };
        expect(machineEstimates([log([line()])], [tractor, second], [rate()])).toEqual([]);
    });

    it('ownership never contradicted: his own tractor is not the one he rented', () => {
        expect(machineEstimates([log([line({ ownership: 'rented' })])], [tractor], [rate()])).toEqual([]);
        expect(machineEstimates([log([line({ ownership: 'unknown' })])], [tractor], [rate()])).toHaveLength(1);
        const rented: EstimateMachine = { ...tractor, ownership: 'rented' };
        expect(machineEstimates([log([line({ ownership: 'owned' })])], [rented], [rate()])).toEqual([]);
    });

    it('a sprayer line is the blower only when it names a blower; a kind with no farm machine type is never guessed', () => {
        const blowerRate = rate({ rateLineId: BLOWER, itemName: 'मित्रा ब्लोअर', amount: 500 });
        expect(machineEstimates([log([line({ type: 'sprayer', implement: 'blower' })])], [blower], [blowerRate])[0].estimate)
            .toMatchObject({ kind: 'estimate', amount: 1500 });
        expect(machineEstimates([log([line({ type: 'sprayer' })])], [blower], [blowerRate])).toEqual([]);
        for (const type of ['tiller', 'drone', 'unknown'] as const) {
            expect(machineEstimates([log([line({ type })])], [tractor], [rate()])).toEqual([]);
        }
    });

    it('the rate in effect on the record day; a record before the rate starts gets none', () => {
        const rows = [rate({ version: 1, amount: 700 }), rate({ version: 2, amount: 800, effectiveFrom: '2026-11-20' })];
        const lines = machineEstimates([log([line()], { id: 'a', date: '2026-11-10' }), log([line()], { id: 'b', date: '2026-11-21' })], [tractor], rows);
        expect(lines.map(l => [l.logId, l.estimate.kind === 'estimate' ? l.estimate.amount : null])).toEqual([['b', 2400], ['a', 2100]]);
        expect(machineEstimates([log([line()], { date: '2026-10-31' })], [tractor], rows)).toEqual([]);
    });

    it('a deleted or disputed record is left out; the record is never changed (P7)', () => {
        const deleted = log([line()], { deletion: { deletedAtISO: 'x', deletedByOperatorId: 'y', reason: 'z' } });
        const disputed = log([line()], { verification: { status: LogVerificationStatus.DISPUTED, required: true } });
        expect(machineEstimates([deleted, disputed], [tractor], [rate()])).toEqual([]);
        const kept = log([line()]);
        const before = JSON.stringify(kept);
        machineEstimates([kept], [tractor], [rate()]);
        expect(JSON.stringify(kept)).toBe(before);
    });

    it('the total adds only the amounts; a line with no amount adds nothing', () => {
        const rows = [rate(), rate({ rateLineId: BLOWER, basis: 'PerAcre', amount: 900 })];
        const lines = machineEstimates([log([line(), line({ id: 'm2', type: 'sprayer', implement: 'ब्लोअर' })])], [tractor, blower], rows);
        expect(lines).toHaveLength(2);
        expect(estimatedTotal(lines)).toBe(2400);
        expect(estimatedTotal(lines.filter(l => l.estimate.kind === 'noQuantity'))).toBeNull();
    });
});
