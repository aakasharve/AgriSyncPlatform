/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 + B5) — the change window is the SERVER's `editableUntilUtc` (ISO UTC)
 * on the daily log, read only when it is there; the phone never works out 24 hours itself (P10). Absent, unreadable or past = closed.
 * It binds ONLY the talk's own speaker (the server's `IsEditWindowClosedFor`): for anyone else it is no window at all.
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import { editableUntilOf, isEditableAt, isSpeakerOf, talkWindowFor } from '../editWindow';

const SPEAKER = 'op-speaker';
const log = (editableUntilUtc?: unknown, by: string = SPEAKER): DailyLog =>
    ({ id: 'L1', date: '2026-10-26', meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: by }, ...(editableUntilUtc !== undefined && { editableUntilUtc }) }) as unknown as DailyLog;

const NOW = Date.parse('2026-10-26T12:00:00Z');

describe('editableUntilOf', () => {
    it('reads the server\'s ISO time with a zone (the server\'s own microseconds too)', () => {
        expect(editableUntilOf(log('2026-10-27T10:00:00Z'))?.toISOString()).toBe('2026-10-27T10:00:00.000Z');
        expect(editableUntilOf(log('2026-11-29T09:23:17.510221Z'))?.toISOString()).toBe('2026-11-29T09:23:17.510Z');
        expect(editableUntilOf(log('2026-10-27T15:30:00.123+05:30'))?.toISOString()).toBe('2026-10-27T10:00:00.123Z');
    });

    it('nothing it cannot be sure of: absent, empty, no zone, not a time, not a string', () => {
        for (const v of [undefined, '', '2026-10-27T10:00:00', '2026-10-27', 'tomorrow', 1761559200000, null]) {
            expect(editableUntilOf(log(v)), String(v)).toBeNull();
        }
        expect(editableUntilOf(undefined)).toBeNull();
    });
});

describe('isEditableAt', () => {
    it('open only while the server\'s end is still ahead', () => {
        expect(isEditableAt(log('2026-10-27T10:00:00Z'), NOW)).toBe(true);
        expect(isEditableAt(log('2026-10-26T11:59:59Z'), NOW)).toBe(false);
        expect(isEditableAt(log('2026-10-26T12:00:00Z'), NOW)).toBe(false);
        expect(isEditableAt(log(), NOW)).toBe(false);
    });

    it('the phone never works it out: a log created a minute ago with no field has no window', () => {
        expect(isEditableAt(log(), Date.parse('2026-10-26T10:01:00Z'))).toBe(false);
    });
});

describe('talkWindowFor — the speaker only', () => {
    it('the talk\'s own speaker: open before the end, closed at and after it', () => {
        expect(talkWindowFor([log('2026-10-27T10:00:00Z')], SPEAKER, NOW)).toBe('open');
        expect(talkWindowFor([log('2026-10-26T12:00:00Z')], SPEAKER, NOW)).toBe('closed');
        expect(talkWindowFor([log('2026-10-26T09:00:00Z')], SPEAKER, NOW)).toBe('closed');
    });

    it('anyone else (the owner or a grant holder on his talk): no window, nothing closed — even after the end', () => {
        expect(talkWindowFor([log('2026-10-26T09:00:00Z')], 'op-owner', NOW)).toBe('none');
        expect(talkWindowFor([log('2026-10-27T10:00:00Z')], 'op-owner', NOW)).toBe('none');
        expect(isSpeakerOf(log(), 'op-owner')).toBe(false);
    });

    it('the owner on HIS OWN talk is its speaker: the server binds him too', () => {
        expect(talkWindowFor([log('2026-10-26T09:00:00Z', 'op-owner')], 'op-owner', NOW)).toBe('closed');
    });

    it('no window from the server, no viewer, or no talk: none', () => {
        expect(talkWindowFor([log()], SPEAKER, NOW)).toBe('none');
        expect(talkWindowFor([log('2026-10-27T10:00:00Z')], null, NOW)).toBe('none');
        expect(talkWindowFor([], SPEAKER, NOW)).toBe('none');
    });

    it('a talk of several logs is closed for him as soon as one of its windows is', () => {
        expect(talkWindowFor([log('2026-10-27T10:00:00Z'), log('2026-10-27T10:00:00Z')], SPEAKER, NOW)).toBe('open');
        expect(talkWindowFor([log('2026-10-27T10:00:00Z'), log('2026-10-26T09:00:00Z')], SPEAKER, NOW)).toBe('closed');
    });
});
