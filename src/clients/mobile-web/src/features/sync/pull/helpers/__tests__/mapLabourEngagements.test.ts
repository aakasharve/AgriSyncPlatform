/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LABOUR_PHASE2 Phase 3 — the wire → local mapping, field by field.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 *
 * WHAT THIS FILE IS FOR. `mapLabourEngagements` is the only place a
 * `LabourAssignment` becomes something this app displays, corrects and attributes
 * people to. Two doctrine rules live or die here — P7 (attribution never changes
 * a reported quantity) and P8 (hours never travel without their basis) — and both
 * fail silently: a mapping that recounts heads from the attribution list, or that
 * copies an assumed 8 into a field every reader treats as a farmer statement,
 * passes every test that only checks the row exists.
 */
import { describe, it, expect } from 'vitest';

import { mapLabourEngagements } from '../mapLabourEngagements';
import { resolveLabourHeadcount } from '../../../../../domain/logs/labourHeadcount';
import type { LabourEngagementDto } from '../../../../../infrastructure/api/AgriSyncClient';

const ASSIGNMENT_ID = '11111111-1111-4111-8111-111111111111';
const LOG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * The serialized shape measured off the real server projection
 * (`DtoMappingExtensions.ToDto(this LabourAssignment, …)`): every optional
 * member is JSON `null`, never an absent key, and `workerNames` /
 * `attributedOperators` are never null.
 */
const engagement = (over: Partial<LabourEngagementDto> = {}): LabourEngagementDto => ({
    labourAssignmentId: ASSIGNMENT_ID,
    dailyLogId: LOG_ID,
    engagementType: 'Hired',
    workerCount: 8,
    maleCount: null,
    femaleCount: null,
    wagePerPerson: null,
    contractUnit: null,
    contractQuantity: null,
    totalCost: null,
    durationHours: 8,
    timeBasis: 'Assumed',
    shift: null,
    task: null,
    notes: null,
    workerNames: [],
    createdAtUtc: '2026-08-13T04:00:00.000Z',
    linkedActivityId: null,
    attributedOperators: [],
    ...over,
});

const mapOne = (over: Partial<LabourEngagementDto> = {}) => mapLabourEngagements([engagement(over)])[0];

describe('mapLabourEngagements — headcount (doctrine P7)', () => {
    it('THE INVARIANT: 8 workers with 3 people attributed still reports 8', () => {
        const event = mapOne({
            workerCount: 8,
            attributedOperators: [
                { fieldOperatorId: 'f1', displayNameAtAttach: 'बाळू' },
                { fieldOperatorId: 'f2', displayNameAtAttach: 'रमेश' },
                { fieldOperatorId: 'f3', displayNameAtAttach: 'सीता' },
            ],
        });

        expect(event.count).toBe(8);
        expect(event.attributedOperators).toHaveLength(3);
        // Through the app's ONE shared derivation, not a hand-rolled count here.
        expect(resolveLabourHeadcount(event)).toBe(8);
    });

    it('names are not a headcount either — 8 workers, 2 named, still 8', () => {
        const event = mapOne({ workerCount: 8, workerNames: ['रमेश', 'सीता'] });

        expect(event.workerNames).toEqual(['रमेश', 'सीता']);
        expect(resolveLabourHeadcount(event)).toBe(8);
    });

    it('a null workerCount is ABSENT, never 0 — silence is not "nobody worked"', () => {
        const event = mapOne({ workerCount: null });

        expect(event.count).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(event, 'count')).toBe(false);
    });

    it('an explicitly stated 0 survives as 0, still distinguishable from silence', () => {
        expect(mapOne({ workerCount: 0 }).count).toBe(0);
    });

    it('the gender split is copied as stated and never derived from workerCount', () => {
        const event = mapOne({ workerCount: 5, maleCount: 3, femaleCount: 2 });

        expect(event.maleCount).toBe(3);
        expect(event.femaleCount).toBe(2);
        expect(event.count).toBe(5);
    });

    it('a count-only engagement leaves the split absent, so nothing reads a fabricated 0', () => {
        const event = mapOne({ workerCount: 6, maleCount: null, femaleCount: null });

        expect(event.maleCount).toBeUndefined();
        expect(event.femaleCount).toBeUndefined();
        // The count-only case `resolveLabourHeadcount` exists for.
        expect(resolveLabourHeadcount(event)).toBe(6);
    });
});

describe('mapLabourEngagements — duration and its basis (doctrine P8)', () => {
    it('an EXPLICIT duration is carried, with its basis alongside it', () => {
        const event = mapOne({ durationHours: 6, timeBasis: 'Explicit' });

        expect(event.durationHours).toBe(6);
        expect(event.timeBasis).toBe('Explicit');
    });

    it('THE RULE: an ASSUMED duration never lands in durationHours', () => {
        // The server states 8 hours on a basis of "we filled this in". Copying
        // that number into `durationHours` would make every reader on this
        // device — the push payload, the correction diff, the hour chips — treat
        // a server default as something the farmer said. It is the same constant
        // Task 8.4 deleted from the two screens that rendered it.
        const event = mapOne({ durationHours: 8, timeBasis: 'Assumed' });

        expect(event.durationHours).toBeUndefined();
        expect(event.timeBasis).toBe('Assumed');
    });

    it('hours NEVER appear without their basis, on any input', () => {
        for (const basis of ['Explicit', 'Assumed', 'nonsense', '']) {
            const event = mapOne({ durationHours: 7, timeBasis: basis });
            if (event.durationHours !== undefined) {
                expect(event.timeBasis).toBeDefined();
            }
        }
    });

    it('an unreadable basis drops the hours with it, rather than keeping hours of unknown provenance', () => {
        const event = mapOne({ durationHours: 7, timeBasis: 'Whatever' });

        expect(event.durationHours).toBeUndefined();
        expect(event.timeBasis).toBeUndefined();
    });

    it('the basis is read case-insensitively, as the server maps every other enum', () => {
        expect(mapOne({ durationHours: 4, timeBasis: 'explicit' }).durationHours).toBe(4);
    });
});

describe('mapLabourEngagements — identity', () => {
    it('the engagement id IS the local id, so the picker and the correction path still key on it', () => {
        const event = mapOne();

        // `ReviewSheet` resolves its attribution picker through
        // `labourAssignmentId`; `UpdateLog` builds its correction `before` map
        // from the same field. A minted local id would be a second identity for
        // one engagement.
        expect(event.labourAssignmentId).toBe(ASSIGNMENT_ID);
        expect(event.id).toBe(ASSIGNMENT_ID);
    });

    it('carries the activity link when the server stated one, and omits it when not', () => {
        expect(mapOne({ linkedActivityId: 'act-1' }).linkedActivityId).toBe('act-1');
        expect(mapOne({ linkedActivityId: null }).linkedActivityId).toBeUndefined();
    });
});

describe('mapLabourEngagements — vocabulary round-trips', () => {
    it('maps the three engagement types onto the field the push path sends', () => {
        expect(mapOne({ engagementType: 'Hired' }).type).toBe('HIRED');
        expect(mapOne({ engagementType: 'Contract' }).type).toBe('CONTRACT');
        expect(mapOne({ engagementType: 'Self' }).type).toBe('SELF');
    });

    it('does not invent the richer B2.4 engagementType, which has a value the server cannot hold', () => {
        // The server stores three values, B2.4 has four ('exchange' collapses to
        // Self on the way in). Re-splitting them here would assert something
        // nobody said.
        expect(mapOne({ engagementType: 'Self' }).engagementType).toBeUndefined();
    });

    it('spells LumpSum the way the local union does, and the other units verbatim', () => {
        expect(mapOne({ contractUnit: 'LumpSum' }).contractUnit).toBe('Lump Sum');
        expect(mapOne({ contractUnit: 'Tree' }).contractUnit).toBe('Tree');
        expect(mapOne({ contractUnit: 'Acre' }).contractUnit).toBe('Acre');
        expect(mapOne({ contractUnit: 'Row' }).contractUnit).toBe('Row');
    });

    it('drops a contract unit it cannot represent instead of substituting one', () => {
        expect(mapOne({ contractUnit: 'Hectare' }).contractUnit).toBeUndefined();
        expect(mapOne({ contractUnit: null }).contractUnit).toBeUndefined();
    });

    it('carries the shift word intact, so MapLabourShift reads it back unchanged', () => {
        expect(mapOne({ shift: 'Full' }).shiftId).toBe('Full');
        expect(mapOne({ shift: null }).shiftId).toBeUndefined();
    });
});

describe('mapLabourEngagements — money is carried, never derived', () => {
    it('keeps a stated total and a stated wage exactly as sent', () => {
        const event = mapOne({ wagePerPerson: 400, totalCost: 3200, workerCount: 8 });

        expect(event.wagePerPerson).toBe(400);
        expect(event.totalCost).toBe(3200);
    });

    it('NO-MULTIPLY: an unstated total stays unstated, even with a wage and a count present', () => {
        const event = mapOne({ wagePerPerson: 400, workerCount: 8, totalCost: null });

        expect(event.totalCost).toBeUndefined();
    });
});

describe('mapLabourEngagements — descriptive text', () => {
    it('carries the task and the note verbatim', () => {
        const event = mapOne({ task: 'छाटणी', notes: 'सकाळी लवकर सुरू' });

        expect(event.activity).toBe('छाटणी');
        expect(event.notes).toBe('सकाळी लवकर सुरू');
    });

    it('treats null and blank text as unstated', () => {
        const event = mapOne({ task: null, notes: '   ' });

        expect(event.activity).toBeUndefined();
        expect(event.notes).toBeUndefined();
    });

    it('an empty name list is a COMPLETE record, kept as the empty array', () => {
        // "the farmer named nobody" (P9) is a different local state from "the
        // server said nothing about names", which is absence.
        expect(mapOne({ workerNames: [] }).workerNames).toEqual([]);
        expect(mapOne({ attributedOperators: [] }).attributedOperators).toEqual([]);
    });

    it('keeps attribution in the order the server sent it', () => {
        const event = mapOne({
            attributedOperators: [
                { fieldOperatorId: 'f2', displayNameAtAttach: 'दुसरा' },
                { fieldOperatorId: 'f1', displayNameAtAttach: 'पहिला' },
            ],
        });

        expect(event.attributedOperators?.map(o => o.fieldOperatorId)).toEqual(['f2', 'f1']);
    });

    it('drops a half-formed attribution row without touching the headcount', () => {
        const event = mapOne({
            workerCount: 8,
            attributedOperators: [
                { fieldOperatorId: 'f1', displayNameAtAttach: 'बाळू' },
                { fieldOperatorId: '', displayNameAtAttach: 'no id' },
            ] as LabourEngagementDto['attributedOperators'],
        });

        expect(event.attributedOperators).toHaveLength(1);
        expect(event.count).toBe(8);
    });
});

describe('mapLabourEngagements — the list', () => {
    it('maps every engagement, in order, and an empty response to an empty list', () => {
        const events = mapLabourEngagements([
            engagement({ labourAssignmentId: ASSIGNMENT_ID, workerCount: 8 }),
            engagement({ labourAssignmentId: '22222222-2222-4222-8222-222222222222', workerCount: 2 }),
        ]);

        expect(events.map(e => e.count)).toEqual([8, 2]);
        expect(mapLabourEngagements([])).toEqual([]);
    });
});
