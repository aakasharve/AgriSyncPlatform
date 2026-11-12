/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 3; D-83 = 1, P9, P11) - the refusals of the own-schedule mutations
 * (schedule.create / .clone / .edit) that can never succeed on a retry, so they park for the farmer WITH WORDS instead of burning the retry cap.
 * Release 1.0.17's policy had no Schedule* code of these: nothing else changes.
 */
import { describe, expect, it } from 'vitest';
import { categorizeRejection, getPermanentRejectionCodes } from '../RejectionPolicy';
import { ownScheduleRefusalWords } from '../../../features/scheduler/ownSchedule/ownScheduleWords';

const CODES = [
    'ShramSafal.OwnScheduleEmpty',
    'ShramSafal.ScheduleCropNotOnFarm',
    'ShramSafal.ScheduleMadeFor',
    'ShramSafal.ScheduleImportOperationKey',
    'ShramSafal.ScheduleImportOutsideStages',
    'ShramSafal.ScheduleImportActivityDays',
    'ShramSafal.ScheduleImportStageDays',
    'ShramSafal.ScheduleImportStages',
    'ShramSafal.ScheduleImportRepeat',
    'ShramSafal.ScheduleImportActivityName',
    'ShramSafal.ScheduleImportActivities',
];

describe('own-schedule refusals are permanent', () => {
    it.each(CODES)('%s is permanent (the same bytes get the same answer for ever)', code => {
        expect(categorizeRejection({ errorCode: code })).toBe('PERMANENT');
    });
    it('The_id_already_taken_and_the_copy_already_made_were_permanent_already_through_their_tail_CONFLICT', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.ScheduleIdTaken.Conflict' })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: 'ShramSafal.ScheduleCopy.Conflict' })).toBe('PERMANENT');
    });
    it('The_policy_names_the_new_codes', () => {
        const listed = getPermanentRejectionCodes();
        for (const code of CODES) expect(listed).toContain(code.split('.').pop());
    });
    it('Old_behaviour_of_other_codes_is_unchanged: an unknown schedule word is still retryable, a not-found too', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.ScheduleSomethingNew' })).toBe('RETRYABLE');
        expect(categorizeRejection({ errorCode: 'ShramSafal.ScheduleTemplateNotFound' })).toBe('RETRYABLE'); // a statement about another row: as before this lane
        expect(categorizeRejection({ errorCode: null, errorMessage: '' })).toBe('RETRYABLE');
    });
});

describe('each refusal has its words (PROPOSED), Marathi in Marathi mode and English in English mode', () => {
    it('Marathi', () => {
        expect(ownScheduleRefusalWords('ShramSafal.OwnScheduleEmpty', 'mr')).toBe('आधी कामं जोडा');
        expect(ownScheduleRefusalWords('ShramSafal.ScheduleCropNotOnFarm', 'mr')).toBe('या शेतात हे पीक नाही.');
        expect(ownScheduleRefusalWords('ShramSafal.ScheduleIdTaken.Conflict', 'mr')).toBe('हे शेड्यूल आधीच बनवलेलं आहे.');
        expect(ownScheduleRefusalWords('ShramSafal.ScheduleMadeFor', 'mr')).toBe('ही निवड यादीत नाही.');
        expect(ownScheduleRefusalWords('ShramSafal.ScheduleImportOperationKey', 'mr')).toBe('कामाची ओळख बरोबर नाही.');
        expect(ownScheduleRefusalWords('ShramSafal.ScheduleCopy.Conflict', 'mr')).toBe('ही प्रत आधीच बनवलेली आहे.');
    });
    it('English', () => {
        expect(ownScheduleRefusalWords('ShramSafal.OwnScheduleEmpty', 'en')).toMatch(/^[\x20-\x7E]+$/);
        expect(ownScheduleRefusalWords('ShramSafal.ScheduleMadeFor', 'en')).toMatch(/^[\x20-\x7E]+$/);
    });
    it('A_code_it_has_no_words_for_gives_nothing_(never_a_made_up_sentence)', () => {
        expect(ownScheduleRefusalWords('ShramSafal.Whatever', 'mr')).toBeNull();
        expect(ownScheduleRefusalWords(undefined, 'mr')).toBeNull();
    });
    it('Day_rule_refusals_the_phone_checks_first_share_one_plain_line', () => {
        for (const code of CODES.filter(c => c.includes('ScheduleImport') && !c.endsWith('OperationKey'))) {
            expect(ownScheduleRefusalWords(code, 'mr')).toBeTruthy();
        }
    });
});
