/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Management — the DATA CONTRACT types for the feature (Task 1.4,
 * spec: 2026-07-13-labour-attendance-approval-design). Extracted out of
 * `labourMock.ts` so `data/labourClient.ts` can import the types without
 * pulling in the mock dataset. `labourMock.ts` re-exports everything here so
 * no existing screen import breaks.
 *
 * Money model — OPTION-3 WAGE-BOOK (binding): every person carries three
 * DISTINCT numbers, never merged into one "earned":
 *   - recorded (काम झालं)  — the agreed/planned wage value of completed work.
 *   - paid     (दिलं)      — what has actually been paid out (finance-consistent).
 *   - advance  (उचल)       — advance money given out, ahead of work.
 * बाकी (owed) is always DERIVED as recorded − paid − advance (see `netBalance`
 * below) — never stored, never re-computed from anything but these three.
 *
 * Task 1 (spec: 2026-08-28-labour-v2-release-1, P4) — `recorded` is
 * `number | null`. `null` means the server has ZERO job-card evidence for
 * this figure (production holds zero job cards today), which is an ABSENCE
 * of evidence, not evidence of zero. Never treat `null` as `0` here or in any
 * consumer: `netBalance` returns `null` (unknown) rather than deriving a
 * balance against it, and every render site shows `—`/omits the balance line
 * instead of a fabricated ₹0 or a fabricated overpayment.
 *
 * Task 5 (P4, founder Global Constraint 6) — `PresenceStatus` carries exactly
 * the three farmer-tappable facts, on purpose: no fourth "unknown" button.
 * "Not yet said" is `null` wherever a slot exists per day (`LedgerRow.cells`)
 * and structural absence wherever a mark is optional
 * (`LabourData.attendance.rows`). Same house rule as `recorded` above: `null`
 * is never defaulted/coerced to a real value by any reader.
 */

import type { LabourEntry } from './labourParse';

/**
 * Task 5 (spec: 2026-08-28-labour-v2-release-1, founder Global Constraint 6)
 * — exactly the three farmer-tappable facts. There is deliberately NO fourth
 * value here for "not yet said": the farmer never sees a fourth button.
 * "Not yet said" is represented STRUCTURALLY wherever a fact must exist per
 * slot (see `LedgerRow.cells` below) — as `null`, never as a member of this
 * union — and structurally by ABSENCE wherever a fact is optional (see
 * `LabourData.attendance.rows`: an unmarked person simply has no row).
 * `null` is never defaulted to `'absent'` by any reader of either shape.
 * The LEDGER no longer uses this union — a register cell is the five-axis
 * `LedgerCell` below (master review D4).
 */
export type PresenceStatus = 'present' | 'half' | 'absent';
export type LabourRole = 'mukadam' | 'submukadam' | 'worker';
export type AvatarTone = 'or' | 'em' | 'bl' | 'vi' | 'rs' | 'am';

/**
 * Phase 4 (master review 2026-09-02, D4) — one register cell, five approved
 * axes, ALL stated facts: day half, night half (◾ रात्र), stated hours (Nत),
 * stated extra hours (+N जादा), and the उक्ते engagement marker. `null` on an
 * axis = nobody said. A `null` CELL (see `LedgerRow.cells`) = no mark at all
 * that day — रिकामं = कुणी माहिती नाही, drawn dashed, never as `–` absence.
 * Nothing here is ever summed, ranked, or converted into a day fraction.
 */
export interface LedgerCell {
    day: 'full' | 'half' | 'absent' | null;
    night: 'worked' | 'notworked' | null;
    hours: number | null;
    extraHours: number | null;
    ukte: boolean;
    /** Tap-detail work context (e.g. 'द्राक्ष छाटणी'). The GRID never renders it. */
    work: string | null;
}

/** A crew engaged through a Labour Mukadam — per-day STATED counts, null = unknown (blank violet cell). */
export interface LedgerCrewRow {
    throughFieldOperatorId: string;
    throughName: string;
    counts: (number | null)[];
}

/** D-H8 — which projection the server sent. The client renders what arrives; it never adds back. */
export type LabourView = 'owner' | 'crew' | 'own';

/**
 * A person's settlement POSITION — R15 (Task 13, spec:
 * 2026-08-28-labour-v2-release-1). All three members are ALL-TIME and never
 * follow the आढावा time window, because `netBalance` subtracts them to state
 * this worker's बाकी/देय and a balance is true as of now, not "of this
 * window". Presented windowed, a man still owed ₹8,000 read as owed nothing
 * under आज — the same defect the farm-wide money card carried, one level
 * down. The server sends them all-time (`LabourPersonDto`); nothing here
 * re-scopes them.
 */
export interface LabourBalance {
    /** काम झालं — recorded/agreed wage value of completed work, all-time. `null` = unknown (no job-card evidence yet). */
    recorded: number | null;
    /** दिलं — actually paid out so far, all-time (finance-consistent). `null` = withheld by view (D-H8) — never coalesce to 0. */
    paid: number | null;
    /** उचल — advance money given out. Always 0 from the server (no advance system exists). `null` = withheld by view (D-H8) — never coalesce to 0. */
    advance: number | null;
}

export interface LabourPerson {
    id: string;
    name: string;
    initial: string;
    tone: AvatarTone;
    role: LabourRole;
    /** app-member worker (Verified) vs a name-only worker. */
    verified: boolean;
    temporary?: boolean;
    /** e.g. 'छाटणी' — a task-scoped (sub-)mukadam. */
    taskScope?: string;
    /** who appointed this (sub-)mukadam — a person id. */
    appointedById?: string;
    balance: LabourBalance;
    todayStatus?: PresenceStatus;
    daysThisWeek?: number;
    /** for a mukadam: the people they manage. */
    memberIds?: string[];
    /** trust score 0..100 (worker). */
    trust?: number;
    /**
     * Access/approval state (the finalized trust-graduation).
     * 'review'  — their logs need the owner's approval (default).
     * 'trusted' — owner has granted full access; their own logs auto-accept.
     */
    access?: 'review' | 'trusted';
    /** days active on the farm (from granted_at). Graduation is recommended at ~25. */
    daysActive?: number;
    /** clean record (few/no disputes) — the second half of the recommendation. */
    cleanRecord?: boolean;
}

export interface LedgerRow {
    /** Prefixed grouping key ("op:{32-hex}") — never a bare user id. */
    personId: string;
    /** The durable work identity — tap-detail addresses a person-day by it. */
    fieldOperatorId: string;
    name: string;
    initial: string;
    tone: AvatarTone;
    /**
     * Task 5 (P4) — one slot per ledger day, so a slot MUST exist even before
     * the farmer has said anything about that day (a day not yet reached, or
     * simply not marked yet). `null` = no fact for that day; it is NEVER a
     * real absence and must never render or count identically to a
     * deliberate `'absent'` tap. See `HajeriLedger.tsx`'s `cellDayClass` /
     * `cellDayGlyph`, which give `null` its own neutral, visually-distinct
     * rendering.
     */
    cells: (LedgerCell | null)[];
    /**
     * Phase 4 — `total` was DELETED (master review D4: no totals column at
     * all; day-count reads live in tap-detail). `cells` slots stay per-day;
     * a `null` slot is silence, never absence — unchanged rule.
     */
}

/**
 * Mirrors `ShramSafal.Domain.Logs.VerificationStatus.ToString()` exactly
 * (spec: 2026-07-13-labour-attendance-approval-design, Task 3.1). Drives
 * which `verify_log` transition(s) मंजूर/शंका must send:
 * `VerificationStateMachine` forbids a one-hop Draft→Verified/Disputed, so
 * a `'Draft'` item needs a Draft→Confirmed step before Confirmed→
 * {Verified|Disputed}; a `'Confirmed'` item reaches either target directly.
 */
export type ReviewVerificationStatus = 'Draft' | 'Confirmed' | 'Verified' | 'Disputed' | 'CorrectionPending';

export interface ReviewItem {
    id: string;
    who: string;
    initial: string;
    tone: AvatarTone;
    detail: string;
    /** The log's current server-side verification status — see `ReviewVerificationStatus`. */
    status: ReviewVerificationStatus;
    /** The canonical labour data points (shown consistently everywhere). */
    points: Partial<LabourEntry>;
    /**
     * Task 20 (spec: 2026-08-28-labour-v2-release-1) — WHERE the work happened.
     * A log-level fact, so it sits beside `points` rather than inside it:
     * `points` is `Partial<LabourEntry>`, the shape the VOICE PARSER produces,
     * and a plot is not something the labour parse ever states.
     *
     * `plot` is the named plot (or several, joined) and `plotScope` is the
     * farmer's own spatial assertion. Two fields, because "he said संपूर्ण शेत"
     * and "we cannot name the plot" are different facts and the card must not
     * render them the same way: the first is stated, the second is an em-dash.
     * Both optional — `LABOUR_MOCK`/preview fixtures predate them.
     */
    plot?: string | null;
    plotScope?: DailyLogScopeWire;
}

/** `ShramSafal.Domain.Logs.DailyLogScope.ToString()` — the wire spelling, PascalCase. */
export type DailyLogScopeWire = 'Plot' | 'MultiPlot' | 'Farm';

export interface PlotBar { name: string; days: number; pct: number }

export interface DashboardData {
    weekLabel: string;
    /**
     * The window boundaries the server actually filtered on, ISO or empty.
     * Optional so preview/mock fixtures need not carry them; absent means
     * the dashboard shows no date range, never a guessed one.
     */
    windowFrom?: string;
    windowTo?: string;
    insight: string;
    /**
     * Task 6 (spec: 2026-08-28-labour-v2-release-1, P4) — `null` when labour
     * WAS logged this week but no log in it ever stated a headcount (never
     * a fabricated `0` मजूर-दिवस). A week with real evidence for at least one
     * log sums only the known ones; a week with nothing logged at all is the
     * one genuine `0`. Render `—`, never `String(null)` (`"null"`).
     */
    manDays: number | null;
    manDaysTrend: number;
    /** `null` = withheld by view (D-H8) — never coalesce to 0. */
    wages: number | null;
    /** `null` = withheld by view (D-H8) — never coalesce to 0. */
    advances: number | null;
    /** Task 1 (P4) — `null` when the farm carries zero job-card evidence; never a fabricated ₹0 balance. */
    owed: number | null;
    logs: number;
    pending: number;
    plots: PlotBar[];
    /**
     * THE MONEY CARD — Option-3 wage-book split, `recorded = paid + advance +
     * owed` (server-derived, never re-computed here). Task 1 (P4) —
     * `recorded` and `owed` are `null` under the exact same
     * zero-job-card-evidence condition as `LabourBalance.recorded` above, and
     * they are null together.
     *
     * R15 (Task 13) — ALL FOUR are ALL-TIME and none follows the time window,
     * unlike `manDays`/`wages`/`logs` above. `WeeklyDashboard` draws them as
     * ONE stacked bar under a header of `recorded`, so they are the four terms
     * of one identity: split across two time bases (Task 9 windowed
     * `recorded`/`paid` while R13 made `owed` all-time) the segments stopped
     * being parts of the header, and under आज the bar drew ₹100 + ₹13,500
     * inside ₹1,000. `wages` above is the windowed "money that moved in this
     * period" figure, and deliberately the only one.
     */
    /**
     * Phase 4 (D-H8) — the whole card is `null` when the server WITHHELD
     * money for this view (मुकादम/worker). Withheld is not absent: render
     * `—`, never a fabricated ₹0 card.
     */
    money: { recorded: number | null; paid: number; advance: number; owed: number | null } | null;
}

/** Master review D6 — the Labour home's two money truths + आज कामावर. Never combined. */
export interface LabourHome {
    rojandariStated: number | null;
    ukteAgreed: number | null;
    onFarmToday: number | null;
    rojandariToday: number | null;
    ukteToday: number | null;
}

export interface LabourData {
    /** top-level people shown on the hub (owner's team). */
    topLevelIds: string[];
    people: Record<string, LabourPerson>;
    dashboard: DashboardData;
    /**
     * Phase 4 (master review D4) — the CLEAN register: rows of five-axis
     * cells plus crew aggregate rows. `dailyTotals`/`weekTotal` left this
     * contract with `LedgerRow.total` (no totals column of any kind);
     * day-count reads live in tap-detail.
     */
    ledger: { weekLabel: string; days: string[]; rows: LedgerRow[]; crewRows: LedgerCrewRow[] };
    /** D-H8 — the projection the server sent (owner | crew | own). Display alignment only; the SERVER strips. */
    view: LabourView;
    /** D6 — the two money truths and the आज कामावर counts; see LabourHome. */
    home: LabourHome;
    review: ReviewItem[];
    /**
     * Attendance draft for "today" (a plot's gang). Task 5 (founder Global
     * Constraint 6) — this array is the structural representation of "not
     * yet said": a row exists ONLY once a deliberate tap creates it, so an
     * untouched worker simply has no row here (never a `null`/placeholder
     * status). Do not add a `null` status to this row shape — that would
     * let a person appear "on the sheet" before any real tap, which is a
     * different (Phase 1) feature.
     */
    /**
     * STAGE 5 — `headcount` is nullable: labour today with no stated count is
     * unknown, never 0. `rows` carries ONLY deliberate present/half/absent
     * taps, so an empty list means nobody has been marked — not that everyone
     * was absent.
     */
    attendance: {
        plot: string;
        headcount: number | null;
        rows: { personId: string; status: PresenceStatus }[];
        /**
         * The engagement a mark made today attaches to. EMPTY when today has
         * none (nothing to attach to — one must be created first) and also
         * when today has more than one (two engagements is two meanings for
         * "he was here"; choosing silently would attribute a worker to work
         * nobody said he did). Both cases are the caller’s to resolve, never
         * to guess.
         */
        todaysLabourAssignmentId: string;
    };
}

/**
 * बाकी (owed) = recorded − paid − advance.
 * owe=true → owner still owes the worker (देय, green); false → the worker
 * received more (paid+advance) than recorded work covers.
 *
 * Decision 3a (2026-07-19) — the negative-net case has TWO different real
 * causes and must not be labeled the same way:
 *   - `isAdvance=true`: an actual उचल (advance, `b.advance > 0`) is driving
 *     the surplus — "उचल बाकी" (advance outstanding) is honest here.
 *   - `isAdvance=false`: दिलं widened to farm-wide labour spend (fix 1)
 *     means Paid can exceed RecordedWages with NO advance involved at all
 *     (job cards simply aren't in use yet) — calling this "उचल बाकी" would
 *     tell the farmer his worker owes an advance that was never given. The
 *     UI must present this case as an honest overpayment, not an advance.
 *
 * Task 1 (P4) — returns `null` when `b.recorded` is `null`: with no job-card
 * evidence, a balance cannot be derived at all — not owe, not overpaid, not
 * zero. Every caller must treat `null` as "omit the balance line", exactly
 * like the WeeklyDashboard overpayment stat tile.
 */
export const netBalance = (b: LabourBalance): { owe: boolean; amount: number; isAdvance: boolean } | null => {
    if (b.recorded === null || b.paid === null || b.advance === null) {
        // Unknown OR withheld-by-view (D-H8): a balance struck against an
        // absent term is a fabrication either way. Render nothing.
        return null;
    }
    const net = b.recorded - b.paid - b.advance;
    if (net >= 0) {
        return { owe: true, amount: net, isAdvance: false };
    }
    return { owe: false, amount: -net, isAdvance: b.advance > 0 };
};

export const inr = (n: number): string => '₹' + n.toLocaleString('en-IN');
