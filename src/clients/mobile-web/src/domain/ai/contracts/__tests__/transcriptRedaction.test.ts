/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.4 — the redaction primitive itself.
 *
 * Two obligations pull against each other here and both are asserted:
 *   1. the transcript must be GONE, at every depth;
 *   2. the structured correction signal must be UNTOUCHED — it is the AI
 *      learning loop's only input and has no other home.
 */

import { describe, it, expect } from 'vitest';
import {
    stripTranscriptText,
    containsTranscriptText,
    TRANSCRIPT_TEXT_KEYS,
} from '../transcriptRedaction';

describe('stripTranscriptText', () => {
    it('transcript_keys_are_removed_at_the_top_level', () => {
        const input = {
            fieldPath: 'labour',
            rawTranscript: 'आज रामू आणि सीता आले',
            sourceText: 'रामू आणि सीता',
            fullTranscript: 'आज रामू आणि सीता आले',
        };

        const result = stripTranscriptText(input) as Record<string, unknown>;

        expect(result).toEqual({ fieldPath: 'labour' });
        expect(containsTranscriptText(result)).toBe(false);
    });

    it('transcript_keys_are_removed_from_nested_bucket_items', () => {
        // This is the shape that actually leaks: worker names live in the
        // per-item `sourceText`, inside `aiValue`, inside a correction event.
        const input = {
            aiValue: [
                { workerCount: 2, sourceText: 'रामू आणि सीता आले' },
                { workerCount: 1, nested: { deeper: [{ sourceText: 'सुनीता' }] } },
            ],
        };

        const result = stripTranscriptText(input);

        expect(containsTranscriptText(result)).toBe(false);
        expect(JSON.stringify(result)).not.toContain('रामू');
        expect(JSON.stringify(result)).not.toContain('सुनीता');
    });

    it('the_structured_signal_survives_untouched', () => {
        const input = {
            fieldPath: 'labour',
            correctionType: 'wrong_value',
            bucketId: 'labour',
            aiValue: [{ maleCount: 3, femaleCount: 0, wageRate: 400, sourceText: 'तीन माणसे' }],
            userValue: [{ maleCount: 2, femaleCount: 1, wageRate: 400 }],
            promptVersion: 'v42',
            promptContentHash: 'a'.repeat(64),
        };

        const result = stripTranscriptText(input) as typeof input;

        expect(result.fieldPath).toBe('labour');
        expect(result.correctionType).toBe('wrong_value');
        expect(result.bucketId).toBe('labour');
        expect(result.promptVersion).toBe('v42');
        expect(result.promptContentHash).toBe('a'.repeat(64));
        // Every number the farmer and the AI disagreed about is still there.
        expect(result.aiValue[0]).toEqual({ maleCount: 3, femaleCount: 0, wageRate: 400 });
        expect(result.userValue[0]).toEqual({ maleCount: 2, femaleCount: 1, wageRate: 400 });
    });

    it('an_observation_note_keeps_its_own_text', () => {
        // `textRaw` is the observation's VALUE, not a recording of speech.
        // Stripping it would delete the correction signal for that bucket.
        const input = { observations: [{ textRaw: 'पानावर तांबडे डाग', severity: 'high' }] };

        const result = stripTranscriptText(input) as typeof input;

        expect(result.observations[0]?.textRaw).toBe('पानावर तांबडे डाग');
        expect(result.observations[0]?.severity).toBe('high');
    });

    it('strip_is_idempotent', () => {
        const input = { aiValue: [{ n: 1, sourceText: 'x' }], rawTranscript: 'y' };

        const once = stripTranscriptText(input);
        const twice = stripTranscriptText(once);

        expect(twice).toEqual(once);
    });

    it('strip_never_mutates_its_input', () => {
        const input = { rawTranscript: 'still here', aiValue: [{ sourceText: 'also here' }] };
        const snapshot = JSON.stringify(input);

        stripTranscriptText(input);

        expect(JSON.stringify(input)).toBe(snapshot);
    });

    it('strip_only_removes_and_never_invents_a_key', () => {
        const input = { a: 1, b: { c: 2 }, rawTranscript: 'gone' };

        const result = stripTranscriptText(input) as Record<string, unknown>;

        // Every key in the output existed in the input. Nothing was defaulted
        // in to fill the hole the transcript left.
        expect(Object.keys(result).every(k => k in input)).toBe(true);
        expect(result).toEqual({ a: 1, b: { c: 2 } });
    });

    it('scalars_and_null_pass_through', () => {
        expect(stripTranscriptText('a bare string is not assumed to be speech'))
            .toBe('a bare string is not assumed to be speech');
        expect(stripTranscriptText(42)).toBe(42);
        expect(stripTranscriptText(null)).toBeNull();
        expect(stripTranscriptText(undefined)).toBeUndefined();
    });

    it('every_declared_transcript_key_is_actually_stripped', () => {
        for (const key of TRANSCRIPT_TEXT_KEYS) {
            const result = stripTranscriptText({ [key]: 'spoken words', keep: 1 });
            expect(result).toEqual({ keep: 1 });
        }
    });
});

describe('containsTranscriptText', () => {
    it('detects_a_transcript_key_nested_at_any_depth', () => {
        expect(containsTranscriptText({ a: { b: [{ sourceText: 'x' }] } })).toBe(true);
        expect(containsTranscriptText({ a: { b: [{ n: 1 }] } })).toBe(false);
    });
});
