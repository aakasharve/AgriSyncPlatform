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
 */

import type { LabourEntry } from './labourParse';

export type PresenceStatus = 'present' | 'half' | 'absent';
export type LabourRole = 'mukadam' | 'submukadam' | 'worker';
export type AvatarTone = 'or' | 'em' | 'bl' | 'vi' | 'rs' | 'am';

export interface LabourBalance {
    /** काम झालं — recorded/agreed wage value of completed work. */
    recorded: number;
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

export interface ReviewItem {
    id: string;
    who: string;
    initial: string;
    tone: AvatarTone;
    detail: string;
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
    owed: number;
    logs: number;
    pending: number;
    plots: PlotBar[];
    /** Option-3 wage-book split — recorded = paid + advance + owed (server-derived, never re-computed here). */
    money: { recorded: number; paid: number; advance: number; owed: number };
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
 * received more (paid+advance) than recorded work covers, i.e. उचल is
 * outstanding against future work (amber).
 */
export const netBalance = (b: LabourBalance): { owe: boolean; amount: number } => {
    const net = b.recorded - b.paid - b.advance;
    return net >= 0 ? { owe: true, amount: net } : { owe: false, amount: -net };
};

export const inr = (n: number): string => '₹' + n.toLocaleString('en-IN');
