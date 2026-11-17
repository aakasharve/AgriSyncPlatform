/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-6; founder D-150, notes 1.2 and 2.4: "the third part hajeri comes
 * only when its head count is mentioned in log") - what the work home draws for the हजेरी part, decided from what today's
 * entries say (`TodayAttendance`, the हजेरी rule's own reading - nothing here changes that rule).
 *
 *   'card' - a head count was said (with or without the work): the हजेरी card, as before.
 *   'ask'  - work was told today but NO head count: no big card; ONE small line with the card's own button words
 *            ("किती जण होते ते सांगा"), opening the same crop -> plot -> mic step, so the ask is not lost.
 *   'rest' - a rest day was declared and nothing else: the card's own one sentence as ONE small line, opening the हजेरी place
 *            (its वही) as the card's link did - paid rest days stay reachable there (D-62).
 *   'none' - nothing told yet: nothing is drawn (the green door already asks for the work).
 *
 * Only the Home uses this. The result screen after he speaks draws its own card (`entryAttendance`), untouched.
 *
 * Pure: no React, no storage.
 */
import type { TodayAttendance } from './todayAttendance';

export type HomeAttendanceShape = 'card' | 'ask' | 'rest' | 'none';

export function homeAttendanceShape(state: TodayAttendance): HomeAttendanceShape {
    if (state.headcount !== null) return 'card';
    if (state.work !== null) return 'ask';
    if (state.restDay) return 'rest';
    return 'none';
}
