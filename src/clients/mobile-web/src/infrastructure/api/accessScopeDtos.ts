/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 (plan step 4a) — one farm's read scope on the /sync/pull wire (server `FarmAccessScopeDto`).
 * Booleans only: what the server sends THIS person for THIS farm. `false` = the server withholds it
 * (never "there is none"). Kept beside `dtos.ts` so that file stays under its size cap.
 */
export interface FarmAccessScopeDto {
    farmId: string;
    ownRecordsOnly: boolean;
    seeMoney: boolean;
    seeWages: boolean;
    seeAttendance: boolean;
    seeTests: boolean;
    seeCompliance: boolean;
    seeFarmOverview: boolean;
}
