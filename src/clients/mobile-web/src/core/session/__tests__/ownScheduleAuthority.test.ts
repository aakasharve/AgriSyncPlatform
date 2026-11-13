/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b; founder D-88 = 2, doctrine P5, P9, P10) - who is SHOWN the maker.
 * The owner and the people holding "पीक वेळापत्रकाचे नमुने" (ScheduleTemplates) make and change an own schedule (the server asks again);
 * everyone else sees no maker and no library controls - nothing greyed. Decided from the seat's AUTHORITIES (never from a label) the way
 * the तुलना tab is (CMP-D1), and it FAILS CLOSED: a seat the phone does not know shows nothing.
 */
import { describe, expect, it } from 'vitest';
import { mayMakeOwnSchedule } from '../ownScheduleAuthority';

const NOW = new Date('2026-11-12T06:00:00.000Z');
const HOLD = { name: 'ScheduleTemplates', expiresAtUtc: null };
const OTHER = [{ name: 'TakeAttendance', expiresAtUtc: null }, { name: 'PlanWork', expiresAtUtc: null }];

describe('who is shown the own-schedule maker', () => {
    it('The_primary_owner_always_is', () => {
        expect(mayMakeOwnSchedule({ role: 'PrimaryOwner', authorities: [] }, NOW)).toBe(true);
        expect(mayMakeOwnSchedule({ role: 'PrimaryOwner' }, NOW)).toBe(true);
    });
    it('A_seat_holding_ScheduleTemplates_is_whatever_its_label', () => {
        for (const role of ['SecondaryOwner', 'Mukadam', 'Family']) {
            expect(mayMakeOwnSchedule({ role, authorities: [HOLD] }, NOW)).toBe(true);
        }
    });
    it('A_seat_without_it_is_not_(a_label_gives_nothing)', () => {
        for (const role of ['SecondaryOwner', 'Mukadam', 'Family', 'Worker']) {
            expect(mayMakeOwnSchedule({ role, authorities: OTHER }, NOW)).toBe(false);
            expect(mayMakeOwnSchedule({ role, authorities: [] }, NOW)).toBe(false);
        }
    });
    it('An_unknown_seat_is_hidden_(fail_closed)', () => {
        expect(mayMakeOwnSchedule(null, NOW)).toBe(false);
        expect(mayMakeOwnSchedule(undefined, NOW)).toBe(false);
        expect(mayMakeOwnSchedule({ role: 'SecondaryOwner' }, NOW)).toBe(false); // the server sent no list for a non-owner
        expect(mayMakeOwnSchedule({ role: null, authorities: null }, NOW)).toBe(false);
    });
    it('A_grant_that_has_ended_or_whose_end_cannot_be_read_is_not_held', () => {
        expect(mayMakeOwnSchedule({ role: 'SecondaryOwner', authorities: [{ name: 'ScheduleTemplates', expiresAtUtc: '2026-11-01T00:00:00Z' }] }, NOW)).toBe(false);
        expect(mayMakeOwnSchedule({ role: 'SecondaryOwner', authorities: [{ name: 'ScheduleTemplates', expiresAtUtc: 'not a date' }] }, NOW)).toBe(false);
        expect(mayMakeOwnSchedule({ role: 'SecondaryOwner', authorities: [{ name: 'ScheduleTemplates', expiresAtUtc: '2026-12-01T00:00:00Z' }] }, NOW)).toBe(true);
    });
});
