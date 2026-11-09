/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2 Task 4; Review Focus 1) - the refusals of a schedule choice.
 * `ShramSafal.ScheduleAlreadyAdopted` (another phone chose first) and `ShramSafal.Forbidden` (no authority to change the
 * plot's schedule, lane L8b-1) can never succeed by waiting or retrying: both are PERMANENT, parked for the farmer.
 */
import { describe, expect, it } from 'vitest';
import { categorizeRejection, getPermanentRejectionCodes } from '../RejectionPolicy';

describe('schedule-choice refusals', () => {
    it('ShramSafal.ScheduleAlreadyAdopted is permanent (it was retried for ever before: unlisted codes are RETRYABLE)', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.ScheduleAlreadyAdopted' })).toBe('PERMANENT');
        expect(categorizeRejection({ errorCode: null, errorMessage: 'An active schedule subscription already exists; ScheduleAlreadyAdopted' })).toBe('PERMANENT');
        expect(getPermanentRejectionCodes()).toContain('ScheduleAlreadyAdopted');
    });

    it.each(['ScheduleLimitReached', 'OwnScheduleLimitReached', 'ScheduleChoiceNeeded'])(
        'lane L8b-3: ShramSafal.%s is permanent (3 + 1: a 4th outside / 2nd own / an unnamed one of several can never succeed on a retry)',
        code => {
            expect(categorizeRejection({ errorCode: `ShramSafal.${code}` })).toBe('PERMANENT');
            expect(getPermanentRejectionCodes()).toContain(code);
        },
    );

    it('ShramSafal.Forbidden is permanent', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.Forbidden' })).toBe('PERMANENT');
    });

    it('a code nobody listed stays retryable (fail-safe toward retrying, as before)', () => {
        expect(categorizeRejection({ errorCode: 'ShramSafal.SomethingTransient' })).toBe('RETRYABLE');
    });
});
