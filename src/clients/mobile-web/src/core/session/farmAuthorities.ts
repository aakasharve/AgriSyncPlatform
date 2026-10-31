/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane 2b (MU farm-relationships design §2, §6, §11.1; founder D-22 / D-26) — what THIS seat may do
 * on the open farm, read from the server's `/me/context` authorities, never from the label. A
 * सहमालक / कुटुंब / मुकादम label grants nothing; the primary account holder holds every authority.
 *
 * The phone draws a door only where the server would let the person through (doctrine P5). When
 * the phone does not KNOW — no farm context yet, or an older server that sends no `authorities` —
 * the answer is the pre-2b rule for that door (the owner tier), so an older server keeps working
 * exactly as before (P11); the server still decides every request.
 */
import type { MeFarm } from './MeContextService';

/** The server's authority names (the wire vocabulary; `FarmAuthority` on the server). */
export const AUTHORITY = {
    takeAttendance: 'TakeAttendance',
    confirmRecords: 'ConfirmRecords',
    seeMoney: 'SeeMoney',
    seeWages: 'SeeWages',
    reviewMoney: 'ReviewMoney',
    planWork: 'PlanWork',
    assignWork: 'AssignWork',
    editFarmSetup: 'EditFarmSetup',
    labRecords: 'LabRecords',
    scheduleTemplates: 'ScheduleTemplates',
} as const;

export type AuthorityName = typeof AUTHORITY[keyof typeof AUTHORITY];

/**
 * The authorities lane 2b ENFORCES on the server, in the order the owner's switches show them.
 * See money, see wages, plan and assign have no switch yet (P5: not enforced until MU-3 / L8).
 */
export const SWITCHABLE_AUTHORITIES: readonly AuthorityName[] = [
    AUTHORITY.takeAttendance,
    AUTHORITY.confirmRecords,
    AUTHORITY.reviewMoney,
    AUTHORITY.editFarmSetup,
    AUTHORITY.labRecords,
    AUTHORITY.scheduleTemplates,
];

/** An authority that means nothing without another (review money needs see money, §11.1). */
export function authorityNeeds(name: string): AuthorityName | null {
    return name === AUTHORITY.reviewMoney || name === AUTHORITY.seeWages ? AUTHORITY.seeMoney : null;
}

/** The server said this person is the farm's primary account holder (people and permissions are his alone, D-26). */
export function isPrimaryAccountHolderRole(role: string | null | undefined): boolean {
    return role === 'PrimaryOwner';
}

/**
 * Does this seat hold `name` now? From the server's list when it sent one; otherwise (an older
 * server, or the farm not known yet) the pre-2b owner-tier rule, so nothing that worked yesterday
 * disappears against an older server.
 */
export function holdsAuthority(
    farm: Pick<MeFarm, 'role' | 'authorities'> | null | undefined,
    name: AuthorityName,
): boolean {
    if (!farm) return false;
    if (Array.isArray(farm.authorities)) {
        return farm.authorities.some(a => a?.name === name);
    }
    return farm.role === 'PrimaryOwner' || farm.role === 'SecondaryOwner';
}
