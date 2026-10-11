/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * attendanceDoor — the ONE place that decides whether the manual हजेरी घ्या
 * door (hub tile, offline door, no-work-day tile) is shown.
 *
 * It is deliberately a FUNCTION, not an exported constant and not a prop:
 * every surface asks it, nothing else may decide. How the founder accepts the
 * release (merge-as-gate, a server flag, an owner cohort) is an open question
 * (spec LABOUR_COMPLETION §5 / Q1); whichever is chosen, it is changed HERE,
 * in one line, with no other file touched.
 *
 * It must never read `isPreview` or any mock/preview signal: the preview mount
 * has no farm, so the screen it opens cannot save or add a name (the roster
 * and the queue need a farm) and therefore cannot show an acknowledgement.
 */
export function isAttendanceDoorEnabled(): boolean {
    return true;
}
