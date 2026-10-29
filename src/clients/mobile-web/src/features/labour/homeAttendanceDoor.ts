/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, H10 / H-13) — who sees the "आजची हजेरी"
 * door on the work home. ONLY someone who may manage labour (PLR-D9 §6, PLR-D7 §2b): the owner tier
 * (PrimaryOwner / SecondaryOwner, as the SERVER told the phone in /me/context), or a member the owner
 * granted labour rights to (`canManageLabour`, the server's own last answer, cached by the हजेरी
 * screen). A worker never gets it. Unknown stays closed — the safe default is hidden, exactly like
 * `attendanceDoor.ts`. The client never decides a grant itself.
 *
 * I12-V1-M2: a मुकादम on a fresh phone has no cached answer yet, so `useHomeAttendanceDoor` asks the
 * server for the read-out when the tab opens online and caches it the same way the हजेरी screen does;
 * until that answer arrives the door stays hidden.
 */
import { isOwnerTierRole } from '../profile/helpers/teamRoster';
import { loadLabourReadout } from './data/labourReadout';
import { LABOUR_WINDOW_ORDER } from './labourWindow';

/**
 * The server's LATEST cached "may this caller take attendance" answer for this user and farm, if any
 * (the newest read-out across the four windows wins, so a revoked grant is not outlived by an older copy).
 */
export function readCachedLabourGrant(userId: string | null | undefined, farmId: string | null | undefined): boolean | undefined {
    if (!userId || !farmId) return undefined;
    let newest: { at: string; grant: boolean } | null = null;
    for (const window of LABOUR_WINDOW_ORDER) {
        const cached = loadLabourReadout(userId, farmId, window);
        const grant = cached?.data.canManageLabour;
        if (typeof grant !== 'boolean' || !cached) continue;
        if (!newest || cached.savedAtUtc > newest.at) newest = { at: cached.savedAtUtc, grant };
    }
    return newest?.grant;
}

export function mayOpenAttendanceFromHome(role: string | null | undefined, cachedGrant: boolean | null | undefined): boolean {
    return isOwnerTierRole(role) || cachedGrant === true;
}

/** A plain worker: the role the server gave him on this farm. */
export function isWorkerRole(role: string | null | undefined): boolean {
    return role === 'Worker';
}

/**
 * May the work home show the farm's running cost? ONLY to the primary account holder — the farm's
 * creator, `PrimaryOwner` as the server told this phone (PLR-D10 I20 / N7; founder D-22 "work access
 * ≠ money access" and D-26 "neither सहमालक nor कुटुंब receives additional powers automatically").
 * A co-owner, family member, मुकादम or expert gets nothing from the label; a worker never; and a
 * role the server has not told this phone yet stays closed (I12-V1-m6).
 */
export function mayShowFarmMoney(role: string | null | undefined): boolean {
    return role === 'PrimaryOwner';
}
