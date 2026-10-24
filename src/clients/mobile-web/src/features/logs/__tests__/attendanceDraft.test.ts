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
import { toAttendanceOnlyDraft, isAttendanceOnlyDraft, toAttendanceSubmission, attendanceCaptureDay } from '../attendanceDraft';
import { getDateKey } from '../../../core/domain/services/DateKeyService';

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

// APK 1.0.14 founder report + PR #82 review (B003/B004/B005, captureScope):
// what बरोबर on the labour door hands the save path.
describe('toAttendanceSubmission — what बरोबर hands the save path', () => {
    const ai = { source: 'ai' as const, sourceAiJobId: '11111111-2222-4333-8444-555555555555', timestamp: '2026-01-05T18:20:00.000Z' };
    /** A parse that also heard things the card does not show. */
    const parsed = (): AgriLogResponse => ({
        ...toAttendanceOnlyDraft(fullDraft())!,
        observations: [{ textRaw: 'पाऊस पडला', noteType: 'observation' }],
        plannedTasks: [{ title: 'उद्या फवारणी', category: 'general', sourceText: 'उद्या फवारणी', systemInterpretation: '' }],
        dayOutcome: 'DISTURBANCE_RECORDED',
    } as unknown as AgriLogResponse);

    it('B004: a new record carries LABOUR ONLY — nothing the card did not show', () => {
        const out = toAttendanceSubmission(parsed(), ai);
        expect(Object.keys(out).sort()).toEqual(['captureScope', 'date', 'labour', 'provenance']);
        expect(out.labour).toEqual([labourEntry]);
        for (const dropped of ['observations', 'plannedTasks', 'dayOutcome', 'disturbance', 'fullTranscript', 'summary', 'cropActivities']) {
            expect(out, dropped).not.toHaveProperty(dropped);
        }
    });

    it('captureScope: a new record says it came from the labour door', () => {
        expect(toAttendanceSubmission(parsed(), ai).captureScope).toBe('labour');
        expect(toAttendanceSubmission(parsed(), null).captureScope).toBe('labour');
    });

    it('B003: filed under the IST day of the capture, not the day of the tap', () => {
        // 18:20Z on 5 Jan = 23:50 IST on 5 Jan; whenever this test runs, the tap day differs.
        expect(toAttendanceSubmission(parsed(), ai).date).toBe('2026-01-05');
        // 18:31Z = 00:01 IST on the 6th: the farmer's local day, not UTC's.
        expect(attendanceCaptureDay({ ...ai, timestamp: '2026-01-05T18:31:00.000Z' })).toBe('2026-01-06');
    });

    it('B003: no capture timestamp (or an unreadable one) -> today', () => {
        expect(toAttendanceSubmission(parsed(), null).date).toBe(getDateKey());
        expect(attendanceCaptureDay({ ...ai, timestamp: 'not a time' })).toBe(getDateKey());
    });

    it('provenance is passed through, never invented (P8): none in -> none out', () => {
        expect(toAttendanceSubmission(parsed(), ai).provenance).toEqual(ai);
        expect(toAttendanceSubmission(parsed(), null)).not.toHaveProperty('provenance');
        expect(toAttendanceSubmission(parsed(), undefined)).not.toHaveProperty('provenance');
    });

    it('an EDIT sends labour only: no date (keeps its day), no provenance, no scope, no empty buckets to erase its other work', () => {
        const out = toAttendanceSubmission({ ...parsed(), originalLogId: 'log-1' }, ai);
        expect(out).toEqual({ originalLogId: 'log-1', labour: [labourEntry] });
    });
});
