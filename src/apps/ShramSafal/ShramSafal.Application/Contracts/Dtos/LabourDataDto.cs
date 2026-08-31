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
    // NB the money-consistency invariant is now carried by Dashboard.Wages —
    // the windowed दिलं — since R15 made Money.Paid all-time; both read the
    // identical rows and correction resolution, only the date range differs.
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
    //
    // R15 (Task 13) — RecordedWages and Paid are ALL-TIME, never windowed.
    // They are the two terms the client subtracts to state this worker's
    // बाकी/देय beside his name (`labour.types.ts` netBalance), so they are a
    // settlement POSITION for the same reason LabourMoneyDto is one, and the
    // BalanceCard that shows all three together would otherwise mix bases.
    // Task 9 windowed them; that defect was unreachable only because leaving
    // आढावा resets the window, and persisting the window would have armed it —
    // a man still owed ₹8,000 reading as owed nothing under आज.
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
/// Task 9 (spec: 2026-08-28-labour-v2-release-1), as corrected by R13 (Task
/// 10) and R15 (Task 13) — EXACTLY THREE of these figures move with
/// <c>GetLabourDataQuery.Window</c>: <c>ManDays</c>, <c>Wages</c> and
/// <c>Logs</c>. Nothing else on this record does.
///
/// <para>(The list and the count above were out of step for two releases:
/// this comment said "THREE" and then named four, having been written when
/// <c>Money.Recorded</c> was windowed and not corrected when R13 removed
/// <c>Owed</c>. Both defects this task fixes were of that family, so the rule
/// is: change the list, re-read the sentence.)</para>
///
/// <para><c>Pending</c> is an approval INBOX, not a statistic — a time filter
/// must never hide work still waiting on the owner.</para>
///
/// <para>Every member of <see cref="LabourMoneyDto"/> — <c>Recorded</c>,
/// <c>Paid</c>, <c>Advance</c>, <c>Owed</c> — and <c>Owed</c> here is a
/// POSITION as of now (R15). They are the four terms of ONE identity the
/// client draws as a single stacked bar (काम झालं = दिलं + उचल + बाकी), so
/// they must share one time basis or the bar's segments stop being parts of
/// its header. A time filter must also never make a farmer who still owes
/// money see a smaller figure, or ₹0, just because he is looking at आज
/// (R13).</para>
///
/// <para>Every mention of "this week" below therefore reads as "the window in
/// force", whose default is आजपर्यंत (all time), and applies ONLY to the three
/// figures named above.</para>
/// </summary>
public sealed record LabourDashboardDto(
    // The window's START date as a bare ISO date, or empty when the window is
    // unbounded. Still named for a week and no longer only a week's — renaming
    // it is a client-visible contract change, deferred. The client suppresses
    // any label that is not a readable range, so neither form is ever shown.
    string WeekLabel,
    // The window boundaries the server ACTUALLY filtered on, as bare ISO
    // dates, or empty when that end is unbounded (आजपर्यंत has neither).
    // The client formats these into the Marathi range shown above the
    // figures. They are emitted here rather than computed on the client
    // from its own selection, so the range a farmer reads can never
    // disagree with the numbers it sits above.
    string WindowFrom,
    string WindowTo,
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
    // Task 1 — `null` when zero job-card evidence exists farm-wide, ALL TIME
    // (see LabourMoneyDto.Owed below); never a fabricated ₹0 or a balance
    // derived from one. R13 (Task 10, corrects Task 9) — this is an
    // outstanding BALANCE, not a flow: unlike ManDays/Wages/Logs, it does NOT
    // move with the window. Every term of its subtraction is ALL-TIME,
    // regardless of which window the caller requested. Always identical to
    // Money.Owed below — one computation, reported twice.
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
/// THE MONEY CARD — R15 (ruling, Task 13, spec: 2026-08-28-labour-v2-release-1).
/// All four members are ALL-TIME, and the record satisfies
/// <c>Recorded = Paid + Advance + Owed</c> BY CONSTRUCTION.
///
/// <para>That identity is not decoration: the client draws this record as ONE
/// stacked bar under a header of <c>Recorded</c> — काम झालं = दिलं + उचल +
/// बाकी. Task 9 windowed <c>Recorded</c>/<c>Paid</c> as "flows" while R13
/// (correctly) made <c>Owed</c> an all-time balance, which left the four terms
/// of one identity on two different time bases: the bar's segments were no
/// longer parts of its header, and on the release fixture under आज it drew
/// ₹100 + ₹13,500 inside a header of ₹1,000. Every figure here exists to
/// explain ONE settlement position — what the farmer has recorded, paid,
/// advanced and still owes TO DATE — so they share one basis. The windowed
/// "money that moved in this period" figure is
/// <see cref="LabourDashboardDto.Wages"/>, and it is deliberately the only
/// one.</para>
///
/// <para>Task 1 (P4) — <c>Recorded</c> and <c>Owed</c> are both `null` exactly
/// when the farm has ZERO Completed/VerifiedForPayout/PaidOut job cards ALL
/// TIME (absence of evidence, not evidence of zero); never a fabricated ₹0,
/// and never a balance computed against an unknown. They are null together,
/// never one without the other.</para>
///
/// <para>If a windowed काम झालं is ever needed again, it must be a NEW field
/// with its own label — never these, and never one of these without the other
/// three.</para>
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
    LabourPointsDto Points,

    // ── Task 20 (spec: 2026-08-28-labour-v2-release-1) — WHERE the work
    //    happened. Two members, not one, because "no plot was named" and "a
    //    plot was named and we could not resolve it" are different facts and
    //    the card renders them differently (संपूर्ण शेत vs an em-dash). A
    //    single nullable string would have collapsed them into one sentinel,
    //    which `DailyLog.PlotIds` explicitly refuses to do one layer down.
    //
    //    `Plot` is the plot name, or several joined by " · " for a multi-plot
    //    log; null when the log names none, or names only plots this farm's
    //    plot list no longer resolves. NEVER a placeholder name.

    /// <summary>The named plot(s), or <c>null</c> when the log names none.</summary>
    string? Plot,

    /// <summary>
    /// <see cref="ShramSafal.Domain.Logs.DailyLogScope"/>'s <c>ToString()</c> —
    /// <c>"Plot"</c> / <c>"MultiPlot"</c> / <c>"Farm"</c>. <c>"Farm"</c> is the
    /// farmer's own संपूर्ण शेत assertion, which the card states rather than
    /// blanking.
    /// </summary>
    string PlotScope);

/// <summary>
/// The labour facts the approval card is judged on. Task 20 (spec:
/// 2026-08-28-labour-v2-release-1) — every member was hard-coded null for
/// review rows until this release, so a मुकादम's "८ मजूर, ऊस तोडणी, ₹2400"
/// reached the owner as a name and a date with nothing to check.
///
/// <para><b>Every member is nullable and null means UNKNOWN</b> (P4/R6) — the
/// client renders an em-dash. A <c>0</c> here is a fact the farmer stated
/// ("nobody came", "it cost nothing"), never the absence of one.
/// <c>Amount</c> is the STATED <c>LabourAssignment.TotalCost</c> only; it is
/// never a wage multiplied by a headcount (NO-MULTIPLY), because this is the
/// screen where the owner commits money.</para>
/// </summary>
public sealed record LabourPointsDto(
    int? Count,
    string? Shift,
    string? Task,
    decimal? Amount,
    IReadOnlyList<string> Names);

/// <summary>
/// STAGE 5 — no longer hardcoded. <c>Headcount</c> is <c>int?</c>, not
/// <c>int</c>, for the same reason <c>ManDays</c> is <c>decimal?</c>: labour
/// today with nobody saying HOW MANY is unknown, and a 0 there would tell the
/// farmer the app believes nobody came. <c>0</c> is reserved for the genuine
/// case — a day with no labour on it at all.
///
/// <para><c>Rows</c> stays empty, and that is correct rather than pending: a
/// row is created ONLY by a deliberate tap (see LabourAttendanceRowDto), and
/// no save path exists for those taps yet. Deriving rows from spoken names
/// here would put marks in the register the farmer never made.</para>
/// </summary>
public sealed record LabourAttendanceDraftDto(
    string Plot,
    int? Headcount,
    IReadOnlyList<LabourAttendanceRowDto> Rows,
    // The engagement a mark made TODAY attaches to, or empty when today has
    // none yet. Attribution is an overlay on an engagement (Constraint 3 —
    // attaching never changes a headcount), so without one there is nothing
    // for a mark to hang off and the client must create the engagement first.
    //
    // Empty ALSO when today has more than one: two engagements is two possible
    // meanings for "he was here", and picking one silently would attribute a
    // worker to work he was never said to have done.
    string TodaysLabourAssignmentId);

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
