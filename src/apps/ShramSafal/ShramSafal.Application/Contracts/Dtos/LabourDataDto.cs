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
    // the plan/agreed value. Paid (दिलं) = the labour_payout CostEntry slice,
    // the SAME rows/method the finance page reads (money-consistency
    // invariant — see GetLabourDataHandler). Advance (उचल) = 0 until Stage 4
    // (LabourAdvance). Owed/बाकी = RecordedWages − Paid − Advance is DERIVED
    // by the client/handler, never stored here (no stale copy).
    decimal RecordedWages,
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
    decimal Owed,
    int Logs,
    int Pending,
    IReadOnlyList<LabourPlotBarDto> Plots,
    LabourMoneyDto Money);

public sealed record LabourPlotBarDto(
    string Name,
    int Days,
    int Pct);

public sealed record LabourMoneyDto(
    decimal Recorded,
    decimal Paid,
    decimal Advance,
    decimal Owed);

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
