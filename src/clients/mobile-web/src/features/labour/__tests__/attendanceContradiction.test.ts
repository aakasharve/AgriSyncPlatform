import { describe, it, expect } from 'vitest';
import { findDayContradictions } from '../attendanceContradiction';
import type { LabourEvent } from '../../../domain/types/log.labour.types';

const ev = (id: string, names: string[], shiftId?: string): LabourEvent =>
    ({ id, type: 'hired', workerNames: names, shiftId } as unknown as LabourEvent);

describe('findDayContradictions — deterministic, never AI-produced', () => {
    it('the founder case: one man, full in one work, half in another → ONE contradiction', () => {
        const out = findDayContradictions([ev('a', ['गणेश'], 'full'), ev('b', ['गणेश'], 'half')]);
        expect(out).toEqual([{
            name: 'गणेश',
            facts: [
                { shift: 'full', sourceEventId: 'a' },
                { shift: 'half', sourceEventId: 'b' },
            ],
        }]);
    });
    it('two consistent contexts ask nothing (the GetLabourDataHandler:602-612 rule)', () => {
        expect(findDayContradictions([ev('a', ['गणेश'], 'full'), ev('b', ['गणेश'], 'full')])).toEqual([]);
    });
    it('an event with no shift makes no claim and raises no question', () => {
        expect(findDayContradictions([ev('a', ['गणेश'], 'full'), ev('b', ['गणेश'])])).toEqual([]);
    });
    it('same NAME across people is per-name only — never merged identities (rule 10 lives at resolution, not here)', () => {
        const out = findDayContradictions([ev('a', ['गणेश', 'शंकर'], 'full'), ev('b', ['शंकर'], 'night')]);
        expect(out.map(c => c.name)).toEqual(['शंकर']);
    });
    it('at most one contradiction per person per day, facts listed once per engagement', () => {
        const out = findDayContradictions([ev('a', ['गणेश'], 'full'), ev('b', ['गणेश'], 'half'), ev('c', ['गणेश'], 'half')]);
        expect(out).toHaveLength(1);
        expect(out[0].facts).toHaveLength(3);
    });
    it('a name duplicated INSIDE one engagement still lists its fact once per engagement (carried 3.2-review minor)', () => {
        const out = findDayContradictions([ev('a', ['गणेश', 'गणेश'], 'full'), ev('b', ['गणेश'], 'half')]);
        expect(out).toHaveLength(1);
        expect(out[0].facts).toEqual([
            { shift: 'full', sourceEventId: 'a' },
            { shift: 'half', sourceEventId: 'b' },
        ]);
    });
});
