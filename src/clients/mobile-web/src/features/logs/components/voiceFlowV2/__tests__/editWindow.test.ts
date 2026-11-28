/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 + B5) — the change window is the SERVER's `editableUntil` (ISO UTC) on
 * the daily log, read only when it is there; the phone never works out 24 hours itself (P10). Absent, unreadable or past = closed.
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import { editableUntilOf, isEditableAt, talkEditableAt } from '../editWindow';

const log = (editableUntil?: unknown): DailyLog =>
    ({ id: 'L1', date: '2026-10-26', meta: { createdAtISO: '2026-10-26T10:00:00.000Z' }, ...(editableUntil !== undefined && { editableUntil }) }) as unknown as DailyLog;

const NOW = Date.parse('2026-10-26T12:00:00Z');

describe('editableUntilOf', () => {
    it('reads the server\'s ISO time with a zone', () => {
        expect(editableUntilOf(log('2026-10-27T10:00:00Z'))?.toISOString()).toBe('2026-10-27T10:00:00.000Z');
        expect(editableUntilOf(log('2026-10-27T15:30:00.123+05:30'))?.toISOString()).toBe('2026-10-27T10:00:00.123Z');
    });

    it('nothing it cannot be sure of: absent, empty, no zone, not a time, not a string', () => {
        for (const v of [undefined, '', '2026-10-27T10:00:00', '2026-10-27', 'tomorrow', 1761559200000, null]) {
            expect(editableUntilOf(log(v)), String(v)).toBeNull();
        }
        expect(editableUntilOf(undefined)).toBeNull();
    });
});

describe('isEditableAt / talkEditableAt', () => {
    it('open only while the server\'s end is still ahead', () => {
        expect(isEditableAt(log('2026-10-27T10:00:00Z'), NOW)).toBe(true);
        expect(isEditableAt(log('2026-10-26T11:59:59Z'), NOW)).toBe(false);
        expect(isEditableAt(log('2026-10-26T12:00:00Z'), NOW)).toBe(false);
        expect(isEditableAt(log(), NOW)).toBe(false);
    });

    it('the phone never works it out: a log created a minute ago with no field is closed', () => {
        expect(isEditableAt(log(), Date.parse('2026-10-26T10:01:00Z'))).toBe(false);
    });

    it('a talk of several logs is open only while every one of them is', () => {
        expect(talkEditableAt([log('2026-10-27T10:00:00Z'), log('2026-10-27T10:00:00Z')], NOW)).toBe(true);
        expect(talkEditableAt([log('2026-10-27T10:00:00Z'), log()], NOW)).toBe(false);
        expect(talkEditableAt([], NOW)).toBe(false);
    });
});
