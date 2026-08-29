/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * labourClient — API client for `GET /shramsafal/farms/{farmId}/labour`
 * (Task 1.3 backend read-model: `LabourDataDto`, spec:
 * 2026-07-13-labour-attendance-approval-design).
 *
 * TRANSPORT (binding): this goes through the app's ONE shared HTTP client,
 * `agriSyncClient.http` — the same axios instance every other backend call
 * uses. That is deliberate and load-bearing, not a style choice:
 *
 *   - Its request interceptor attaches the in-memory access token
 *     (`attachAccessToken`), so there is no second hand-rolled `authHeaders()`
 *     that can drift from the real session.
 *   - Its response interceptor (`tryRefreshAndRetry`) turns a 401 into
 *     ONE single-flight `refreshSession()` + ONE retry of the original
 *     request. A labour fetch that races a not-yet-minted access token
 *     therefore SELF-HEALS instead of stranding a semi-literate farmer on an
 *     error banner he has no way to diagnose.
 *
 * This used to be a bare `fetch()` with its own `resolveBaseUrl()` /
 * `authHeaders()` copy (mirroring `features/work/data/jobCardsClient.ts`),
 * which had no 401 recovery at all — that was BUG 1.
 *
 * Maps the wire DTO (camelCase JSON, `people` as a LIST) into the frontend
 * `LabourData` contract (`people` as a `Record<id, LabourPerson>` dict) — see
 * `useLabourState.ts` for the cancellable caller.
 *
 * MONEY PASS-THROUGH (binding — Option-3 wage-book): the server has already
 * rounded every money figure to 2dp and resolved `Paid` against the same rows
 * the finance page reads. This mapper NEVER re-rounds or re-derives any of
 * `recorded` / `paid` / `advance` — every number here is copied straight from
 * the DTO.
 *
 * @module features/labour/data/labourClient
 */
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { DEFAULT_LABOUR_WINDOW, type LabourWindow } from '../labourWindow';
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
    // Task 1 (spec: 2026-08-28-labour-v2-release-1, P4) — `null` when the
    // server has zero job-card evidence for this worker. Never coerced to 0
    // here; passed straight through by `mapPerson` below.
    recordedWages: number | null;
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
    // Task 1 (P4) — `recorded`/`owed` are `null` when zero job-card evidence
    // exists farm-wide. Never coerced to 0.
    recorded: number | null;
    paid: number;
    advance: number;
    owed: number | null;
}

export interface LabourDashboardDto {
    weekLabel: string;
    insight: string;
    // Task 6 (spec: 2026-08-28-labour-v2-release-1, P4) — `null` when labour
    // was logged this week but no log in it stated a headcount. Never coerced
    // to 0; passed straight through by `mapDashboard` below.
    manDays: number | null;
    manDaysTrend: number;
    wages: number;
    advances: number;
    // Task 1 (P4) — `null` when zero job-card evidence exists farm-wide.
    owed: number | null;
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
    // Task 5 (spec: 2026-08-28-labour-v2-release-1, P4) — one slot per ledger
    // day; `null` = no fact for that day (not yet reached / not marked),
    // never a real absence. Mirrors `LabourLedgerRowDto.Cells` (backend).
    cells: (string | null)[];
    // Task 6 (P4, D9.9) — a half day is 0.5; never `null` (an unmarked cell
    // contributes 0 to this sum without making the row's own total unknown).
    total: number;
}

export interface LabourLedgerDto {
    weekLabel: string;
    days: string[];
    rows: LabourLedgerRowDto[];
    dailyTotals: number[];
    // Task 6 (P4) — mirrors `LabourDashboardDto.manDays`'s nullability; see
    // that field and `LabourLedgerDto.WeekTotal` (backend DTO) for why.
    weekTotal: number | null;
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
    /** `ShramSafal.Domain.Logs.VerificationStatus.ToString()` — "Draft" | "Confirmed" | "Verified" | "Disputed" | "CorrectionPending". */
    status: string;
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

/**
 * The one labour read-model endpoint. Relative to `agriSyncClient.http`'s
 * `baseURL` (resolved once from `VITE_AGRISYNC_API_URL` in
 * `infrastructure/api/transport.ts`) so labour cannot point at a different
 * host from the rest of the app.
 */
export const labourDataPath = (farmId: string): string =>
    `/shramsafal/farms/${farmId}/labour`;

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
    // Task 5 (P4) — `null` (no fact for that day) passes straight through,
    // never coerced/defaulted to a real status. The previous blind
    // `as PresenceStatus[]` cast let a wire `null` silently masquerade as a
    // valid status to the type checker; mapping element-by-element keeps the
    // `| null` honest end to end.
    cells: r.cells.map((c) => c as PresenceStatus | null),
    total: r.total,
});

const mapReview = (r: LabourReviewItemDto): ReviewItem => ({
    id: r.id,
    who: r.who,
    initial: r.initial,
    tone: r.tone as ReviewItem['tone'],
    detail: r.detail,
    status: r.status as ReviewItem['status'],
    points: {
        count: r.points.count ?? undefined,
        shift: (r.points.shift as ReviewItem['points']['shift']) ?? undefined,
        task: r.points.task ?? undefined,
        amount: r.points.amount ?? undefined,
        names: r.points.names,
    },
});

/**
 * Fetches the farm's Option-3 wage-book read-model for ONE time window and
 * maps it into the frontend `LabourData` contract.
 *
 * TASK 11 (spec: 2026-08-28-labour-v2-release-1) — `window` is the adjustable
 * time window (`?window=alltime|today|week|month`, server half in `da07f668`).
 * It is ALWAYS sent, even for the all-time default, although the server treats
 * an omitted value as all-time too. The difference is not cosmetic: silence is
 * also what a client that predates the parameter sends, so an omitted window
 * says "I do not know this question exists" where a stated one says which
 * question was asked. `ManDays`/`Wages`/`Recorded`/`Logs` move with it;
 * `Pending` deliberately does NOT (`GetLabourDataHandler` §8) — it is the
 * owner's approval backlog, not a statistic about a period.
 *
 * A 401 is handled BEFORE this function's caller ever sees it: the shared
 * client refreshes the session once and replays this exact request (see the
 * TRANSPORT note at the top of this module). Anything that still fails after
 * that — server down, refresh genuinely rejected — throws, and
 * `useLabourState` turns it into the honest empty state plus a retry
 * affordance. It NEVER falls back to mock money.
 */
export async function fetchLabourData(
    farmId: string,
    window: LabourWindow = DEFAULT_LABOUR_WINDOW,
): Promise<LabourData> {
    const response = await agriSyncClient.http.get<LabourDataDto>(
        labourDataPath(farmId),
        { params: { window } },
    );
    const dto = response.data;

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
