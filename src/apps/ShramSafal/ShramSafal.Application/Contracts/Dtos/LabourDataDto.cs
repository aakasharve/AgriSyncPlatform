namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Labour Management read-model contract. Mirrors the frontend `LabourData`
/// shape (src/clients/mobile-web/src/features/labour/labourMock.ts) field-for-field
/// so the same labour numbers render identically across the log, reflect,
/// finance, and labour-management surfaces.
/// </summary>
public sealed record LabourDataDto(
    IReadOnlyList<string> TopLevelIds,
    IReadOnlyList<LabourPersonDto> People,
    LabourDashboardDto Dashboard,
    LabourLedgerDto Ledger,
    IReadOnlyList<LabourReviewItemDto> Review,
    LabourAttendanceDraftDto Attendance);

public sealed record LabourPersonDto(
    string Id,
    string Name,
    string Initial,
    string Tone,
    string Role,
    bool Verified,
    bool Temporary,
    string? TaskScope,
    string? AppointedById,
    // Option-3 wage-book (spec: 2026-07-13-labour-attendance-approval-design):
    // three DISTINCT numbers, never merged. RecordedWages (काम झालं) = sum of
    // JobCard.EstimatedTotal for Completed/VerifiedForPayout/PaidOut cards —
    // the plan/agreed value. Paid (दिलं, per-person) = this worker's
    // labour_payout CostEntry slice (job-card attributed only — labour_misc
    // has no JobCard link, so it can never attribute to a specific person).
    // The SAME rows/method the finance page reads (money-consistency
    // invariant — see GetLabourDataHandler), but Dashboard.Money.Paid (the
    // farm-wide दिलं, Decision 3a 2026-07-19) additionally includes
    // unattributable labour_misc spend that no single person's Paid carries.
    // Advance (उचल) = 0 until Stage 4 (LabourAdvance). Owed/बाकी =
    // RecordedWages − Paid − Advance is DERIVED by the client/handler, never
    // stored here (no stale copy).
    //
    // Task 1 (spec: 2026-08-28-labour-v2-release-1, P4) — RecordedWages is
    // `decimal?`: `null` means this worker has ZERO Completed/VerifiedForPayout/
    // PaidOut job cards, i.e. no evidence, not evidence of zero. Production
    // holds zero job cards farm-wide today, so treating that absence as `0m`
    // made a farmer who was genuinely paid look "overpaid" against nothing.
    // Never derive Owed/बाकी from a null RecordedWages — the balance must be
    // absent too, not zero, not negative.
    decimal? RecordedWages,
    decimal Paid,
    decimal Advance,
    string? TodayStatus,
    int? DaysThisWeek,
    IReadOnlyList<string>? MemberIds,
    int? Trust,
    string? Access,
    int? DaysActive,
    bool? CleanRecord);

/// <summary>
/// Task 9 (spec: 2026-08-28-labour-v2-release-1) — FOUR of these figures move
/// with <c>GetLabourDataQuery.Window</c> (<c>ManDays</c>, <c>Wages</c>,
/// <c>Owed</c>/<c>Money</c>, <c>Logs</c>); <c>Pending</c> deliberately does
/// NOT. It is an approval inbox, not a statistic — a time filter must never
/// hide work still waiting on the owner (founder ruling). Every mention of
/// "this week" below therefore reads as "the window in force", whose default
/// is आजपर्यंत (all time).
/// </summary>
public sealed record LabourDashboardDto(
    // The window's START date as a bare ISO date, or empty when the window is
    // unbounded. Still named for a week and no longer only a week's — renaming
    // it is a client-visible contract change, deferred. The client suppresses
    // any label that is not a readable range, so neither form is ever shown.
    string WeekLabel,
    string Insight,
    // Task 6 (spec: 2026-08-28-labour-v2-release-1, P4) — `decimal?`, not `int`.
    // `null` when labour WAS logged this week but no assignment in it ever
    // stated a headcount (LabourHeadcount.Resolve returns null for every one
    // of them) — an ABSENCE of evidence, never a fabricated 0 मजूर-दिवस. A week
    // with real evidence for at least one assignment sums only the known ones
    // (an unstated assignment contributes NOTHING, not 0); a week with no
    // assignments logged at all is the one genuine `0m` case. `decimal` (not
    // `int`) because this same value backs `LabourLedgerDto.WeekTotal` below
    // — see that member's doc for why the two totals share a representation.
    decimal? ManDays,
    int ManDaysTrend,
    decimal Wages,
    decimal Advances,
    // Task 1 — `null` when zero job-card evidence exists farm-wide (see
    // LabourMoneyDto.Owed below); never a fabricated ₹0 or a balance derived
    // from one. Task 9 — "farm-wide" now means "inside the window", and every
    // term of the subtraction is scoped to that same window.
    decimal? Owed,
    // Task 9 — the number of daily logs INSIDE the window. A genuine `0` when
    // there are none: this is a count of records, not a quantity estimated from
    // them, so the absence of a row IS the answer.
    int Logs,
    // Task 9 — NOT window-scoped, by founder ruling. Always the full count of
    // logs awaiting this caller's approval.
    int Pending,
    IReadOnlyList<LabourPlotBarDto> Plots,
    LabourMoneyDto Money);

public sealed record LabourPlotBarDto(
    string Name,
    int Days,
    int Pct);

/// <summary>
/// Task 1 (P4) — <c>Recorded</c> is `null` when the farm has ZERO
/// Completed/VerifiedForPayout/PaidOut job cards anywhere (absence of
/// evidence, not evidence of zero). <c>Owed</c> is DERIVED from
/// <c>Recorded</c>, so it is `null` under the exact same condition — never a
/// balance computed against an unknown.
/// </summary>
public sealed record LabourMoneyDto(
    decimal? Recorded,
    decimal Paid,
    decimal Advance,
    decimal? Owed);

/// <summary>
/// Task 6 (spec: 2026-08-28-labour-v2-release-1, P4, D9.9 — supersedes D4) —
/// <c>DailyTotals</c> and <c>WeekTotal</c> were <c>int</c>, which cannot hold a
/// half day (0.5). Half a day is 0.5 day of EVIDENCE, never half a wage — no
/// money is derived from it, that is Release 2.
///
/// <para><c>WeekTotal</c> is `decimal?`, not plain `decimal`: `GetLabourDataHandler`
/// currently derives it from the SAME interim value as `LabourDashboardDto.ManDays`
/// (`Rows` stays `[]` until the Stage 5 per-worker ledger lands, so there is no
/// real per-worker total to roll up yet). That value can legitimately be
/// unknown (Task 6 Defect B), so `WeekTotal` inherits both constraints at
/// once — decimal for the half-day fix, nullable for the unknown-headcount
/// fix. Once Stage 5 lands and `WeekTotal` becomes a true sum of `Rows[].Total`
/// (always a real, non-null decimal — an unmarked day contributes 0, it does
/// not make the row's own total unknown), this nullability will no longer be
/// reachable, but removing it is that future task's call, not this one's.</para>
/// </summary>
public sealed record LabourLedgerDto(
    string WeekLabel,
    IReadOnlyList<string> Days,
    IReadOnlyList<LabourLedgerRowDto> Rows,
    IReadOnlyList<decimal> DailyTotals,
    decimal? WeekTotal);

/// <summary>
/// <c>Cells</c> are one slot per ledger day, each <c>"present"|"half"|"absent"</c>
/// or <c>null</c>. Task 5 (spec: 2026-08-28-labour-v2-release-1, P4, founder
/// Global Constraint 6) — a slot must exist for every day even before the
/// farmer has said anything about it (a day not yet reached, or simply not
/// marked yet), so `null` here means "no fact for this day", never a real
/// absence. `GetLabourDataHandler` returns `Rows: []` unconditionally today
/// (Stage 5 attendance ledger not built), so this is a forward-looking
/// contract fix, not a live repair.
/// </summary>
public sealed record LabourLedgerRowDto(
    string PersonId,
    string Name,
    string Initial,
    string Tone,
    IReadOnlyList<string?> Cells,
    // Task 6 (spec: 2026-08-28-labour-v2-release-1, P4, D9.9) — `decimal`, not
    // `int`: a half day (`"half"` in Cells) is worth 0.5, and an `int` Total
    // could only round that up to a fabricated whole day. Never `null` — a
    // day with no fact yet (`null` in Cells) contributes 0 to this sum without
    // making the ROW's own total unknown; see `LabourLedgerDto.WeekTotal`
    // above for the one member of this DTO that IS nullable, and why.
    decimal Total);

/// <summary>
/// <c>Status</c> is the log's real <see cref="ShramSafal.Domain.Logs.VerificationStatus"/>
/// (`ToString()` — "Draft"/"Confirmed"/"Verified"/"Disputed"/"CorrectionPending").
/// The client needs this to know which <c>verify_log</c> transition(s) to
/// send: <c>VerificationStateMachine</c> forbids a one-hop Draft→Verified/
/// Disputed, so a Draft item requires Draft→Confirmed first, then
/// Confirmed→{Verified|Disputed} (spec: 2026-07-13-labour-attendance-approval-design, Stage 3).
/// </summary>
public sealed record LabourReviewItemDto(
    string Id,
    string Who,
    string Initial,
    string Tone,
    string Detail,
    string Status,
    LabourPointsDto Points);

public sealed record LabourPointsDto(
    int? Count,
    string? Shift,
    string? Task,
    decimal? Amount,
    IReadOnlyList<string> Names);

public sealed record LabourAttendanceDraftDto(
    string Plot,
    int Headcount,
    IReadOnlyList<LabourAttendanceRowDto> Rows);

/// <summary>
/// `Status` is `"present"|"half"|"absent"` — never null. Task 5 (founder
/// Global Constraint 6) — a row is created ONLY by a deliberate tap; an
/// untouched worker has no row at all in `Rows` below, so "not yet said" is
/// structural (array absence), not a nullable status on a row that exists
/// regardless.
/// </summary>
public sealed record LabourAttendanceRowDto(
    string PersonId,
    string Status);
