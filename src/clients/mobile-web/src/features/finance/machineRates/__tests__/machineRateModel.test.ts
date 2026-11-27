/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE (founder 27 Nov, answer 7: "the rate card question must be asked right
 * after user adds a machine to his farm"). A machine's rate is ONE line of the farm's own दरपत्रक (`set_farm_rate`), and the line's id IS the
 * machine's id: the existing mutation carries it, no new field.
 *   - the rate he typed goes out whole (kind Work, what it is for = the machine's name, the basis he picked, from today); nothing is defaulted;
 *   - a blank or zero rate is never a rate (P4), and a machine id that is not a bare GUID (a phone-only machine) never carries one;
 *   - which version applies on a record's day: the newest version in effect then; a stopped or ended rate applies to nothing.
 */
import { describe, expect, it } from 'vitest';
import { carriesItsValues } from '../../../../application/usecases/sync/SetFarmRateCommand';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { buildSetFarmRatePayload } from '../../../../application/usecases/sync/SetFarmRateCommand';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import type { FarmRateRow } from '../../farmRates/farmRateSchema';
import type { QueuedFarmRate } from '../../farmRates/farmRateQueue';
import {
    MACHINE_RATE_BASES, canHoldRate, machineRateInput, machineRateLine, queuedMachineRate, rateInEffect,
} from '../machineRateModel';

const FARM = '00000000-0000-4000-8000-0000000000f1';
const TRACTOR = '00000000-0000-4000-8000-00000000a001';
const OTHER = '00000000-0000-4000-8000-00000000a002';
const OWNER = '00000000-0000-4000-8000-0000000000a1';

const row = (over: Partial<FarmRateRow>): FarmRateRow => ({
    id: `v-${over.rateLineId ?? TRACTOR}-${over.version ?? 1}`, rateLineId: TRACTOR, farmId: FARM, version: 1, kind: 'Work', itemName: 'जॉन डियर',
    unit: null, basis: 'PerHour', workerCategory: null, amount: 800, currencyCode: 'INR', effectiveFrom: '2026-11-01', season: null, endsOn: null,
    retired: false, suggestionId: null, createdByUserId: OWNER, createdAtUtc: '2026-11-01T05:00:00.000Z', ...over,
});

describe('a machine rate is a line of the farm rate card, keyed by the machine id', () => {
    it('asks per hour first, then the other work bases the rate card supports', () => {
        expect(MACHINE_RATE_BASES).toEqual(['PerHour', 'PerDay', 'PerAcre', 'PerTrip', 'PerTask']);
    });

    it('the rate he typed goes out whole and passes the contract', () => {
        const input = machineRateInput(FARM, { id: TRACTOR, name: '  जॉन डियर 5050 ' }, 800, 'PerHour', '2026-11-27');
        expect(input).toEqual({
            farmId: FARM, rateLineId: TRACTOR, change: 'set', kind: 'Work', itemName: 'जॉन डियर 5050', basis: 'PerHour', amount: 800,
            effectiveFrom: '2026-11-27',
        });
        expect(carriesItsValues(input)).toBe(true);
        const payload = buildSetFarmRatePayload(input, '00000000-0000-4000-8000-00000000b001', '2026-11-27T05:00:00.000Z');
        expect(validatePayload(SyncMutationName.SetFarmRate, payload).ok).toBe(true);
    });

    it('a blank or zero rate is never a rate (no default, P4)', () => {
        expect(carriesItsValues(machineRateInput(FARM, { id: TRACTOR, name: 'ट्रॅक्टर' }, undefined, 'PerHour', '2026-11-27'))).toBe(false);
        expect(carriesItsValues(machineRateInput(FARM, { id: TRACTOR, name: 'ट्रॅक्टर' }, 0, 'PerHour', '2026-11-27'))).toBe(false);
    });

    it('only a machine the server knows by a bare GUID can carry a rate', () => {
        expect(canHoldRate(TRACTOR)).toBe(true);
        expect(canHoldRate('mach_1234')).toBe(false);
        expect(canHoldRate('')).toBe(false);
    });

    it('finds the machine line and its newest version; another line is not it', () => {
        const rows = [row({ version: 1, amount: 700 }), row({ version: 2, amount: 800 }), row({ rateLineId: OTHER, amount: 50 })];
        expect(machineRateLine(rows, TRACTOR)?.current.amount).toBe(800);
        expect(machineRateLine(rows, '00000000-0000-4000-8000-00000000a009')).toBeUndefined();
    });

    it('a change of the machine rate still on this phone is found (the newest one)', () => {
        const q = (amount: number, state: 'waiting' | 'refused'): QueuedFarmRate => ({
            state,
            payload: { farmId: FARM, rateLineId: TRACTOR, change: 'set', kind: 'Work', itemName: 'ट्रॅक्टर', basis: 'PerHour', amount,
                effectiveFrom: '2026-11-27', farmRateId: `id-${amount}`, currencyCode: 'INR', changedAtUtc: '2026-11-27T05:00:00.000Z' },
        });
        expect(queuedMachineRate([q(700, 'refused'), q(900, 'waiting')], TRACTOR)?.payload.amount).toBe(900);
        expect(queuedMachineRate([q(700, 'waiting')], OTHER)).toBeUndefined();
    });
});

describe('which version applies on a record\'s day', () => {
    const line = (rows: FarmRateRow[]) => machineRateLine(rows, TRACTOR);

    it('the newest version in effect on that day', () => {
        const l = line([row({ version: 1, amount: 700, effectiveFrom: '2026-11-01' }), row({ version: 2, amount: 800, effectiveFrom: '2026-11-20' })]);
        expect(rateInEffect(l, '2026-11-15')?.amount).toBe(700);
        expect(rateInEffect(l, '2026-11-20')?.amount).toBe(800);
        expect(rateInEffect(l, '2026-11-25')?.amount).toBe(800);
    });

    it('a later version that moved the start back wins where it covers', () => {
        const l = line([row({ version: 1, amount: 700, effectiveFrom: '2026-11-20' }), row({ version: 2, amount: 800, effectiveFrom: '2026-11-01' })]);
        expect(rateInEffect(l, '2026-11-25')?.amount).toBe(800);
    });

    it('before the rate starts, after it ends, or once it is stopped: no rate', () => {
        expect(rateInEffect(line([row({ effectiveFrom: '2026-11-27' })]), '2026-11-26')).toBeUndefined();
        expect(rateInEffect(line([row({ endsOn: '2026-11-10' })]), '2026-11-11')).toBeUndefined();
        expect(rateInEffect(line([row({ endsOn: '2026-11-10' })]), '2026-11-10')?.amount).toBe(800);
        expect(rateInEffect(line([row({ version: 1 }), row({ version: 2, retired: true })]), '2026-11-05')).toBeUndefined();
        expect(rateInEffect(undefined, '2026-11-05')).toBeUndefined();
    });
});
