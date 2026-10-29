/**
 * spec: plr-d10 I26 (founder D-34, PLR-D10 L3b) — the pure rules behind
 * "या N जणांमध्ये कोण होते?" per work. Voice Log = HOW MANY per work; हजेरी = WHO
 * was present; attribution = WHO in WHICH work; none overwrites another.
 */
import { describe, it, expect } from 'vitest';
import type { DailyLog } from '../../../types';
import type { LedgerRow } from '../labour.types';
import {
    attributionReadout,
    buildWorkTargetsByLogId,
    namedOnDay,
    orderRowsForWork,
    presentOnDay,
    WORK_ATTRIBUTION_COPY,
} from '../workAttribution';

const DAY = '2026-10-27';
const log = (id: string, labour: unknown[], date = DAY): DailyLog =>
    ({ id, date, labour } as unknown as DailyLog);

describe('buildWorkTargetsByLogId — one question per work, never a guessed work', () => {
    it('gives a one-work log one question carrying that work\'s own N and server names', () => {
        const map = buildWorkTargetsByLogId([log('L1', [{
            labourAssignmentId: 'A1', count: 6,
            attributedOperators: [{ fieldOperatorId: 'G', displayNameAtAttach: 'गणेश' }],
        }])]);
        expect(map.get('L1')).toEqual([{
            labourAssignmentId: 'A1', headcount: 6, label: undefined, date: DAY,
            attributed: [{ fieldOperatorId: 'G', displayNameAtAttach: 'गणेश' }],
        }]);
    });

    it('keeps an unstated count unknown (P4) and asks nothing of a stated 0', () => {
        const map = buildWorkTargetsByLogId([
            log('L1', [{ labourAssignmentId: 'A1' }]),
            log('L2', [{ labourAssignmentId: 'A2', count: 0 }]),
        ]);
        expect(map.get('L1')?.[0].headcount).toBeUndefined();
        expect(map.has('L2')).toBe(false);
    });

    it('splits a two-work log into two questions when the farmer can tell them apart', () => {
        const map = buildWorkTargetsByLogId([log('L1', [
            { labourAssignmentId: 'A1', count: 6, targetPlotName: 'प्लॉट १' },
            { labourAssignmentId: 'A2', count: 4, targetPlotName: 'प्लॉट २' },
        ])]);
        expect(map.get('L1')?.map((w) => [w.labourAssignmentId, w.headcount, w.label])).toEqual([
            ['A1', 6, 'प्लॉट १'], ['A2', 4, 'प्लॉट २'],
        ]);
    });

    it('offers NOTHING on a two-work log whose works read identically — silence beats a wrong link', () => {
        const map = buildWorkTargetsByLogId([log('L1', [
            { labourAssignmentId: 'A1', count: 6 },
            { labourAssignmentId: 'A2', count: 6 },
        ])]);
        expect(map.has('L1')).toBe(false);
    });

    it('skips deleted logs and events with no engagement id', () => {
        const deleted = { ...log('L1', [{ labourAssignmentId: 'A1', count: 3 }]), deletion: {} } as unknown as DailyLog;
        const map = buildWorkTargetsByLogId([deleted, log('L2', [{ count: 3 }])]);
        expect(map.size).toBe(0);
    });
});

describe('namedOnDay — the system remembers the person, never assumes the work', () => {
    const history = [
        log('L1', [{ labourAssignmentId: 'A1', count: 6, attributedOperators: [{ fieldOperatorId: 'G', displayNameAtAttach: 'गणेश' }] }]),
        log('L2', [{ labourAssignmentId: 'A2', count: 4, attributedOperators: [] }]),
        log('L0', [{ labourAssignmentId: 'A0', count: 2, attributedOperators: [{ fieldOperatorId: 'OLD', displayNameAtAttach: 'जुना' }] }], '2026-10-26'),
    ];

    it('collects people named on OTHER works of the same day, plus this sitting\'s names', () => {
        const ids = namedOnDay(history, DAY, [{ labourAssignmentId: 'A1', date: DAY, fieldOperatorId: 'R' }], 'A2');
        expect([...ids].sort()).toEqual(['G', 'R']);
    });

    it('excludes the work being asked about and other days', () => {
        expect([...namedOnDay(history, DAY, [], 'A1')]).toEqual([]);
    });
});

describe('presentOnDay — हजेरी is a suggestion, read only from presence marks', () => {
    const row = (id: string, day: 'full' | 'half' | 'absent' | null, night: 'worked' | 'notworked' | null = null): LedgerRow => ({
        personId: `op:${id}`, fieldOperatorId: id, name: id, initial: id, tone: 'em',
        cells: [null, { day, night, hours: null, extraHours: null, ukte: false, work: null }],
    });

    it('counts full, half and night-worked as present; absent and silence are not', () => {
        const ids = presentOnDay({
            days: ['2026-10-26', DAY],
            rows: [row('F', 'full'), row('H', 'half'), row('N', null, 'worked'), row('A', 'absent'), row('S', null)],
        }, DAY);
        expect([...ids].sort()).toEqual(['F', 'H', 'N']);
    });

    it('knows nothing about a day outside the register on screen', () => {
        expect(presentOnDay({ days: ['2026-10-26'], rows: [row('F', 'full')] }, DAY).size).toBe(0);
        expect(presentOnDay(undefined, DAY).size).toBe(0);
    });
});

describe('attributionReadout — the truthful state, only once someone is named', () => {
    it('says how many are named and how many stay anonymous; the count is never changed', () => {
        expect(attributionReadout(3, 6)).toBe('३ जणांची नावं · ३ अनामिक');
        expect(attributionReadout(6, 6)).toBe('सगळ्या ६ जणांची नावं');
    });

    it('says nothing on a headcount-only work, an unstated count, or more names than N', () => {
        expect(attributionReadout(0, 6)).toBeNull();
        expect(attributionReadout(2, undefined)).toBeNull();
        expect(attributionReadout(7, 6)).toBeNull();
    });

    it('asks the founder\'s own question', () => {
        expect(WORK_ATTRIBUTION_COPY.question(12)).toBe('या १२ जणांमध्ये कोण होते?');
    });
});

describe('orderRowsForWork — named-today first, then present, same-name people kept together', () => {
    const r = (id: string, displayName: string) => ({ operator: { id, displayName } });

    it('puts people named on another work first, present next, keeping roster order otherwise', () => {
        const rows = [r('1', 'अ'), r('2', 'ब'), r('3', 'क'), r('4', 'ड')];
        const ordered = orderRowsForWork(rows, new Set(['3']), new Set(['4']));
        expect(ordered.map((x) => x.operator.id)).toEqual(['3', '4', '1', '2']);
    });

    it('moves a same-name group as one, so a collision stays visible at the moment of choosing', () => {
        const rows = [r('1', 'बाळू'), r('2', 'गणेश'), r('3', 'बाळू')];
        const ordered = orderRowsForWork(rows, new Set(['3']), new Set());
        expect(ordered.map((x) => x.operator.id)).toEqual(['1', '3', '2']);
    });
});
