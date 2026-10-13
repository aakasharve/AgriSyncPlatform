/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * attendanceDoor — the ONE place that decides whether the manual हजेरी घ्या
 * door (hub tile, offline door, no-work-day tile) is shown.
 *
 * It is part of NORMAL Labour navigation (founder decision 2026-10-12): there
 * is no hidden gesture and no device switch. The answer is the SERVER's, carried
 * in `LabourData.canManageLabour` (owners and co-owners by role; every other
 * member, a Mukadam included, only through an active owner grant). The client
 * never inspects roles or grants itself.
 *
 * Only an explicit `true` opens the door. `false` (not allowed) and `undefined`
 * (an older server that does not send the flag) both keep it closed: the safe
 * default is hidden.
 *
 * It must never read `isPreview` or any mock/preview signal: the preview mount
 * has no farm, so the screen it opens cannot save or add a name.
 */
export function canTakeManualAttendance(canManageLabour: boolean | null | undefined): boolean {
    return canManageLabour === true;
}
