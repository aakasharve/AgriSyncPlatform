/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
 * The list as lines: the CURRENT version is the highest the server numbered; the history says who, when, old → new;
 * a stopped rate is a version, shown after every live one. And the queued payload is exactly the contract's shape.
 */
import { describe, expect, it } from 'vitest';
import { historyOf, linesOf } from '../farmRateLines';
import type { FarmRateRow } from '../farmRateSchema';
import { buildSetFarmRatePayload, carriesItsValues } from '../../../../application/usecases/sync/SetFarmRateCommand';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

const row = (over: Partial<FarmRateRow>): FarmRateRow => ({
    id: 'v', rateLineId: 'L1', farmId: 'F', version: 1, kind: 'Input', itemName: 'युरिया', unit: 'पोते', basis: 'PerUnit',
    workerCategory: null, amount: 1350, currencyCode: 'INR', effectiveFrom: '2026-11-01', season: null, endsOn: null, retired: false,
    suggestionId: null, createdByUserId: 'owner', createdAtUtc: '2026-11-01T05:00:00.5Z', ...over,
});

describe('lines and history', () => {
    it('the current version is the highest; history is oldest first with old → new', () => {
        const lines = linesOf([
            row({ id: 'v2', version: 2, amount: 1400, createdAtUtc: '2026-11-05T05:00:00Z', suggestionId: null }),
            row({ id: 'v1', version: 1, amount: 1350, suggestionId: 'sug' }),
            row({ id: 'v3', version: 3, amount: 1400, retired: true, createdAtUtc: '2026-11-06T05:00:00Z' }),
        ]);
        expect(lines).toHaveLength(1);
        expect(lines[0].current.id).toBe('v3');
        expect(historyOf(lines[0])).toEqual([
            { version: 1, atUtc: '2026-11-01T05:00:00.5Z', byUserId: 'owner', to: 1350, stopped: false, fromSuggestion: true },
            { version: 2, atUtc: '2026-11-05T05:00:00Z', byUserId: 'owner', from: 1350, to: 1400, stopped: false, fromSuggestion: false },
            { version: 3, atUtc: '2026-11-06T05:00:00Z', byUserId: 'owner', from: 1400, to: 1400, stopped: true, fromSuggestion: false },
        ]);
    });

    it('live rates first (newest change first), stopped rates after them', () => {
        const lines = linesOf([
            row({ id: 'a', rateLineId: 'old', createdAtUtc: '2026-10-01T00:00:00Z' }),
            row({ id: 'b', rateLineId: 'stopped', retired: true, createdAtUtc: '2026-11-06T00:00:00Z' }),
            row({ id: 'c', rateLineId: 'new', createdAtUtc: '2026-11-02T00:00:00Z' }),
        ]);
        expect(lines.map(l => l.rateLineId)).toEqual(['new', 'old', 'stopped']);
    });
});

describe('the queued payload is the contract\'s (P11 / F5)', () => {
    it('a set: values present, blanks left OUT (never null), currency INR, a fresh version id; it passes the outbox check', () => {
        const input = { farmId: 'aaaaaaaa-0000-4000-8000-00000000000a', rateLineId: 'bbbbbbbb-0000-4000-8000-00000000000b', change: 'set' as const,
            kind: 'Work' as const, itemName: ' फवारणी ', basis: 'PerDay' as const, workerCategory: '  ', amount: 450, effectiveFrom: '2026-11-06',
            season: 'खरीप' };
        expect(carriesItsValues(input)).toBe(true);
        const payload = buildSetFarmRatePayload(input, 'cccccccc-0000-4000-8000-00000000000c', '2026-11-06T05:00:00.000Z');
        expect(payload).toEqual({
            farmRateId: 'cccccccc-0000-4000-8000-00000000000c', rateLineId: input.rateLineId, farmId: input.farmId, change: 'set',
            changedAtUtc: '2026-11-06T05:00:00.000Z', kind: 'Work', itemName: 'फवारणी', basis: 'PerDay', amount: 450, currencyCode: 'INR',
            effectiveFrom: '2026-11-06', season: 'खरीप',
        });
        expect(validatePayload(SyncMutationName.SetFarmRate, payload)).toEqual({ ok: true });
    });

    it('a stop carries no values and passes; an input with no unit or a zero rate does not', () => {
        const stop = buildSetFarmRatePayload({ farmId: 'aaaaaaaa-0000-4000-8000-00000000000a', rateLineId: 'bbbbbbbb-0000-4000-8000-00000000000b', change: 'retire' },
            'cccccccc-0000-4000-8000-00000000000c', '2026-11-06T05:00:00.000Z');
        expect(Object.keys(stop).sort()).toEqual(['change', 'changedAtUtc', 'farmId', 'farmRateId', 'rateLineId']);
        expect(validatePayload(SyncMutationName.SetFarmRate, stop)).toEqual({ ok: true });
        const base = { farmId: 'f', rateLineId: 'l', change: 'set' as const, kind: 'Input' as const, itemName: 'युरिया', basis: 'PerUnit' as const, effectiveFrom: '2026-11-06' };
        expect(carriesItsValues({ ...base, amount: 10 })).toBe(false);
        expect(carriesItsValues({ ...base, unit: 'पोते', amount: 0 })).toBe(false);
        expect(carriesItsValues({ ...base, unit: 'पोते', amount: 10 })).toBe(true);
    });
});
