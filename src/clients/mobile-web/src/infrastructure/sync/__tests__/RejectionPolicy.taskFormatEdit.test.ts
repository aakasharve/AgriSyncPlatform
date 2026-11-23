/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7) - the phone half of OldEditOfNewRow_RefusedVisibly. A whole edit (schedule.edit with stages and
 * works, the pre-format maker) of a schedule written in the task format would drop its works, so the server refuses it (ShramSafal.ScheduleTaskFormatEdit) and
 * writes nothing. The same bytes get the same answer for ever: the phone parks it WITH WORDS (the server's own Marathi twin) instead of burning the retry cap
 * and failing unseen.
 */
import { describe, expect, it } from 'vitest';
import { categorizeRejection, getPermanentRejectionCodes } from '../RejectionPolicy';
import { ownScheduleRefusalWords } from '../../../features/scheduler/ownSchedule/ownScheduleWords';

const CODE = 'ShramSafal.ScheduleTaskFormatEdit';

describe('OldEditOfNewRow_RefusedVisibly (phone)', () => {
    it('the refusal is permanent and listed by the policy', () => {
        expect(categorizeRejection({ errorCode: CODE })).toBe('PERMANENT');
        expect(getPermanentRejectionCodes()).toContain('ScheduleTaskFormatEdit');
    });

    it('it carries words: Marathi = the server twin, English in English mode', () => {
        expect(ownScheduleRefusalWords(CODE, 'mr')).toBe('हे शेड्यूल नव्या पद्धतीत आहे; हा बदल जतन झाला नाही.');
        expect(ownScheduleRefusalWords(CODE, 'en')).toMatch(/^[\x20-\x7E]+$/);
    });

    it('a code it does not know stays retryable, as before', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.ScheduleTaskFormatSomethingElse' })).toBe('RETRYABLE');
    });
});
