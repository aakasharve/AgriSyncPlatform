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

/**
 * spec: plr-d10 lane MU-4 — which plots the seat covers: every plot (the default), the chosen plots (`plotIds`), or his
 * own work (every plot's NAME, his own records). Absent = an older server = every plot.
 */
export type FarmPlotScope = 'AllPlots' | 'ChosenPlots' | 'OwnWork';

export interface FarmAccessScopeDto {
    /** lane MU-4 — which plots the seat covers (absent = every plot). */
    plotScope?: FarmPlotScope | null;
    /** lane MU-4 — the chosen plots, sent only with `ChosenPlots` (absent / null otherwise). */
    plotIds?: string[] | null;
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
    /**
     * spec: plr-d10 lane L8c-1 fix round 1 (L001) - this person holds "see all tasks" NOW (the server computes it with the
     * clock: an ended grant arrives as false). Absent = an older server: the phone removes no task. With `plotScope` and
     * `plotIds` it is all the phone needs to mirror which tasks he may see (for removal only).
     */
    seeAllTasks?: boolean | null;
    /**
     * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-177) - the farm's switch: a money checker may approve a bill he made himself. Written by
     * the server ONLY when the primary owner turned it on; absent = off (and an older server never sends it: the stricter rule stays).
     */
    reviewerMayApproveOwnBill?: boolean | null;
    /**
     * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM) - the farm's "पैशांच्या नोंदी फक्त मला दिसू दे": written by the server ONLY
     * while its registrant has it on; absent = off (and an older server never sends it).
     */
    moneyPrivate?: boolean | null;
    /**
     * pilot lane PERM - the kinds of work THIS person may record on this farm (`sync-contract/schemas/work-kinds.json` names). Written ONLY when his
     * seat is limited: absent = every kind (every seat until the owner limits it, and every older server). The server decides again on every write.
     */
    workKinds?: string[] | null;
    /**
     * pilot lane PERM (contract S3) - who besides the farm's registrant (implied) and this person would see a record he makes, as seat labels only
     * (no name, no id, no count). Sent ONLY to a phone that asks (`seenBy=1`); absent = not known (the saved screen then draws no line).
     */
    seenBy?: SeenByDto | null;
}

/** pilot lane PERM - one kind of seat in `seenBy`: its label (else its role), and its plots when it covers chosen plots only. */
export interface SeenByEntryDto {
    who: string;
    /** Absent = the seat covers every plot. */
    plotIds?: string[] | null;
}

/** pilot lane PERM - the reader-specific, name-free "who sees this" of one farm (server `SeenByDto`). */
export interface SeenByDto {
    work: SeenByEntryDto[];
    attendance: SeenByEntryDto[];
    money: SeenByEntryDto[];
}
