/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Domain Log Types — LABOUR.
 *
 * SPLIT OUT OF `log.types.ts`, not newly invented (LABOUR_PHASE2 Phase 3).
 * `log.types.ts` stood at 799 of the 800-line cap `scripts/check-file-sizes.mjs`
 * enforces in CI, so the labour read-back could not add a field to `LabourEvent`
 * without tripping that gate. The block moved is exactly the one this phase
 * extends — labour — and every declaration is re-exported from `log.types.ts`,
 * so no import anywhere in the app changes.
 *
 * Layer: Domain (can only import from other domain types).
 */

import type { BucketIssue, FieldProvenance, NumericFacts } from './log.types';

// =============================================================================
// LABOUR EVENTS
// =============================================================================

/**
 * LABOUR_PHASE2 Phase 3 — one person attributed to a labour engagement, read
 * back from the server's live attribution set (`AttributedOperatorDto`).
 *
 * `displayNameAtAttach` is the SNAPSHOT taken when the person was attached, NOT
 * their current name: a payout approved for "बाळू" must still read "बाळू" after
 * a rename. There is no `fullName` here because the server never snapshots one
 * onto a work row, and no count, wage or money of any kind — see
 * `LabourEvent.attributedOperators` for why that absence is load-bearing.
 */
export interface AttributedOperator {
    fieldOperatorId: string;
    displayNameAtAttach: string;
}

export interface LabourEvent {
    id: string;
    /**
     * wave-3.12, spec Ruling 5 — how sure the farmer was of each number on this row,
     * keyed by the sibling field it qualifies. A DIFFERENT axis from provenance (P8).
     */
    numbers?: NumericFacts;
    linkedActivityId?: string;
    type: 'HIRED' | 'CONTRACT' | 'SELF';
    shiftId?: string;
    maleCount?: number;
    femaleCount?: number;
    count?: number;
    wagePerPerson?: number;
    contractUnit?: 'Tree' | 'Acre' | 'Row' | 'Lump Sum';
    contractQuantity?: number;
    operatorId?: string;
    totalCost?: number;
    notes?: string;
    detectedCrop?: string;
    whoWorked?: 'OWNER' | 'OPERATOR' | 'HIRED_LABOUR' | 'UNKNOWN';
    activity?: string;
    targetPlotName?: string;

    // Track B Wave-2 (B2.4) — richer labour capture (all optional, back-compat;
    // legacy fields above retained; NO totalCost auto-derivation from rate×count).
    gender?: 'male' | 'female' | 'mixed' | 'unknown';                                  // §3.2d
    engagementType?: 'hired_daily' | 'contract_piece' | 'self' | 'exchange';          // §3.2d
    rate?: number;                                                                     // §3.2d (per the rateBasis)
    rateBasis?: 'per_person_day' | 'per_vine' | 'per_row' | 'per_acre' | 'lump_sum';   // §3.2d

    // Labour V1 Task 7 — the first REAL producer of duration. Deliberately named
    // `durationHours`, NOT `hoursWorked`: `hoursWorked` on LabourSummary is the
    // FABRICATED constant (`settings.labour.defaultHours || 8`) that Task 8
    // deletes. This one is only ever set when a farmer states it. Absent means
    // "not stated" — the server then records its own assumed default rather
    // than treating silence as a measurement.
    durationHours?: number;

    /**
     * LABOUR_PHASE2 Phase 3 — THE PROVENANCE OF `durationHours`, and the reason
     * that field can be trusted (doctrine P8: hours alone are a lie; hours plus
     * their basis are a record).
     *
     * 'Explicit' — the farmer stated the hours. 'Assumed' — the SERVER filled
     * them in from its own default, and the farmer said nothing about time.
     *
     * Absent means no server statement, which is every locally-created event:
     * `durationHours` on this device has only ever been written from something
     * the farmer typed or spoke, so absence of a basis and presence of hours
     * already reads as Explicit there.
     *
     * THE ONE RULE FOR ANY CODE THAT WRITES THIS PAIR: an ASSUMED duration must
     * never be copied into `durationHours`. `durationHours` is read all over
     * this app as "what the farmer said" — `buildLabourPayloads` forwards it to
     * the server as an Explicit time, `buildLabourCorrections` treats a change
     * in it as a farmer correction, and `DetailSheet` pre-selects the matching
     * hour chip — and none of those readers consult this field. Putting the
     * server's assumed 8 there would resurrect exactly the constant-dressed-up-
     * as-a-measurement that Labour V1 Task 8.4 deleted from `LabourHub` and
     * `DailyWorkSummaryView` (`settings.labour.defaultHours || 8`), only this
     * time inside the canonical record instead of the view. So the read-back
     * carries the basis ALWAYS and the hours ONLY when the basis is 'Explicit'.
     */
    timeBasis?: 'Explicit' | 'Assumed';

    /**
     * LABOUR_PHASE2 Phase 3 — worker names AS STATED, free text, read back from
     * the server (`LabourEngagementDto.workerNames`).
     *
     * NOT attribution: these names resolve to no identity and carry no id.
     * `attributedOperators` below is the identified overlay. An EMPTY list is a
     * complete record (P9) — the farmer named nobody — not a gap to fill, and
     * it is never a headcount: "रमेश आणि सीता" alongside `count: 8` means eight
     * people worked, two of whom were named.
     */
    workerNames?: string[];

    /**
     * LABOUR_PHASE2 Phase 3 — the LIVE attribution set: who is attributed to
     * this engagement right now, after every correction.
     *
     * DOCTRINE P7, AND IT IS THE INVARIANT THIS FEATURE BREAKS MOST OFTEN:
     * attaching a person NEVER changes the reported quantity. This list's
     * length is not a headcount and must never be summed, counted or compared
     * against one. Eight workers with three people attributed is still eight —
     * `count` is the only headcount, and `resolveLabourHeadcount`
     * (domain/logs/labourHeadcount.ts) is the only derivation of it.
     *
     * Empty is normal and complete. Absent means no server statement.
     */
    attributedOperators?: AttributedOperator[];

    // Labour V1 Task 7 — client-minted, stable engagement id (A9). Minted once at
    // the single shared write boundary (`ensureLabourAssignmentIds`, called from
    // `LogCommandServiceImpl.confirmAndSave`) so the same engagement keeps one
    // identity across offline replay, retries and later corrections.
    labourAssignmentId?: string;

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;

    // Per-Bucket Issue (Phase 22)
    issue?: BucketIssue;

    // W1.P2 — per-field provenance (how was this value determined?)
    provenance?: FieldProvenance;

    // ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11) — see
    // CropActivityEvent.provenanceVerified for the contract. Missing = verified.
    provenanceVerified?: boolean;
}
