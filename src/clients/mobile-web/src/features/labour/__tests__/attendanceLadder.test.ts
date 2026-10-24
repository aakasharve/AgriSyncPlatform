import { describe, it, expect } from 'vitest';
import { selectLadderRung } from '../attendanceLadder';

describe('selectLadderRung — only the missing facts are asked (rule 15)', () => {
    it('nothing understood anywhere → rung 1 (Labour unavailable)', () => {
        expect(selectLadderRung({ anchorHeadcount: undefined, spokenCount: undefined, workerNames: [] })).toBe(1);
    });
    it('only a count → rung 2 (WHO)', () => {
        expect(selectLadderRung({ anchorHeadcount: 12, spokenCount: undefined, workerNames: [] })).toBe(2);
    });
    it('count + some people → rung 3 (only the remainder)', () => {
        expect(selectLadderRung({ anchorHeadcount: 12, spokenCount: undefined, workerNames: ['गणेश', 'शंकर'] })).toBe(3);
    });
    it('full composition → rung 4 (only बरोबर?)', () => {
        expect(selectLadderRung({ anchorHeadcount: 2, spokenCount: undefined, workerNames: ['गणेश', 'शंकर'] })).toBe(4);
    });
    it('the spoken count outranks the anchor for rung selection — but never overwrites it', () => {
        expect(selectLadderRung({ anchorHeadcount: 12, spokenCount: 2, workerNames: ['गणेश', 'शंकर'] })).toBe(4);
    });
    it('a transcript naming only people still resolves (names without a count ride the anchor)', () => {
        expect(selectLadderRung({ anchorHeadcount: 3, spokenCount: undefined, workerNames: ['गणेश'] })).toBe(3);
    });
    // Review finding N2 (Task 3.1): a CONFIRMED log with an explicitly STATED count of 0
    // anchors with headcount 0. A stated zero means genuinely no labour — the ladder asks
    // nothing ("या 0 जणांमध्ये कोण होते?" must never render). The no-work-day door (Phase 4)
    // is the surface for "people came but no work"; Labour has nothing to verify here.
    it('an anchored count of 0 asks nothing — never "या 0 जणांमध्ये कोण होते?" (finding N2)', () => {
        expect(selectLadderRung({ anchorHeadcount: 0, spokenCount: undefined, workerNames: [] })).toBe(1);
    });
    it('a spoken 0 outranks the anchor and still asks nothing (finding N2)', () => {
        expect(selectLadderRung({ anchorHeadcount: 12, spokenCount: 0, workerNames: [] })).toBe(1);
    });
});
