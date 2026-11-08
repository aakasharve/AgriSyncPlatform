/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 0b; founder 2026-11-06) - "who said it" is always a real
 * name. The phone holder is named by his own name (the operator list, else the session profile), never "तुम्ही"; a name nobody
 * knows reads the unknown label, never "तुम्ही" either.
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import { buildDayView, whoSpoke, type WhoDeps } from '../resultModel';

const DATE = '2026-11-09';
const log = (id: string, by: string | undefined, at: string): DailyLog => ({
    id, date: DATE, dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['p1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [{ id: `ca-${id}`, title: 'छाटणी' }], irrigation: [], labour: [], inputs: [], machinery: [],
    meta: { createdAtISO: at, ...(by ? { createdByOperatorId: by } : {}) },
}) as unknown as DailyLog;

const deps = (over: Partial<WhoDeps> = {}): WhoDeps => ({
    youIds: new Set(['op-me', 'user-me']),
    nameOf: id => (id === 'op-sunil' ? 'सुनील' : undefined),
    ownName: 'प्रकाश',
    unknownLabel: 'अज्ञात',
    ...over,
});

describe('who spoke - always a real name (lane IT4 Task 0b)', () => {
    it('OwnRecording_ShowsOwnName_NotTumhi', () => {
        const mine = log('L1', 'op-me', '2026-11-09T04:00:00.000Z');
        expect(whoSpoke(mine, deps())).toEqual({ name: 'प्रकाश', you: true });
        // The operator list wins when it knows the holder; the session-profile name stands in when it does not.
        expect(whoSpoke(mine, deps({ nameOf: id => (id === 'op-me' ? 'प्रकाश पाटील' : undefined) })).name).toBe('प्रकाश पाटील');
        // The summary chips and the "आज कोणी सांगितलं" line read the same name.
        const day = buildDayView([mine], [mine], deps());
        expect(day.current[0].who.name).toBe('प्रकाश');
        expect(day.speakers).toEqual([{ name: 'प्रकाश', you: true, times: 1 }]);
        expect(JSON.stringify(day.speakers)).not.toContain('तुम्ही');
    });

    it('OtherSpeaker_ShowsTheirName', () => {
        const theirs = log('L2', 'op-sunil', '2026-11-09T05:00:00.000Z');
        expect(whoSpoke(theirs, deps())).toEqual({ name: 'सुनील', you: false });
        const mine = log('L1', 'op-me', '2026-11-09T04:00:00.000Z');
        const day = buildDayView([mine], [mine, theirs], deps());
        expect(day.speakers).toEqual([{ name: 'सुनील', you: false, times: 1 }, { name: 'प्रकाश', you: true, times: 1 }]);
    });

    it('LegacyCaller_KeepsItsWord_UntilReflectNamesLands (lane IT5 removes it); the result screen never passes one', () => {
        const mine = log('L1', 'op-me', '2026-11-09T04:00:00.000Z');
        expect(whoSpoke(mine, deps({ youLabel: 'तुम्ही' }))).toEqual({ name: 'तुम्ही', you: true }); // आढावा, not changed behind IT5's back
        expect(whoSpoke(mine, deps({ youLabel: '' })).name).toBe('प्रकाश'); // a blank word is no swap
    });

    it('NameUnknown_ShowsUnknownLabel_NotTumhi', () => {
        // Nobody recorded as speaking it, a stranger no list knows, and a holder with no name anywhere.
        expect(whoSpoke(log('L3', undefined, '2026-11-09T06:00:00.000Z'), deps())).toEqual({ name: 'अज्ञात', you: false });
        expect(whoSpoke(log('L4', 'op-stranger', '2026-11-09T06:00:00.000Z'), deps())).toEqual({ name: 'अज्ञात', you: false });
        const noName = whoSpoke(log('L5', 'op-me', '2026-11-09T06:00:00.000Z'), deps({ ownName: undefined }));
        expect(noName).toEqual({ name: 'अज्ञात', you: true });
        expect(noName.name).not.toBe('तुम्ही');
        // A blank profile name is no name either.
        expect(whoSpoke(log('L6', 'op-me', '2026-11-09T06:00:00.000Z'), deps({ ownName: '   ' })).name).toBe('अज्ञात');
    });
});
