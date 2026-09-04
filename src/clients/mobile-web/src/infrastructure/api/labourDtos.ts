/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LABOUR_PHASE2 Phase 3 — the labour half of the `/sync/pull` wire contract.
 *
 * SPLIT OUT OF `dtos.ts` for one reason, stated plainly: that file is the
 * hand-maintained twin of the whole DTO layer and adding these two records to it
 * put it over the 800-line cap `scripts/check-file-sizes.mjs` enforces in CI.
 * Everything here is re-exported from `dtos.ts` (and onward from
 * `AgriSyncClient.ts`), so every existing import site is unchanged.
 *
 * THESE ARE HAND-MAINTAINED TWINS of
 * `ShramSafal.Application.Contracts.Dtos.LabourEngagementDto` /
 * `AttributedOperatorDto`. Nothing compiles the two against each other, so
 * TypeScript will never surface drift on its own — widen them deliberately.
 */

/**
 * LABOUR_PHASE2 Phase 3 — ONE live attribution row
 * (`ShramSafal.Application.Contracts.Dtos.AttributedOperatorDto`), i.e. one
 * person who is attributed to this engagement RIGHT NOW.
 *
 * `displayNameAtAttach` is the SNAPSHOT taken when the person was attached, not
 * their current name — a payout approved for "बाळू" must still read "बाळू"
 * after a rename. There is deliberately no `fullName` (never snapshotted onto
 * work rows) and no count, wage or money of any kind: attribution is an OVERLAY
 * on a reported quantity, never a replacement for it.
 */
export interface AttributedOperatorDto {
    fieldOperatorId: string;
    displayNameAtAttach: string;
}

/**
 * LABOUR_PHASE2 Phase 3 — one `LabourAssignment` as a device reads it back on
 * `/sync/pull`. The hand-maintained twin of
 * `ShramSafal.Application.Contracts.Dtos.LabourEngagementDto`.
 *
 * CURRENT TRUTH ONLY. `ssf.labour_corrections` — "what was it before?" — is
 * NEVER projected here and must never be added: the engagement already IS the
 * corrected truth, and the everyday labour view must not consume an audit
 * ledger. History is fetched on demand from its own route.
 *
 * `labourAssignmentId` IS the id this phone minted (`ValueGeneratedNever`
 * server-side), so the attribution picker and the correction path key on the
 * same id after a round trip with no mapping layer.
 *
 * ENUMS TRAVEL AS NAMES, never ordinals — the server projects them as `string`
 * precisely so no serializer setting can turn one into a number.
 */
export interface LabourEngagementDto {
    labourAssignmentId: string;
    /** The anchor, restated so a flattened client list stays addressable. */
    dailyLogId: string;
    /** `"Hired"` | `"Contract"` | `"Self"`. */
    engagementType: string;

    /**
     * THE CANONICAL REPORTED HEADCOUNT, exactly as stored, and the ONLY
     * headcount on this wire. `null` means "we were not told" and NEVER "zero
     * people worked" — an explicitly stated 0 stores 0 and stays
     * distinguishable from silence.
     *
     * `attributedOperators.length` is NOT a headcount and must never be read as
     * one (doctrine P7): eight workers with three people named is still eight.
     * There is no resolved `headcount` member here and there must never be one.
     */
    workerCount: number | null;
    /** The split exactly as stated; never derived from `workerCount`. */
    maleCount: number | null;
    femaleCount: number | null;

    wagePerPerson: number | null;
    /** `"Tree"` | `"Acre"` | `"Row"` | `"LumpSum"`, or null. */
    contractUnit: string | null;
    contractQuantity: number | null;
    /** Stated total only (NO-MULTIPLY) — null when the farmer stated none. */
    totalCost: number | null;

    /**
     * DURATION AND ITS PROVENANCE — PAIRED (doctrine P8). Hours alone are a
     * lie; hours plus their basis are a record. Both are non-nullable on the
     * server record and are read off the same entity at the single construction
     * site, so they can neither travel alone nor disagree. Nothing on this
     * client may render, store or forward one without the other.
     */
    durationHours: number;
    /** `"Explicit"` (the farmer stated it) or `"Assumed"` (the server filled it in). */
    timeBasis: string;

    /** `"Full"` | `"Half"` | `"Night"`, or null. Descriptive, never money. */
    shift: string | null;
    /** The task as spoken (फवारणी/छाटणी/…). Descriptive, never money. */
    task: string | null;
    /** The farmer's own note, verbatim. `null` = none was written, never `""`. */
    notes: string | null;

    /**
     * Worker names AS STATED, free text. Never null — an EMPTY list means the
     * farmer named nobody, which is a complete record (P9), not a gap. These
     * are NOT attribution: they resolve to no identity and carry no id.
     */
    workerNames: string[];

    createdAtUtc: string;
    linkedActivityId: string | null;

    /** The LIVE attribution set. Never null; empty is normal and complete. */
    attributedOperators: AttributedOperatorDto[];
}


/**
 * task-0b (spec 2026-08-28-labour-v2-release-1) — `DailyLogDto.dayOutcome`'s
 * value set: the farmer's OWN statement about the day, read back verbatim
 * from `ShramSafal.Application/Contracts/Dtos/DailyLogDto.cs` (`string?
 * DayOutcome = null`). See the doctrine-P4 comment on `DailyLog.DayOutcome`
 * (`ShramSafal.Domain/Logs/DailyLog.cs:792-811`): NULL on every ordinary
 * work day, never inferred, never defaulted to `"WORK_RECORDED"` — "he did
 * not say" and "he said work happened" are different facts.
 *
 * UNLIKE `DailyLogDto.labour`, a present-but-`null` value on that field is
 * NOT "the caller made no statement" — `DtoMappingExtensions.ToDto` reads it
 * straight off the loaded entity on every endpoint that returns a
 * `DailyLogDto`, so `null` IS the farmer's state whenever the field is
 * present. Absence of the KEY (`undefined`) is the one genuinely silent
 * case, reachable only from a server build that predates the member — the
 * twin is hand-maintained and a device can outlive the server build it
 * talks to. `logsReconciler.serverStatedDayOutcome` reads exactly that
 * presence, mirroring `serverStatedContext`.
 */
export type DayOutcomeDto =
    | 'WORK_RECORDED'
    | 'DISTURBANCE_RECORDED'
    | 'NO_WORK_PLANNED'
    | 'IRRELEVANT_INPUT';

/**
 * Labour V2 R1 Task 3.5c — one server-acknowledged attendance ruling on the
 * pull wire. dayMark/nightMark are enum NAMES; null = Unmarked ("nobody
 * said" survives the wire — never a zero). workDate is the farmer's day
 * (YYYY-MM-DD), not a timestamp.
 */
export interface AttendanceMarkDto {
    id: string;
    farmId: string;
    fieldOperatorId: string;
    workDate: string;
    dayMark: string | null;
    nightMark: string | null;
    hoursWorked: number | null;
    extraHours: number | null;
    hoursBasis: string | null;
    recordedByUserId: string;
    recordedAtUtc: string;
    modifiedAtUtc: string;
}
