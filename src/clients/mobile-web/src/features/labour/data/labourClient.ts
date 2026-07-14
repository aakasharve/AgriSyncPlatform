/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * labourClient — API client for `GET /shramsafal/farms/{farmId}/labour`
 * (Task 1.3 backend read-model: `LabourDataDto`, spec:
 * 2026-07-13-labour-attendance-approval-design).
 *
 * Mirrors `features/work/data/jobCardsClient.ts`'s `resolveBaseUrl()` /
 * `authHeaders()` pattern. Maps the wire DTO (camelCase JSON, `people` as a
 * LIST) into the frontend `LabourData` contract (`people` as a
 * `Record<id, LabourPerson>` dict) — see `useLabourState.ts` for the
 * cancellable-fetch caller.
 *
 * MONEY PASS-THROUGH (binding — Option-3 wage-book): the server has already
 * rounded every money figure to 2dp and resolved `Paid` against the same rows
 * the finance page reads. This mapper NEVER re-rounds or re-derives any of
 * `recorded` / `paid` / `advance` — every number here is copied straight from
 * the DTO.
 *
 * @module features/labour/data/labourClient
 */
import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import type {
    LabourData,
    LabourPerson,
    DashboardData,
    LedgerRow,
    ReviewItem,
    PresenceStatus,
} from '../labour.types';

// ============================================================================
// Wire DTOs — camelCase, mirror
// ShramSafal.Application.Contracts.Dtos.LabourDataDto field-for-field.
// ============================================================================

export interface LabourPersonDto {
    id: string;
    name: string;
    initial: string;
    tone: string;
    role: string;
    verified: boolean;
    temporary: boolean;
    taskScope: string | null;
    appointedById: string | null;
    recordedWages: number;
    paid: number;
    advance: number;
    todayStatus: string | null;
    daysThisWeek: number | null;
    memberIds: string[] | null;
    trust: number | null;
    access: string | null;
    daysActive: number | null;
    cleanRecord: boolean | null;
}

export interface LabourPlotBarDto {
    name: string;
    days: number;
    pct: number;
}

export interface LabourMoneyDto {
    recorded: number;
    paid: number;
    advance: number;
    owed: number;
}

export interface LabourDashboardDto {
    weekLabel: string;
    insight: string;
    manDays: number;
    manDaysTrend: number;
    wages: number;
    advances: number;
    owed: number;
    logs: number;
    pending: number;
    plots: LabourPlotBarDto[];
    money: LabourMoneyDto;
}

export interface LabourLedgerRowDto {
    personId: string;
    name: string;
    initial: string;
    tone: string;
    cells: string[];
    total: number;
}

export interface LabourLedgerDto {
    weekLabel: string;
    days: string[];
    rows: LabourLedgerRowDto[];
    dailyTotals: number[];
    weekTotal: number;
}

export interface LabourPointsDto {
    count: number | null;
    shift: string | null;
    task: string | null;
    amount: number | null;
    names: string[];
}

export interface LabourReviewItemDto {
    id: string;
    who: string;
    initial: string;
    tone: string;
    detail: string;
    points: LabourPointsDto;
}

export interface LabourAttendanceRowDto {
    personId: string;
    status: string;
}

export interface LabourAttendanceDraftDto {
    plot: string;
    headcount: number;
    rows: LabourAttendanceRowDto[];
}

export interface LabourDataDto {
    topLevelIds: string[];
    people: LabourPersonDto[];
    dashboard: LabourDashboardDto;
    ledger: LabourLedgerDto;
    review: LabourReviewItemDto[];
    attendance: LabourAttendanceDraftDto;
}

// ============================================================================
// Helpers (mirrors jobCardsClient.ts)
// ============================================================================

interface ViteImportMeta {
    env?: { VITE_AGRISYNC_API_URL?: unknown };
}

const resolveBaseUrl = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().replace(/\/+$/, '');
    }
    return 'http://localhost:5048';
};

const authHeaders = (): Record<string, string> => {
    const session = getAuthSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
    }
    return headers;
};

// ============================================================================
// DTO → LabourData mapping (NO re-rounding / re-computation of money)
// ============================================================================

const mapPerson = (p: LabourPersonDto): LabourPerson => ({
    id: p.id,
    name: p.name,
    initial: p.initial,
    tone: p.tone as LabourPerson['tone'],
    role: p.role as LabourPerson['role'],
    verified: p.verified,
    temporary: p.temporary,
    taskScope: p.taskScope ?? undefined,
    appointedById: p.appointedById ?? undefined,
    // Option-3 wage-book — straight pass-through, no re-rounding/re-derivation.
    balance: { recorded: p.recordedWages, paid: p.paid, advance: p.advance },
    todayStatus: (p.todayStatus as PresenceStatus | null) ?? undefined,
    daysThisWeek: p.daysThisWeek ?? undefined,
    memberIds: p.memberIds ?? undefined,
    trust: p.trust ?? undefined,
    access: (p.access as LabourPerson['access']) ?? undefined,
    daysActive: p.daysActive ?? undefined,
    cleanRecord: p.cleanRecord ?? undefined,
});

const mapDashboard = (d: LabourDashboardDto): DashboardData => ({
    weekLabel: d.weekLabel,
    insight: d.insight,
    manDays: d.manDays,
    manDaysTrend: d.manDaysTrend,
    wages: d.wages,
    advances: d.advances,
    owed: d.owed,
    logs: d.logs,
    pending: d.pending,
    plots: d.plots,
    money: {
        recorded: d.money.recorded,
        paid: d.money.paid,
        advance: d.money.advance,
        owed: d.money.owed,
    },
});

const mapLedgerRow = (r: LabourLedgerRowDto): LedgerRow => ({
    personId: r.personId,
    name: r.name,
    initial: r.initial,
    tone: r.tone as LedgerRow['tone'],
    cells: r.cells as PresenceStatus[],
    total: r.total,
});

const mapReview = (r: LabourReviewItemDto): ReviewItem => ({
    id: r.id,
    who: r.who,
    initial: r.initial,
    tone: r.tone as ReviewItem['tone'],
    detail: r.detail,
    points: {
        count: r.points.count ?? undefined,
        shift: (r.points.shift as ReviewItem['points']['shift']) ?? undefined,
        task: r.points.task ?? undefined,
        amount: r.points.amount ?? undefined,
        names: r.points.names,
    },
});

/**
 * Fetches the farm's Option-3 wage-book read-model and maps it into the
 * frontend `LabourData` contract. Throws on a non-OK response — callers
 * (`useLabourState`) decide the fallback behaviour.
 */
export async function fetchLabourData(farmId: string): Promise<LabourData> {
    const url = `${resolveBaseUrl()}/shramsafal/farms/${farmId}/labour`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`fetchLabourData failed: ${res.status}`);
    const dto = (await res.json()) as LabourDataDto;

    return {
        topLevelIds: dto.topLevelIds,
        people: Object.fromEntries(dto.people.map((p) => [p.id, mapPerson(p)])),
        dashboard: mapDashboard(dto.dashboard),
        ledger: {
            weekLabel: dto.ledger.weekLabel,
            days: dto.ledger.days,
            rows: dto.ledger.rows.map(mapLedgerRow),
            dailyTotals: dto.ledger.dailyTotals,
            weekTotal: dto.ledger.weekTotal,
        },
        review: dto.review.map(mapReview),
        attendance: {
            plot: dto.attendance.plot,
            headcount: dto.attendance.headcount,
            rows: dto.attendance.rows.map((r) => ({
                personId: r.personId,
                status: r.status as PresenceStatus,
            })),
        },
    };
}
