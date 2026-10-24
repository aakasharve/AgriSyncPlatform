import { describe, it, expect } from 'vitest';
import {
    findHeadcountDisagreement,
    selectConfirmSurface,
} from '../attendanceDisagreement';
import { selectLadderRung } from '../attendanceLadder';
import { ATTENDANCE_COPY } from '../attendanceCopy';
import type { LabourAnchor } from '../labourAnchor';
import type { LabourEvent } from '../../../domain/types/log.labour.types';

const ev = (id: string, over: Partial<LabourEvent>): LabourEvent =>
    ({ id, type: 'hired', ...over } as unknown as LabourEvent);

const anchored = (headcount: number, logId = 'log-1'): LabourAnchor =>
    ({ state: 'anchored', headcount, logId });
const NO_ANCHOR: LabourAnchor = { state: 'no-anchor' };

const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
        for (const key of Object.keys(value as object)) {
            deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
    }
    return value;
};

describe('findHeadcountDisagreement — both statements preserved, nothing silently overwritten (rule 1)', () => {
    it('the log said 12, speaking produced 10 → ONE disagreement carrying BOTH statements verbatim', () => {
        const out = findHeadcountDisagreement({
            anchor: anchored(12),
            events: [ev('e1', {
                count: 10,
                sourceText: 'आज दहा जण आले होते',
                systemInterpretation: '10 मजूर आले',
            })],
        });
        expect(out).not.toBeNull();
        expect(out!.axes).toEqual(['spoken-vs-anchor']);
        expect(out!.anchored).toEqual({ headcount: 12, logId: 'log-1' });
        expect(out!.spoken.count).toBe(10);
        expect(out!.spoken.statements).toEqual([{
            sourceEventId: 'e1',
            count: 10,
            sourceText: 'आज दहा जण आले होते',
            systemInterpretation: '10 मजूर आले',
        }]);
        expect(out!.governingCount).toBe(10);
    });

    it('agreement asks nothing', () => {
        expect(findHeadcountDisagreement({
            anchor: anchored(12),
            events: [ev('e1', { count: 12 })],
        })).toBeNull();
    });

    it('silence is not a statement: no spoken count, no names → null (rule 3 — unknown is never zero)', () => {
        expect(findHeadcountDisagreement({
            anchor: anchored(12),
            events: [ev('e1', { sourceText: 'छाटणी झाली' })],
        })).toBeNull();
        expect(findHeadcountDisagreement({ anchor: anchored(12), events: [] })).toBeNull();
    });

    it('a SPOKEN zero with people named is the same disagreement class at its extreme (controller ruling)', () => {
        const out = findHeadcountDisagreement({
            anchor: NO_ANCHOR,
            events: [ev('e1', { count: 0, workerNames: ['गणेश'] })],
        });
        expect(out).not.toBeNull();
        expect(out!.axes).toEqual(['count-vs-composition']);
        expect(out!.governingCount).toBe(0);
        expect(out!.uniqueNames).toEqual(['गणेश']);
    });

    it('an ANCHORED zero with people named conflicts the same way (either source of the count)', () => {
        const out = findHeadcountDisagreement({
            anchor: anchored(0, 'log-z'),
            events: [ev('e1', { workerNames: ['गणेश'] })],
        });
        expect(out).not.toBeNull();
        expect(out!.axes).toEqual(['count-vs-composition']);
        expect(out!.anchored).toEqual({ headcount: 0, logId: 'log-z' });
    });

    it("naming a SUBSET is P7-normal, never a conflict — the remainder is rung 3's question", () => {
        expect(findHeadcountDisagreement({
            anchor: anchored(8),
            events: [ev('e1', { count: 8, workerNames: ['रमेश', 'सीता'] })],
        })).toBeNull();
    });

    it('more people named than counted IS a conflict (the other direction of the same class)', () => {
        const out = findHeadcountDisagreement({
            anchor: NO_ANCHOR,
            events: [ev('e1', { count: 2, workerNames: ['गणेश', 'शंकर', 'रमेश'] })],
        });
        expect(out).not.toBeNull();
        expect(out!.axes).toEqual(['count-vs-composition']);
    });

    it('dedup: a duplicated name cannot HIDE the zero conflict (carried minor)', () => {
        const out = findHeadcountDisagreement({
            anchor: NO_ANCHOR,
            events: [ev('e1', { count: 0, workerNames: ['गणेश', 'गणेश'] })],
        });
        expect(out).not.toBeNull();
        expect(out!.uniqueNames).toEqual(['गणेश']);
    });

    it('dedup: duplicates FABRICATE no conflict — two unique names against a count of 2 is consistent', () => {
        expect(findHeadcountDisagreement({
            anchor: NO_ANCHOR,
            events: [ev('e1', { count: 2, workerNames: ['गणेश', 'गणेश', 'शंकर'] })],
        })).toBeNull();
    });

    it('dedup: duplicates cannot MASK a short composition at the rung-4 door (carried minor)', () => {
        // Raw length 2 satisfies the ladder (rung 4 — the one-tap door is open)...
        expect(selectLadderRung({
            anchorHeadcount: undefined, spokenCount: 2, workerNames: ['गणेश', 'गणेश'],
        })).toBe(4);
        // ...but only ONE person was actually named against a count of 2.
        const out = findHeadcountDisagreement({
            anchor: NO_ANCHOR,
            events: [ev('e1', { count: 2, workerNames: ['गणेश', 'गणेश'] })],
        });
        expect(out).not.toBeNull();
        expect(out!.axes).toEqual(['count-vs-composition']);
    });
});

describe('selectConfirmSurface — the disagreement rides INSIDE the confirm (D9.5), never a separate question', () => {
    const zeroWithNames = () => ({
        anchor: anchored(0, 'log-z'),
        events: [ev('e1', {
            workerNames: ['गणेश'],
            sourceText: 'गणेश आला होता',
            systemInterpretation: 'गणेश हजर',
        })],
    });

    it('PIN (a): zero-with-names shows the conflict — both statements preserved inside it', () => {
        const surface = selectConfirmSurface(zeroWithNames());
        expect(surface.kind).toBe('confirm-with-disagreement');
        if (surface.kind !== 'confirm-with-disagreement') throw new Error('unreachable');
        expect(surface.disagreement.anchored).toEqual({ headcount: 0, logId: 'log-z' });
        expect(surface.disagreement.uniqueNames).toEqual(['गणेश']);
        expect(surface.disagreement.spoken.statements).toEqual([{
            sourceEventId: 'e1',
            sourceText: 'गणेश आला होता',
            systemInterpretation: 'गणेश हजर',
        }]);
    });

    it('PIN (b): rung 4 alone WOULD open the one-tap door, but the plain confirm is underivable while the conflict stands', () => {
        // The ladder, fed the same facts, lands on rung 4 — the one-tap barobar.
        expect(selectLadderRung({
            anchorHeadcount: 0, spokenCount: undefined, workerNames: ['गणेश'],
        })).toBe(4);
        // The surface gate is what stands in the way: no conflict-free confirm exists here.
        expect(selectConfirmSurface(zeroWithNames()).kind).not.toBe('confirm');
        // Same for the 12-vs-10 shape — one class, one gate.
        expect(selectConfirmSurface({
            anchor: anchored(12),
            events: [ev('e1', { count: 10, workerNames: Array.from({ length: 10 }, (_, i) => 'n' + i) })],
        }).kind).not.toBe('confirm');
    });

    it('PIN (c): resolution stays at the SAME बरोबर / बदल करा; both statements intact; nothing mutated', () => {
        // The settle vocabulary is the existing confirm's — no new question, no new words.
        expect(ATTENDANCE_COPY.confirmButton).toBe('बरोबर');
        expect(ATTENDANCE_COPY.editButton).toBe('बदल करा');
        const input = deepFreeze(zeroWithNames());
        // Deep-frozen inputs: any silent overwrite would throw in strict mode.
        const surface = selectConfirmSurface(input);
        // The union holds ONLY confirm shapes — a disagreement is never a separate blocking question.
        expect(['confirm', 'confirm-with-disagreement']).toContain(surface.kind);
        // Both statements remain exactly as made, after detection.
        expect(input.anchor).toEqual({ state: 'anchored', headcount: 0, logId: 'log-z' });
        expect(input.events[0].sourceText).toBe('गणेश आला होता');
        expect(input.events[0].systemInterpretation).toBe('गणेश हजर');
    });

    it('no disagreement → the plain confirm', () => {
        expect(selectConfirmSurface({
            anchor: anchored(2),
            events: [ev('e1', { count: 2, workerNames: ['गणेश', 'शंकर'] })],
        })).toEqual({ kind: 'confirm' });
    });
});
