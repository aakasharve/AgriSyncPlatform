/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-6; founder D-150, notes 1.2 and 2.4: "the third part hajeri comes
 * only when its head count is mentioned in log") - what the work home draws for the हजेरी part, decided from what today's
 * entries say (`TodayAttendance`, the हजेरी rule's own reading - nothing here changes that rule).
 *
 *   'card' - a head count was said (with or without the work): the हजेरी card, as before.
 *   'ask'  - work was told today but NO head count: no big card; a small note that says the head count comes next, echoes the
 *            work told, and has ONE tap ("किती जण होते ते सांगा") into the same crop -> plot -> mic step.
 *   'rest' - a rest day was declared and nothing else: the card's own one sentence as ONE small line, opening the हजेरी place
 *            (its वही) as the card's link did - paid rest days stay reachable there (D-62).
 *   'rule' - nothing told yet: a small note with the rule ("only after the work is told: which crop, which plot ... then you can
 *            take हजेरी, see who came and confirm the pay"). Founder follow-up 2026-11-19: the part is never simply gone.
 *
 * Only the Home uses this. The result screen after he speaks draws its own card (`entryAttendance`), untouched.
 *
 * Pure: no React, no storage.
 */
import type { TodayAttendance } from './todayAttendance';

export type HomeAttendanceShape = 'card' | 'ask' | 'rest' | 'rule';

export function homeAttendanceShape(state: TodayAttendance): HomeAttendanceShape {
    if (state.headcount !== null) return 'card';
    if (state.work !== null) return 'ask';
    if (state.restDay) return 'rest';
    return 'rule';
}
