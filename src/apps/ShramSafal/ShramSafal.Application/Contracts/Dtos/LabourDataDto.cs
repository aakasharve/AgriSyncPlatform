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

public sealed record LabourDashboardDto(
    string WeekLabel,
    string Insight,
    int ManDays,
    int ManDaysTrend,
    decimal Wages,
    decimal Advances,
    // Task 1 — `null` when zero job-card evidence exists farm-wide (see
    // LabourMoneyDto.Owed below); never a fabricated ₹0 or a balance derived
    // from one.
    decimal? Owed,
    int Logs,
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

public sealed record LabourLedgerDto(
    string WeekLabel,
    IReadOnlyList<string> Days,
    IReadOnlyList<LabourLedgerRowDto> Rows,
    IReadOnlyList<int> DailyTotals,
    int WeekTotal);

/// <summary>`Cells` are `"present"|"half"|"absent"` strings.</summary>
public sealed record LabourLedgerRowDto(
    string PersonId,
    string Name,
    string Initial,
    string Tone,
    IReadOnlyList<string> Cells,
    int Total);

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

/// <summary>`Status` is `"present"|"half"|"absent"`.</summary>
public sealed record LabourAttendanceRowDto(
    string PersonId,
    string Status);
