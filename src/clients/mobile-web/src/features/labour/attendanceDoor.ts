/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * attendanceDoor — the ONE place that decides whether the manual हजेरी घ्या
 * door (hub tile, offline door, no-work-day tile) is shown.
 *
 * RUNTIME, PER-DEVICE EARLY-ACCESS SWITCH (spec 2026-08-25-prod-cutover-waves):
 * the shipped artifact has the door OFF. The founder turns it ON on his own
 * device (see earlyAccess.ts), tests the real artifact, and a later separate
 * release may change the default. Storage failure => OFF, never throws.
 *
 * It is deliberately a FUNCTION, not an exported constant and not a prop:
 * every surface asks it, nothing else may decide. Every surface asks it, nothing else decides.
 *
 * It must never read `isPreview` or any mock/preview signal: the preview mount
 * has no farm, so the screen it opens cannot save or add a name (the roster
 * and the queue need a farm) and therefore cannot show an acknowledgement.
 */
import { readDeviceFlag, writeDeviceFlag } from '../../infrastructure/storage/LabourLocalStore';

export const ATTENDANCE_DOOR_STORAGE_KEY = 'agrisync.early.attendanceDoor';

export function isAttendanceDoorEnabled(): boolean {
    return readDeviceFlag(ATTENDANCE_DOOR_STORAGE_KEY);
}

/** Returns whether the value was persisted (false when storage is blocked). */
export function setAttendanceDoorEnabled(on: boolean): boolean {
    return writeDeviceFlag(ATTENDANCE_DOOR_STORAGE_KEY, on);
}
