/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Management — mock/in-memory data for the local UAT shell.
 *
 * This module is the DATA CONTRACT for the Labour feature. Screens read it via
 * `useLabourState()`. It is intentionally isolated so the real backend can swap
 * in later (a `data/labourClient.ts`) with no change to the screens.
 * Frontend-only: no backend, no persistence. All amounts/dates are illustrative.
 */

import type { LabourEntry } from './labourParse';

export type PresenceStatus = 'present' | 'half' | 'absent';
export type LabourRole = 'mukadam' | 'submukadam' | 'worker';
export type AvatarTone = 'or' | 'em' | 'bl' | 'vi' | 'rs' | 'am';

export interface LabourBalance {
    /** उचल — advance money given out. */
    advance: number;
    /** मजुरी कमावली — wages earned so far. */
    earned: number;
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
    money: { paid: number; advance: number; owed: number };
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

/** net = earned − advance. owe=true → owner owes worker (देय, green); false → advance outstanding (उचल, amber). */
export const netBalance = (b: LabourBalance): { owe: boolean; amount: number } => {
    const net = b.earned - b.advance;
    return net >= 0 ? { owe: true, amount: net } : { owe: false, amount: -net };
};

export const inr = (n: number): string => '₹' + n.toLocaleString('en-IN');

const P = (p: LabourPerson): LabourPerson => p;

const PEOPLE: Record<string, LabourPerson> = {
    rokade: P({
        id: 'rokade', name: 'रोकडे', initial: 'रो', tone: 'vi', role: 'mukadam', verified: true,
        balance: { advance: 10000, earned: 6500 }, memberIds: ['dhanaji', 'ramesh', 'sunita'],
    }),
    dhanaji: P({
        id: 'dhanaji', name: 'धनाजी', initial: 'ध', tone: 'bl', role: 'submukadam', verified: true,
        temporary: true, taskScope: 'छाटणी', appointedById: 'rokade',
        balance: { advance: 3000, earned: 1800 }, memberIds: ['vilas', 'sandip'],
    }),
    ramesh: P({
        id: 'ramesh', name: 'रमेश', initial: 'र', tone: 'or', role: 'worker', verified: true,
        balance: { advance: 2000, earned: 4200 }, todayStatus: 'present', daysThisWeek: 6, trust: 82,
        access: 'review', daysActive: 27, cleanRecord: true,
    }),
    sunita: P({
        id: 'sunita', name: 'सुनीता', initial: 'सु', tone: 'em', role: 'worker', verified: true,
        balance: { advance: 0, earned: 1500 }, todayStatus: 'present', daysThisWeek: 5, trust: 76,
        access: 'trusted', daysActive: 40, cleanRecord: true,
    }),
    vilas: P({
        id: 'vilas', name: 'विलास जाधव', initial: 'वि', tone: 'rs', role: 'worker', verified: false,
        temporary: true, appointedById: 'dhanaji',
        balance: { advance: 500, earned: 0 }, todayStatus: 'half', daysThisWeek: 4,
        access: 'review', daysActive: 4, cleanRecord: false,
    }),
    sandip: P({
        id: 'sandip', name: 'संदीप', initial: 'सं', tone: 'am', role: 'worker', verified: false,
        appointedById: 'dhanaji',
        balance: { advance: 0, earned: 800 }, todayStatus: 'present', daysThisWeek: 7,
    }),
};

const p = (s: PresenceStatus) => s;

export const LABOUR_MOCK: LabourData = {
    topLevelIds: ['rokade', 'ramesh', 'sunita', 'vilas'],
    people: PEOPLE,
    dashboard: {
        weekLabel: '७–१३ जुलै',
        insight: 'छान आठवडा! २८ मजूर-दिवस काम झालं. ३ नोंदी तपासायच्या आहेत.',
        manDays: 28, manDaysTrend: 4,
        wages: 8400, advances: 3000, owed: 5400, logs: 12, pending: 3,
        plots: [
            { name: 'द्राक्ष-२', days: 18, pct: 82 },
            { name: 'केळी-१', days: 7, pct: 34 },
            { name: 'द्राक्ष-१', days: 3, pct: 15 },
        ],
        money: { paid: 8400, advance: 3000, owed: 5400 },
    },
    ledger: {
        weekLabel: '७–१३ जुलै',
        days: ['सो', 'मं', 'बु', 'गु', 'शु', 'श', 'र'],
        rows: [
            { personId: 'ramesh', name: 'रमेश', initial: 'र', tone: 'or', cells: [p('present'), p('present'), p('half'), p('present'), p('present'), p('present'), p('absent')], total: 6 },
            { personId: 'sunita', name: 'सुनीता', initial: 'सु', tone: 'em', cells: [p('present'), p('present'), p('present'), p('present'), p('present'), p('absent'), p('absent')], total: 5 },
            { personId: 'vilas', name: 'विलास', initial: 'वि', tone: 'rs', cells: [p('absent'), p('half'), p('present'), p('present'), p('half'), p('absent'), p('absent')], total: 4 },
            { personId: 'sandip', name: 'संदीप', initial: 'सं', tone: 'am', cells: [p('present'), p('present'), p('present'), p('present'), p('present'), p('present'), p('present')], total: 7 },
        ],
        dailyTotals: [3, 4, 4, 4, 4, 2, 1],
        weekTotal: 28,
    },
    review: [
        { id: 'r1', who: 'रमेश', initial: 'र', tone: 'or', detail: 'द्राक्ष-२ · आज', points: { count: 4, shift: 'full', task: 'फवारणी', names: ['रमेश'] } },
        { id: 'r2', who: 'धनाजी (मुकादम)', initial: 'ध', tone: 'bl', detail: 'छाटणी टीम · आज', points: { count: 4, shift: 'full', task: 'छाटणी' } },
        { id: 'r3', who: 'रोकडे', initial: 'रो', tone: 'vi', detail: 'शेतात होता ✓ · आज', points: { count: 1, shift: 'night', amount: 200 } },
    ],
    attendance: {
        plot: 'द्राक्ष-२',
        headcount: 4,
        rows: [
            { personId: 'ramesh', status: 'present' },
            { personId: 'vilas', status: 'half' },
        ],
    },
};
