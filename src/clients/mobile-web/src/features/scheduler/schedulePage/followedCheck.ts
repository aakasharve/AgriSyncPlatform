/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-1F; R7, R8, founder D-91 = 1) - what to say under the schedule a
 * plot ALREADY follows when ShramSafal's check does not stand behind it.
 *
 *   - a withdrawn check: the subscription stays Active (R8), the page says the check was taken back and why;
 *   - a schedule that was never checked (a sample the plot followed before the crop had a checked one): kept, marked (R7);
 *   - either way, when the crop now has a checked schedule the farmer may take it ("नवीन तपासलेलं शेड्यूल घ्या").
 * Drawn from the SERVER'S word only (`template.check`, else the subscription's `checkState`); nothing here decides a check (P4).
 */
import type { CropScheduleTemplate, ScheduleCheckState } from '../scheduler.types';

export interface FollowedCheckNote {
    kind: 'withdrawn' | 'sample';
    /** The checker's reason (withdrawn only). */
    reason: string;
    /** The crop has a checked schedule the plot could take now. */
    offerNew: boolean;
}

export function followedCheckNote(
    template: Pick<CropScheduleTemplate, 'check'>,
    subscriptionCheckState: ScheduleCheckState | undefined,
    cropHasCheckedSchedule: boolean,
    /** spec: plr-d10 lane SCH-OWN-b (F228; D-82 = 3) - `Own`: no check applies to a person's own schedule, so there is nothing to say. Absent = as before. */
    origin?: 'Outside' | 'Own',
): FollowedCheckNote | null {
    if (origin === 'Own') return null;
    const state: ScheduleCheckState = template.check?.state ?? subscriptionCheckState ?? 'NotChecked';
    if (state === 'Checked') return null;
    if (state === 'Withdrawn') return { kind: 'withdrawn', reason: template.check?.note ?? '', offerNew: cropHasCheckedSchedule };
    return { kind: 'sample', reason: '', offerNew: cropHasCheckedSchedule };
}
