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
    LedgerCell,
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
    //
    // R15 (Task 13) — `recordedWages`/`paid` are ALL-TIME, never the window's
    // slice: they are the two terms this worker's बाकी/देय is struck from.
    //
    // Phase 4 (D-H8) — `paid`/`advance` are also nullable: `null` = WITHHELD
    // BY VIEW (मुकादम/worker projection). Never coerced to 0.
    recordedWages: number | null;
    paid: number | null;
    advance: number | null;
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
    //
    // R15 (Task 13) — all four members are ALL-TIME and satisfy
    // `recorded = paid + advance + owed`. The screen draws them as one stacked
    // bar, so they must share a time basis; see `labour.types.ts` DashboardData.
    recorded: number | null;
    paid: number;
    advance: number;
    owed: number | null;
}

export interface LabourDashboardDto {
    weekLabel: string;
    // The window boundaries the server filtered on, ISO or empty. Optional
    // on the wire so fixtures predating them still typecheck; the server
    // always sends both.
    windowFrom?: string;
    windowTo?: string;
    insight: string;
    // Task 6 (spec: 2026-08-28-labour-v2-release-1, P4) — `null` when labour
    // was logged this week but no log in it stated a headcount. Never coerced
    // to 0; passed straight through by `mapDashboard` below.
    manDays: number | null;
    manDaysTrend: number;
    // Phase 4 (D-H8) — `wages`/`advances`/`money` are nullable: `null` =
    // WITHHELD BY VIEW (मुकादम/worker projection), never coerced to 0.
    wages: number | null;
    advances: number | null;
    // Task 1 (P4) — `null` when zero job-card evidence exists farm-wide.
    owed: number | null;
    logs: number;
    pending: number;
    plots: LabourPlotBarDto[];
    money: LabourMoneyDto | null;
}

// Phase 4 (master review D4) — one register cell, the five approved axes.
// Mirrors `LabourLedgerCellDto` (backend). All STATED facts; nothing is
// summed or converted here or anywhere downstream.
export interface LedgerCellDto {
    day: string | null; night: string | null;
    hours: number | null; extraHours: number | null;
    ukte: boolean; work: string | null;
}
export interface LabourLedgerCrewRowDto {
    throughFieldOperatorId: string; throughName: string; counts: (number | null)[];
}

export interface LabourLedgerRowDto {
    personId: string;
    fieldOperatorId: string;
    name: string;
    initial: string;
    tone: string;
    // Task 5 (spec: 2026-08-28-labour-v2-release-1, P4) — one slot per ledger
    // day; `null` = no fact for that day (not yet reached / not marked),
    // never a real absence. Mirrors `LabourLedgerRowDto.Cells` (backend).
    // Phase 4 — `total` left this contract with the whole totals column
    // (master review D4).
    cells: (LedgerCellDto | null)[];
}

export interface LabourLedgerDto {
    weekLabel: string;
    days: string[];
    rows: LabourLedgerRowDto[];
    crewRows: LabourLedgerCrewRowDto[];
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
    /** Task 20 — the named plot(s), or `null` when the log named none. */
    plot: string | null;
    /** Task 20 — `ShramSafal.Domain.Logs.DailyLogScope.ToString()`: "Plot" | "MultiPlot" | "Farm". */
    plotScope: string;
}

export interface LabourAttendanceRowDto {
    personId: string;
    status: string;
}

export interface LabourAttendanceDraftDto {
    plot: string;
    // STAGE 5 — nullable, for the same reason manDays is. Labour today with
    // nobody saying HOW MANY is unknown; a 0 would tell the farmer the app
    // believes nobody came. 0 is reserved for a day with no labour at all.
    headcount: number | null;
    rows: LabourAttendanceRowDto[];
    // Optional on the wire so fixtures predating it still typecheck; the
    // server always sends it, empty when today has no single unambiguous
    // engagement to attach a mark to.
    todaysLabourAssignmentId?: string;
}

export interface LabourDataDto {
    topLevelIds: string[];
    people: LabourPersonDto[];
    dashboard: LabourDashboardDto;
    ledger: LabourLedgerDto;
    review: LabourReviewItemDto[];
    attendance: LabourAttendanceDraftDto;
    // D-H8 — which projection the server sent: "owner" | "crew" | "own".
    view: string;
    // D6 — the two money truths + आज कामावर counts. Nulls are blanks (never
    // 0); the server nulls the money members for non-owner views.
    home: { rojandariStated: number | null; ukteAgreed: number | null; onFarmToday: number | null; rojandariToday: number | null; ukteToday: number | null; };
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
    windowFrom: d.windowFrom ?? '',
    windowTo: d.windowTo ?? '',
    insight: d.insight,
    manDays: d.manDays,
    manDaysTrend: d.manDaysTrend,
    wages: d.wages,
    advances: d.advances,
    owed: d.owed,
    logs: d.logs,
    pending: d.pending,
    plots: d.plots,
    // Phase 4 (D-H8) — a `null` money card (withheld by view) passes straight
    // through; never rebuilt from zeros.
    money: d.money === null ? null : {
        recorded: d.money.recorded,
        paid: d.money.paid,
        advance: d.money.advance,
        owed: d.money.owed,
    },
});

const mapLedgerCell = (c: LedgerCellDto | null): LedgerCell | null =>
    c === null
        ? null // no mark that day — silence survives the wire untouched
        : {
            day: (c.day === 'full' || c.day === 'half' || c.day === 'absent') ? c.day : null,
            night: (c.night === 'worked' || c.night === 'notworked') ? c.night : null,
            hours: c.hours,
            extraHours: c.extraHours,
            ukte: c.ukte === true,
            work: c.work,
        };

const mapLedgerRow = (r: LabourLedgerRowDto): LedgerRow => ({
    personId: r.personId,
    fieldOperatorId: r.fieldOperatorId,
    name: r.name,
    initial: r.initial,
    tone: r.tone as LedgerRow['tone'],
    cells: r.cells.map(mapLedgerCell),
});

/**
 * Task 20 — the shift union is the ONE point field the card turns into a
 * Marathi label by key lookup (`SHIFT_LABEL[shift]`). A value outside the
 * union would index to `undefined` and render the literal string "undefined"
 * on an approval card, so an unrecognised wire value becomes "we were not
 * told" instead. This is a guard, not a translation: the server sends the
 * lower-cased union already.
 */
const SHIFT_WIRE_VALUES = ['full', 'half', 'night'] as const;

const mapShift = (raw: string | null): ReviewItem['points']['shift'] =>
    (SHIFT_WIRE_VALUES as readonly string[]).includes(raw ?? '')
        ? (raw as ReviewItem['points']['shift'])
        : undefined;

/** Task 20 — same guard, for the scope the plot slot branches on. */
const PLOT_SCOPE_WIRE_VALUES = ['Plot', 'MultiPlot', 'Farm'] as const;

const mapPlotScope = (raw: string): ReviewItem['plotScope'] =>
    (PLOT_SCOPE_WIRE_VALUES as readonly string[]).includes(raw)
        ? (raw as ReviewItem['plotScope'])
        : undefined;

const mapReview = (r: LabourReviewItemDto): ReviewItem => ({
    id: r.id,
    who: r.who,
    initial: r.initial,
    tone: r.tone as ReviewItem['tone'],
    detail: r.detail,
    status: r.status as ReviewItem['status'],
    points: {
        count: r.points.count ?? undefined,
        shift: mapShift(r.points.shift),
        task: r.points.task ?? undefined,
        amount: r.points.amount ?? undefined,
        names: r.points.names,
    },
    // Task 20 — `?? null` (not `?? undefined`): a server that predates these
    // two fields sends neither, and the card treats both the same way anyway
    // (nothing to name → em-dash). Kept as written rather than coerced.
    plot: r.plot ?? null,
    plotScope: mapPlotScope(r.plotScope),
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
 * question was asked. As of R15 (Task 13) exactly `ManDays`/`Wages`/`Logs`
 * move with it. `Pending` deliberately does NOT (`GetLabourDataHandler` §8) —
 * it is the owner's approval backlog, not a statistic about a period — and
 * neither does anything on the money card (`money.*`, `owed`) or any
 * per-person `recordedWages`/`paid`: those are settlement POSITIONS as of now,
 * so they are all-time whatever window this call asks for.
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
            crewRows: (dto.ledger.crewRows ?? []).map((c) => ({
                throughFieldOperatorId: c.throughFieldOperatorId,
                throughName: c.throughName,
                counts: c.counts,
            })),
        },
        // FAIL CLOSED (4.3 review B001, controller ruling): a wire with a
        // missing/unknown `view` — a pre-projection API during deploy skew —
        // maps to 'own', NEVER 'owner'. 'owner' is the ONLY view allowed to
        // CLAIM (the register's "अजून हजेरी नोंदवली नाही" card), and
        // defaulting to it would have a skewed client assert "nothing was
        // recorded" over rows the old server simply never shaped. Under
        // 'own' the bare grid renders — true silence — while money renders
        // from whatever fields came: the client has no projection to close;
        // the server owns that (D-H8). On the real new stack this branch
        // never runs — View is always present on the wire.
        view: dto.view === 'owner' || dto.view === 'crew' ? dto.view : 'own',
        // Old-server fallback (deploy skew): a wire without `home` renders
        // all blanks — '—', never a fabricated figure.
        home: dto.home ?? { rojandariStated: null, ukteAgreed: null, onFarmToday: null, rojandariToday: null, ukteToday: null },
        review: dto.review.map(mapReview),
        attendance: {
            plot: dto.attendance.plot,
            headcount: dto.attendance.headcount,
            todaysLabourAssignmentId: dto.attendance.todaysLabourAssignmentId ?? '',
            rows: dto.attendance.rows.map((r) => ({
                personId: r.personId,
                status: r.status as PresenceStatus,
            })),
        },
    };
}
