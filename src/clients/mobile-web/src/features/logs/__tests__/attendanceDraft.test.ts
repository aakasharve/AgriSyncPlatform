/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FOUNDER RULING 2026-08-31 — the labour mic must not write the legacy log's
 * buckets. He saw a हजेरी he had spoken from Labour Management arrive on the
 * generic confirm screen with Crop Activity, Inputs & Protection and Irrigation
 * beside it, and said the reflection belongs on the labour screen instead.
 *
 * Revert-proof: delete the bucket-emptying and the first test fails.
 */
import { describe, it, expect } from 'vitest';
import type { AgriLogResponse } from '../../../types';
import { toAttendanceOnlyDraft, isAttendanceOnlyDraft, toAttendanceSubmission } from '../attendanceDraft';

const labourEntry = {
    id: 'l1',
    type: 'HIRED' as const,
    count: 4,
    activity: 'shoot cutting',
    notes: 'संतु रोकडे, चंदू रोकडे, हळदाका, विलास जाधव',
};

const fullDraft = (): AgriLogResponse => ({
    dayOutcome: 'WORK_RECORDED',
    summary: 'चार जण आले होते',
    fullTranscript: 'संतु रोकडे, चंदू रोकडे, हळदाका आणि विलास जाधव आज आले होते',
    cropActivities: [{ id: 'c1', title: 'शेंडा मारणे' }],
    irrigation: [{ id: 'i1' }],
    labour: [labourEntry],
    inputs: [{ id: 'in1' }],
    machinery: [{ id: 'm1' }],
    activityExpenses: [{ id: 'e1' }],
    disturbance: { blockedSegments: [], reason: 'rain' },
    questionsForUser: [],
    missingSegments: [],
} as unknown as AgriLogResponse);

describe('toAttendanceOnlyDraft — the labour door writes only हजेरी', () => {
    it('empties every bucket that belongs to the other door — but never the disturbance', () => {
        const out = toAttendanceOnlyDraft(fullDraft())!;
        expect(out.cropActivities).toEqual([]);
        expect(out.irrigation).toEqual([]);
        expect(out.inputs).toEqual([]);
        expect(out.machinery).toEqual([]);
        expect(out.activityExpenses).toEqual([]);
        // D11 + founder Task 4.2: attendance says WHO, disturbance says WHAT
        // blocked the day. Neither collapses into the other; dropping it here
        // severed the no-work-day flow (the parse DOES produce it).
        expect(out.disturbance).toEqual({ blockedSegments: [], reason: 'rain' });
    });

    // The half this helper must NEVER take away. If the parser ever stops
    // putting the stated activity on the labour row, emptying cropActivities
    // starts destroying evidence — this is the tripwire for that.
    it('attendance_draft_never_touches_the_labour_array', () => {
        const out = toAttendanceOnlyDraft(fullDraft())!;
        expect(out.labour).toHaveLength(1);
        expect(out.labour[0]).toEqual(labourEntry);
        expect(out.labour[0].activity).toBe('shoot cutting');
        expect(out.labour[0].notes).toContain('विलास जाधव');
    });

    it('keeps what the farmer can still read — transcript, summary, outcome', () => {
        const src = fullDraft();
        const out = toAttendanceOnlyDraft(src)!;
        expect(out.fullTranscript).toBe(src.fullTranscript);
        expect(out.summary).toBe(src.summary);
        expect(out.dayOutcome).toBe('WORK_RECORDED');
        expect(out.disturbance).toEqual(src.disturbance);
        expect(out.dayOutcome).toBe(src.dayOutcome);
    });

    it('never reassigns another bucket into labour — no guessing', () => {
        const onlyIrrigation = { ...fullDraft(), labour: [] };
        const out = toAttendanceOnlyDraft(onlyIrrigation)!;
        expect(out.labour).toEqual([]);
    });

    it('null in, null out — the caller renders the ordinary empty form', () => {
        expect(toAttendanceOnlyDraft(null)).toBeNull();
    });
});

describe('isAttendanceOnlyDraft', () => {
    it('is true for a filtered draft that carries people', () => {
        expect(isAttendanceOnlyDraft(toAttendanceOnlyDraft(fullDraft()))).toBe(true);
    });

    it('is false for a full work log — the normal door keeps all its buckets', () => {
        expect(isAttendanceOnlyDraft(fullDraft())).toBe(false);
    });

    it('is false when nobody was named — nothing to show under a हजेरी heading', () => {
        expect(isAttendanceOnlyDraft(toAttendanceOnlyDraft({ ...fullDraft(), labour: [] }))).toBe(false);
    });

    it('is false for null', () => {
        expect(isAttendanceOnlyDraft(null)).toBe(false);
    });
});

// APK 1.0.14 founder report: बरोबर handed the save path a parse with no date
// and no provenance, so the record could not be queued for the server.
describe('toAttendanceSubmission — what बरोबर hands the save path', () => {
    const ai = { source: 'ai' as const, sourceAiJobId: '11111111-2222-4333-8444-555555555555', timestamp: '2026-10-17T05:00:00.000Z' };
    const draft = () => toAttendanceOnlyDraft(fullDraft())!;

    it('carries the day the attendance is for and the parse\'s own provenance', () => {
        const out = toAttendanceSubmission(draft(), ai, '2026-10-17');
        expect(out.date).toBe('2026-10-17');
        expect(out.provenance).toEqual(ai);
        // Nothing else changes: the हजेरी the farmer saw is what is saved.
        expect(out.labour).toEqual([labourEntry]);
        expect(out.cropActivities).toEqual([]);
        expect(out.fullTranscript).toBe(fullDraft().fullTranscript);
    });

    it('never invents a provenance claim (P8): no parse provenance -> none', () => {
        expect(toAttendanceSubmission(draft(), null, '2026-10-17').provenance).toBeUndefined();
        expect(toAttendanceSubmission(draft(), undefined, '2026-10-17').provenance).toBeUndefined();
    });

    it('an edit of an existing log carries no provenance, exactly as ManualEntry', () => {
        const out = toAttendanceSubmission({ ...draft(), originalLogId: 'log-1' }, ai, '2026-10-17');
        expect(out.provenance).toBeUndefined();
        expect(out.originalLogId).toBe('log-1');
    });
});
