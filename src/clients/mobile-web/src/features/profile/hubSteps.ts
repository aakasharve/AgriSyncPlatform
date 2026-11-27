/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The सेट-अप केंद्र's steps, in the founder's order (repair FIX-1 item 3; R2-A 08 + section J,
 * founder 27 Nov): infrastructure before crop and plot.
 *
 *   माझी ओळख → पाण्याचे स्रोत → मोटर → वीज आणि वेळापत्रक → पिकं आणि प्लॉट → माझी टीम → यंत्रं → माती व पाणी अहवाल
 *
 * Water, motor and power are ONE page (`UtilitiesSection`) shown as three steps, so each step names
 * the page it opens. Pure: no React, so the order and the "is it really saved" rules are tested alone.
 */
import type { ElectricityTimingConfiguration } from '../../domain/types/farm.types';
import type { ProfileTab } from './ProfilePage';
import type { LabourPermission } from './data/labourPermissionsClient';
import type { PersonalInvitationView } from '../invitations/personalInvitationClient';

export type HubStepId = 'identity' | 'water' | 'motor' | 'power' | 'structure' | 'team' | 'machines' | 'health';

/** The one order: the hub's rows and "पुढचं" both follow it. */
export const HUB_STEP_ORDER: readonly HubStepId[] = [
    'identity', 'water', 'motor', 'power', 'structure', 'team', 'machines', 'health',
];

/** The page each step opens (the three water / motor / power steps share one). */
export const HUB_STEP_TAB: Record<HubStepId, ProfileTab> = {
    identity: 'identity',
    water: 'utils',
    motor: 'utils',
    power: 'utils',
    structure: 'structure',
    team: 'team',
    machines: 'machines',
    health: 'health',
};

/**
 * Has the farmer really saved his power times? The app starts every phone with a timetable of its
 * own (no power cut at all), so the timetable being there proves nothing. True when he pressed
 * जतन करा on the page (`savedByFarmerAt`), or — a phone that saved before that mark existed — when
 * any power cut is set (the starting timetable has none, so the farmer set it).
 */
export function powerTimesSaved(timing: ElectricityTimingConfiguration | undefined | null): boolean {
    if (!timing) return false;
    if (timing.savedByFarmerAt) return true;
    return [timing.singlePhase, timing.threePhase].some(
        phase => (phase?.weekAOffWindows?.length ?? 0) > 0 || (phase?.weekBOffWindows?.length ?? 0) > 0,
    );
}

/**
 * Repair FIX-1 item 10 — "I run this farm alone for now", kept on this phone PER FARM, beside the hub's other per-farm mark
 * (`farm:weatherConnected:<farmId>`, the uiPrefs store). Phone-only until the farm setup moves to the server (D-9).
 */
export const teamSoloKey = (farmId: string): string => `farm:teamSolo:${farmId}`;

/** An invitation that still stands for someone (sent and waiting, or taken up); a declined, withdrawn or expired one does not. */
const STANDING_INVITATION = new Set(['Waiting', 'Accepted']);

export type TeamStep =
    /** Not a setup step for this person or not known yet: the row as before, never counted, never red. */
    | { counted: false }
    /** The primary owner's step: done, and whether the first-setup question card stands in for the row. */
    | { counted: true; done: boolean; firstCard: boolean };

/**
 * Repair FIX-1 item 10 (R2-B 15, founder 27 Nov) — the माझी टीम step. Adding one person is a MUST for the primary owner (the
 * only one who invites, D-26): done once someone else is on the team list, an invitation stands, or he said he runs the farm
 * alone for now. Never counted while the list, the invitations or his mark is not known (no false red, no false पूर्ण). The
 * question card shows only while nobody else is there and no request waits (a waiting request keeps the normal row, which
 * says it); it never blocks anything.
 */
export function teamStepOf(input: {
    isPrimaryOwner: boolean;
    callerUserId: string | null | undefined;
    rows: readonly LabourPermission[] | null;
    invitations: readonly Pick<PersonalInvitationView, 'status'>[] | null;
    solo: boolean | null;
}): TeamStep {
    const { isPrimaryOwner, callerUserId, rows, invitations, solo } = input;
    if (!isPrimaryOwner || rows === null || invitations === null || solo === null) return { counted: false };
    const others = rows.filter(r => r.userId !== callerUserId && r.role !== 'PrimaryOwner'
        && (r.status === 'Active' || r.status === 'Suspended'));
    const waiting = rows.some(r => r.status === 'PendingApproval');
    const standing = invitations.some(i => STANDING_INVITATION.has(i.status));
    const done = others.length > 0 || standing || solo;
    return { counted: true, done, firstCard: !done && !waiting };
}
