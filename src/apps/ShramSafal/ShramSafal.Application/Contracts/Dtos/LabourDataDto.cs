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
    LabourAttendanceDraftDto Attendance,
    // D-H8 (ONE REGISTER, THREE VIEWS) — which projection this response IS:
    // "owner" (whole book) | "crew" (attendance, no money roster) | "own"
    // (own row only; empty until an account↔FieldOperator link exists).
    // Resolved server-side from the caller's membership role; the client
    // renders what arrives and adds nothing back.
    string View,
    LabourHomeDto Home);

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
    // Phase 4 (D-H8) — Paid and Advance are `decimal?`: null means WITHHELD BY
    // VIEW (a non-owner caller gets no money roster), distinct from the 0m a
    // real empty payout history produces for an owner. Never coalesce to 0.
    decimal? RecordedWages,
    decimal? Paid,
    decimal? Advance,
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
    // `int`) for half-day precision. (It once also backed the ledger's
    // `WeekTotal`, deleted with the clean-register contract — Phase 4 Task 1.)
    decimal? ManDays,
    int ManDaysTrend,
    // Phase 4 (D-H8) — nullable: null = withheld by view (non-owner caller).
    // An owner's real figures are never null here.
    decimal? Wages,
    decimal? Advances,
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
    LabourMoneyDto? Money);

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
/// The CLEAN register (founder master review 2026-09-02, D4): "नावाखाली कोणताही
/// summary, कामाचा मजकूर किंवा पैशांची कळ नाही. नाव + दिवसाचे खूण एवढेच."
///
/// <para>No money member, no totals member — not days, not people, not rupees.
/// The old <c>Total</c>/<c>WeekTotal</c>/<c>DailyTotals</c> left this contract
/// deliberately; day-count reads live in DETAIL views (tap a cell), and the
/// dimensional week (5 पूर्ण · 1 अर्धा · 2 रात्री…) is composed there — never
/// one number (final direction §2). Reinstating an aggregate here requires
/// deleting <c>BuildHajeriLedgerTests.TheGridContractCarriesNoAggregateAndNoMoney</c>,
/// which is the point of that test.</para>
///
/// <para><c>Days</c> is EVERY date of a bounded window, in order — the page is
/// always drawn (correction 5); a register with nothing written in it is still
/// a register. Cells are per-day slots; a <c>null</c> slot is "कुणी माहिती
/// नाही" — silence, never absence.</para>
/// </summary>
public sealed record LabourLedgerDto(
    string WeekLabel,
    IReadOnlyList<string> Days,
    IReadOnlyList<LabourLedgerRowDto> Rows,
    IReadOnlyList<LabourLedgerCrewRowDto> CrewRows);

/// <summary>
/// One person's register row. <c>FieldOperatorId</c> is the durable work
/// identity (tap-detail addresses a person-day by it); <c>PersonId</c> stays a
/// prefixed grouping key ("op:{32-hex}") so no client ever mistakes it for a
/// bare user id — the same defence the old "name:" prefix carried.
/// </summary>
public sealed record LabourLedgerRowDto(
    string PersonId,
    Guid FieldOperatorId,
    string Name,
    string Initial,
    string Tone,
    IReadOnlyList<LabourLedgerCellDto?> Cells);

/// <summary>
/// One person-day cell — the five approved axes (D-H3 + master review D4):
/// day half, night half, stated hours (Nत), stated extra hours (+N), and the
/// उक्ते engagement marker. All STATED facts. <c>Day</c>/<c>Night</c> are the
/// wire forms of <see cref="ShramSafal.Domain.Labour.DayMark"/> /
/// <see cref="ShramSafal.Domain.Labour.NightMark"/> with Unmarked as null —
/// two preserved facts, never a summed number, and no reader may consume
/// <c>AttendanceMark.Value</c> to merge them (it is [Obsolete] for exactly
/// that reason). <c>Work</c> exists for TAP-DETAIL only; the grid never
/// renders it (D4: no कामाचा मजकूर under the name).
/// </summary>
public sealed record LabourLedgerCellDto(
    string? Day,
    string? Night,
    decimal? Hours,
    decimal? ExtraHours,
    bool Ukte,
    string? Work);

/// <summary>
/// A crew engaged THROUGH a Labour Mukadam (final direction §3): its own
/// aggregate row, never folded into his personal presence row. <c>Counts</c>
/// are per-day STATED headcounts (LabourHeadcount.Resolve over that day's
/// engaged-through engagements — known figures sum, an unstated one poisons
/// nothing, all-unknown is null/blank). Display of what was recorded; no
/// remainder subtraction, no reconciliation against work rows (D9.12).
/// </summary>
public sealed record LabourLedgerCrewRowDto(
    Guid ThroughFieldOperatorId,
    string ThroughName,
    IReadOnlyList<int?> Counts);

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

/// <summary>
/// Labour home (master review 2026-09-02, D6) — one Labour, TWO money truths,
/// never combined: the system never says "₹16,650 खर्च".
///
/// <para><c>RojandariStated</c> (दिवसाच्या हिशोबाने · नोंदलेली) sums STATED TotalCost on
/// engagements NOT governed by a known उक्ते agreement; <c>UkteAgreed</c>
/// (उक्ते काम · ठरलेली) sums stated TotalCost on the ones that are. Which is
/// which is decided in exactly ONE place — <c>GetLabourDataHandler.IsUkte</c>,
/// whose remarks carry the founder's corrected economic model and name the
/// facts (a stated total, a mukadam, worker names) that deliberately do NOT
/// decide it. Same-kind aggregation
/// under an honest label is display of what was recorded; blending the kinds,
/// rate × days, or presenting agreed as spent is forbidden and has no member
/// here to land in. Null = nothing stated — blank, never ₹0. Actually-paid
/// money (दिलेली रक्कम) is the existing Paid surface, not this.</para>
///
/// <para>The headcount line ("आज कामावर N जण — x दिवसाच्या हिशोबाने · y उक्ते") reads
/// STATED engagement headcounts (the engagement is the single source of HOW
/// MANY — AttendanceMark's own contract); the arrangement split is a
/// breakdown, never a filter, so x + y need not equal N and an unknown part
/// stays null. Phase 6 (Contract V1) extends the उक्ते card from this seam
/// without remodelling Labour/हजेरी — the founder's scope fence.</para>
///
/// <para>NAMING (founder vocabulary rule, 2026-09-03): the member names
/// <c>RojandariStated</c> / <c>RojandariToday</c> are INTERNAL and stay. The
/// farmer-facing card no longer reads रोजंदारी — it reads दिवसाच्या हिशोबाने,
/// because रोजंदारी names the BASIS on which the farmer owes money and had
/// begun to read as a KIND OF PERSON above a headcount. Presentation and
/// internal vocabulary are allowed to diverge; that is the founder's explicit
/// instruction. No wire field, column or migration changed.</para>
/// </summary>
public sealed record LabourHomeDto(
    decimal? RojandariStated,
    decimal? UkteAgreed,
    int? OnFarmToday,
    int? RojandariToday,
    int? UkteToday);
