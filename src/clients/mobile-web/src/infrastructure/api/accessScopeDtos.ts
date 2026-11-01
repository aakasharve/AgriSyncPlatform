/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 (plan step 4a) — one farm's read scope on the /sync/pull wire (server `FarmAccessScopeDto`).
 * Booleans only: what the server sends THIS person for THIS farm. `false` = the server withholds it
 * (never "there is none"). Kept beside `dtos.ts` so that file stays under its size cap.
 */
import type { WithheldRecordDayDto } from './recordAudienceDtos';

/**
 * lane MU-3 fix 1 (F9) — the seat's standing on the farm. `Active` = the booleans below are what he reads.
 * `Paused` / `Waiting` / `Removed` = he reads nothing of it now: the server says so EXPLICITLY, only for a farm
 * this phone named in the pull (`farms=`), and only then does the phone remove that farm. A farm that is merely
 * absent from the list is never removed. Absent (a server before fix 1) = `Active`.
 */
export type FarmAccessStatus = 'Active' | 'Paused' | 'Waiting' | 'Removed';

export interface FarmAccessScopeDto {
    farmId: string;
    /** spec: plr-d10 lane PRV — the days whose totals leave a record out for him by rule (W4). Absent = none. */
    withheldRecordDays?: WithheldRecordDayDto[] | null;
    status?: FarmAccessStatus;
    ownRecordsOnly: boolean;
    seeMoney: boolean;
    seeWages: boolean;
    seeAttendance: boolean;
    seeTests: boolean;
    seeCompliance: boolean;
    seeFarmOverview: boolean;
}
