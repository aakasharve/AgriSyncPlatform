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
 */

import type { LabourEntry } from './labourParse';

export type PresenceStatus = 'present' | 'half' | 'absent';
export type LabourRole = 'mukadam' | 'submukadam' | 'worker';
export type AvatarTone = 'or' | 'em' | 'bl' | 'vi' | 'rs' | 'am';

export interface LabourBalance {
    /** काम झालं — recorded/agreed wage value of completed work. `null` = unknown (no job-card evidence yet). */
    recorded: number | null;
    /** दिलं — actually paid out so far (finance-consistent). */
    paid: number;
    /** उचल — advance money given out. */
    advance: number;
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
    personId: string;
    name: string;
    initial: string;
    tone: AvatarTone;
    cells: PresenceStatus[];
    total: number;
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
}

export interface PlotBar { name: string; days: number; pct: number }

export interface DashboardData {
    weekLabel: string;
    insight: string;
    manDays: number;
    manDaysTrend: number;
    wages: number;
    advances: number;
    /** Task 1 (P4) — `null` when the farm carries zero job-card evidence; never a fabricated ₹0 balance. */
    owed: number | null;
    logs: number;
    pending: number;
    plots: PlotBar[];
    /**
     * Option-3 wage-book split — recorded = paid + advance + owed
     * (server-derived, never re-computed here). Task 1 (P4) — `recorded` and
     * `owed` are `null` under the exact same zero-job-card-evidence condition
     * as `LabourBalance.recorded` above.
     */
    money: { recorded: number | null; paid: number; advance: number; owed: number | null };
}

export interface LabourData {
    /** top-level people shown on the hub (owner's team). */
    topLevelIds: string[];
    people: Record<string, LabourPerson>;
    dashboard: DashboardData;
    ledger: { weekLabel: string; days: string[]; rows: LedgerRow[]; dailyTotals: number[]; weekTotal: number };
    review: ReviewItem[];
    /** attendance draft for "today" (a plot's gang). */
    attendance: { plot: string; headcount: number; rows: { personId: string; status: PresenceStatus }[] };
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
    if (b.recorded === null) {
        return null;
    }
    const net = b.recorded - b.paid - b.advance;
    if (net >= 0) {
        return { owe: true, amount: net, isAdvance: false };
    }
    return { owe: false, amount: -net, isAdvance: b.advance > 0 };
};

export const inr = (n: number): string => '₹' + n.toLocaleString('en-IN');
