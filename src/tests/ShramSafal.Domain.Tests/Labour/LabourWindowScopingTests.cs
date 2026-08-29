using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Work.Handlers;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// Task 9 (spec: 2026-08-28-labour-v2-release-1) — the adjustable time window,
/// and the UTC-anchored week it replaces.
///
/// <para><b>Defect A — four of the five dashboard tiles were lifetime figures
/// under a "या आठवड्यात" ("this week") heading.</b> Only <c>ManDays</c> was
/// ever week-scoped; <c>Wages</c>, <c>Logs</c>, <c>Pending</c> and the
/// owed/recorded pair were computed from unfiltered farm-wide reads. The
/// heading was therefore false for four numbers out of five.</para>
///
/// <para><b>Defect B — the one week that DID exist was UTC-anchored.</b>
/// <c>clock.UtcNow.Date</c> is a day behind the farmer's between 00:00 and
/// 05:30 IST — and early morning is when farm work happens. The analytics side
/// hit the identical bug and fixed it in
/// <c>20260817150453_WvfdWeekBoundaryToIst</c>; the fix is
/// <see cref="ShramSafal.Domain.Dfes.FarmLocalDay"/>, and this task reuses it
/// rather than inventing a second timezone rule.</para>
///
/// <para><b>What is deliberately NOT scoped.</b> <c>Pending</c> is an approval
/// inbox, not a statistic — founder ruling. A time filter must never hide work
/// still waiting on the owner, so it is asserted IDENTICAL across all four
/// windows.</para>
///
/// <para><b>The honesty rule this file pins</b> (release-governing, progress.md
/// R6/R8): absence of any record ⇒ unknown (<c>null</c>, an em-dash on screen);
/// a record that exists and contains nothing ⇒ a genuine zero. Applied per
/// figure, inside a window, at the bottom of this file.</para>
/// </summary>
public sealed class LabourWindowScopingTests
{
    /// <summary>
    /// Friday 2026-08-28, 09:00 UTC = 14:30 IST. Deliberately mid-afternoon:
    /// the UTC and IST local dates agree here, so the scoping theory below
    /// isolates WINDOW behaviour from the IST-boundary behaviour proved
    /// separately at the bottom of this file.
    /// </summary>
    private static readonly DateTime Now = new(2026, 8, 28, 9, 0, 0, DateTimeKind.Utc);

    private static readonly DateOnly TodayDate = new(2026, 8, 28);           // Friday.
    private static readonly DateOnly EarlierThisWeek = new(2026, 8, 25);     // Tuesday — same Monday-anchored week.
    private static readonly DateOnly EarlierThisMonth = new(2026, 8, 5);     // Same month, an earlier week.
    private static readonly DateOnly LastMonth = new(2026, 7, 15);

    private static readonly Guid FarmGuid = Guid.Parse("77777777-7777-7777-7777-777777777777");
    private static readonly Guid OwnerGuid = Guid.Parse("88888888-8888-8888-8888-888888888888");
    private static readonly Guid WorkerGuid = Guid.Parse("99999999-9999-9999-9999-999999999999");
    private static readonly Guid PlotGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    private static GetLabourDataHandler BuildHandler(FakeRepo repo, DateTime? nowUtc = null)
        => new(repo, new FixedClock(nowUtc ?? Now));

    // ─── The scoping contract ────────────────────────────────────────────────

    /// <summary>
    /// One day's evidence on each of four dates, each with a DIFFERENT
    /// magnitude, so every window produces a distinguishable total and no test
    /// can pass by coincidence:
    /// <list type="bullet">
    /// <item><description>today          → 1 man-day, ₹100 paid, ₹1000 recorded</description></item>
    /// <item><description>earlier this week → 2 / ₹200 / ₹2000</description></item>
    /// <item><description>earlier this month → 4 / ₹400 / ₹4000</description></item>
    /// <item><description>last month     → 8 / ₹800 / ₹8000</description></item>
    /// </list>
    /// </summary>
    private static FakeRepo FullScenario()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), new FarmId(FarmGuid), new UserId(WorkerGuid), AppRole.Worker, Now));

        SeedDay(repo, TodayDate, headcount: 1, paid: 100m, recorded: 1000m);
        SeedDay(repo, EarlierThisWeek, headcount: 2, paid: 200m, recorded: 2000m);
        SeedDay(repo, EarlierThisMonth, headcount: 4, paid: 400m, recorded: 4000m);
        SeedDay(repo, LastMonth, headcount: 8, paid: 800m, recorded: 8000m);

        return repo;
    }

    private static void SeedDay(FakeRepo repo, DateOnly date, int headcount, decimal paid, decimal recorded)
    {
        var logId = Guid.NewGuid();
        repo.SeedDailyLog(BuildLog(logId, date));
        repo.SeedAssignment(BuildAssignment(logId, headcount));
        repo.SeedUnattributedPayout(BuildCostEntry(date, paid));
        repo.SeedJobCard(BuildCompletedJobCard(date, recorded));
    }

    [Theory]
    // window,   man-days, wages, recorded, logs
    [InlineData("today", 1, 100, 1000, 1)]
    [InlineData("week", 3, 300, 3000, 2)]
    [InlineData("month", 7, 700, 7000, 3)]
    [InlineData("alltime", 15, 1500, 15000, 4)]
    public async Task Every_windowed_figure_is_scoped_to_the_requested_window(
        string window, int expectedManDays, decimal expectedWages, decimal expectedRecorded, int expectedLogs)
    {
        var repo = FullScenario();

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), window));

        result.IsSuccess.Should().BeTrue();
        var d = result.Value!.Dashboard;

        d.ManDays.Should().Be(expectedManDays, "मजूर-दिवस counts only assignments on days inside the window");
        d.Wages.Should().Be(expectedWages, "दिलं sums only labour CostEntry rows dated inside the window");
        d.Money.Recorded.Should().Be(expectedRecorded, "काम झालं sums only job cards planned inside the window");
        d.Money.Paid.Should().Be(expectedWages);
        d.Logs.Should().Be(expectedLogs, "the log count is the number of daily logs dated inside the window");
        d.Owed.Should().Be(expectedRecorded - expectedWages,
            "बाकी stays DERIVED — recorded minus paid minus advance — for whatever window is in force");
        d.Money.Owed.Should().Be(expectedRecorded - expectedWages);
    }

    [Theory]
    [InlineData("today")]
    [InlineData("week")]
    [InlineData("month")]
    [InlineData("alltime")]
    public async Task Per_person_figures_move_with_the_window_so_the_rows_reconcile_with_the_tiles(string window)
    {
        var repo = FullScenario();

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), window));

        var person = result.Value!.People.Should().ContainSingle().Which;
        var dashboard = result.Value!.Dashboard;

        // The dashboard rollup is documented as the SAME population as the
        // rows below it. If the tiles were windowed and the rows were not, the
        // two would visibly disagree on one screen.
        person.RecordedWages.Should().Be(dashboard.Money.Recorded);
    }

    /// <summary>
    /// The roster is not a statistic either: a worker on the farm still appears
    /// in a window he did no recorded work in. His RecordedWages is `null`
    /// there (no job-card evidence inside the window — absence, not zero), and
    /// he is NOT dropped from the list.
    /// </summary>
    [Fact]
    public async Task A_worker_with_no_activity_in_the_window_still_appears_with_an_unknown_not_a_zero()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), new FarmId(FarmGuid), new UserId(WorkerGuid), AppRole.Worker, Now));
        SeedDay(repo, LastMonth, headcount: 8, paid: 800m, recorded: 8000m);

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "today"));

        var person = result.Value!.People.Should().ContainSingle().Which;
        person.RecordedWages.Should().BeNull(
            "no job card of his falls inside today — that is an absence of evidence, never a ₹0 he earned");
    }

    // ─── Pending is NEVER window-scoped (founder ruling) ─────────────────────

    [Fact]
    public async Task Pending_is_identical_across_all_four_windows()
    {
        var repo = FullScenario();
        var counts = new List<int>();

        foreach (var window in new[] { "today", "week", "month", "alltime" })
        {
            var result = await BuildHandler(repo).HandleAsync(
                new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), window));

            result.IsSuccess.Should().BeTrue();
            counts.Add(result.Value!.Dashboard.Pending);
        }

        // Four Draft logs were seeded across four different dates. A
        // window-scoped Pending would read 1 / 2 / 3 / 4 here.
        counts.Should().AllBeEquivalentTo(4,
            "Pending is an approval INBOX, not a statistic — a time filter must never hide work "
            + "still waiting on the owner (founder ruling, Task 9)");
    }

    [Fact]
    public async Task The_review_list_itself_is_not_window_scoped_either()
    {
        var repo = FullScenario();

        var narrow = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "today"));
        var wide = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "alltime"));

        narrow.Value!.Review.Should().HaveCount(4);
        narrow.Value!.Review.Should().HaveCount(wide.Value!.Review.Count,
            "the count tile and the list it summarises must not disagree about what is waiting");
    }

    // ─── The window parameter itself ─────────────────────────────────────────

    [Fact]
    public async Task Omitting_the_window_is_all_time()
    {
        var repo = FullScenario();

        var omitted = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid)));
        var explicitAllTime = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "alltime"));

        omitted.IsSuccess.Should().BeTrue();
        omitted.Value!.Dashboard.Should().BeEquivalentTo(explicitAllTime.Value!.Dashboard,
            "आजपर्यंत (all time) is the default — an older client that sends no window keeps working");

        // ...and all-time really is unfiltered: every seeded day is counted.
        omitted.Value!.Dashboard.Logs.Should().Be(4);
        omitted.Value!.Dashboard.Wages.Should().Be(1500m);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task An_empty_window_parameter_is_treated_as_omitted(string window)
    {
        var repo = FullScenario();

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), window));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Dashboard.Logs.Should().Be(4);
    }

    [Theory]
    [InlineData("fortnight")]
    [InlineData("year")]
    [InlineData("this week")]
    public async Task An_unrecognised_window_is_rejected_rather_than_silently_widened(string window)
    {
        var repo = FullScenario();

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), window));

        result.IsSuccess.Should().BeFalse(
            "silently falling back to all time would answer a question the caller did not ask "
            + "— the same failure mode GetFinanceSummaryHandler.NormalizeGroupBy rejects");
    }

    [Theory]
    [InlineData("WEEK")]
    [InlineData(" Month ")]
    public async Task Window_matching_is_case_and_whitespace_insensitive(string window)
    {
        var repo = FullScenario();

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), window));

        result.IsSuccess.Should().BeTrue();
    }

    // ─── Defect B: the IST boundary ──────────────────────────────────────────

    /// <summary>
    /// 2026-08-30T23:30:00Z is 05:00 IST on Monday 2026-08-31 — a farmer
    /// starting work before dawn. UTC still calls it Sunday 2026-08-30, whose
    /// Monday-anchored week began 2026-08-24; the farmer's week began that very
    /// morning, 2026-08-31. Under the old rule the previous week's labour was
    /// folded into "this week", every single day, until 05:30 IST.
    /// </summary>
    private static readonly DateTime FiveAmIst = new(2026, 8, 30, 23, 30, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_five_am_ist_start_reads_the_farmers_week_not_the_utc_one()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);

        // Monday 2026-08-31 IST — the first day of the farmer's current week.
        SeedDay(repo, new DateOnly(2026, 8, 31), headcount: 3, paid: 300m, recorded: 3000m);
        // Wednesday 2026-08-26 — LAST week for the farmer, but inside the UTC
        // week the old `clock.UtcNow.Date` rule would have computed.
        SeedDay(repo, new DateOnly(2026, 8, 26), headcount: 5, paid: 500m, recorded: 5000m);

        var result = await BuildHandler(repo, FiveAmIst).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "week"));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Dashboard.ManDays.Should().Be(3m,
            "the week starts on the farmer's Monday (2026-08-31 IST), not on the UTC clock's Sunday");
        result.Value!.Dashboard.Logs.Should().Be(1);
        result.Value!.Dashboard.Wages.Should().Be(300m);
    }

    [Fact]
    public async Task A_five_am_ist_start_reads_the_farmers_today_not_yesterday()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);

        SeedDay(repo, new DateOnly(2026, 8, 31), headcount: 3, paid: 300m, recorded: 3000m); // farmer's today.
        SeedDay(repo, new DateOnly(2026, 8, 30), headcount: 5, paid: 500m, recorded: 5000m); // UTC's "today".

        var result = await BuildHandler(repo, FiveAmIst).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "today"));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Dashboard.ManDays.Should().Be(3m, "आज is the farmer's local day, 2026-08-31 IST");
        result.Value!.Dashboard.Logs.Should().Be(1);
    }

    /// <summary>
    /// The mirror-image check. 2026-08-31T18:15:00Z is 23:45 IST on the SAME
    /// local day — the last quarter-hour before the farmer's date rolls over.
    /// Tomorrow must not be counted yet. The old query had no upper bound at
    /// all (<c>log.LogDate &gt;= weekStart</c>), so any day dated ahead — a
    /// mis-keyed date, a device clock running fast — was silently inside "this
    /// week".
    /// </summary>
    [Fact]
    public async Task Work_dated_tomorrow_does_not_leak_into_todays_window_at_2345_ist()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);

        SeedDay(repo, new DateOnly(2026, 8, 31), headcount: 3, paid: 300m, recorded: 3000m); // today, 23:45 IST.
        SeedDay(repo, new DateOnly(2026, 9, 1), headcount: 5, paid: 500m, recorded: 5000m);  // tomorrow.

        var lateEvening = new DateTime(2026, 8, 31, 18, 15, 0, DateTimeKind.Utc);

        var today = await BuildHandler(repo, lateEvening).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "today"));
        var week = await BuildHandler(repo, lateEvening).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "week"));

        today.Value!.Dashboard.ManDays.Should().Be(3m, "23:45 IST is still today — tomorrow has not happened");
        today.Value!.Dashboard.Logs.Should().Be(1);
        today.Value!.Dashboard.Wages.Should().Be(300m);

        week.Value!.Dashboard.ManDays.Should().Be(3m,
            "a window labelled 'this week' must not include days that have not happened");
    }

    // ─── The honesty rule, applied INSIDE a window ───────────────────────────

    /// <summary>
    /// R8, narrowed to a window. No daily log inside it at all ⇒ we hold no
    /// record of those days ⇒ मजूर-दिवस is UNKNOWN. Silence is not a statement.
    /// </summary>
    [Fact]
    public async Task A_window_with_no_daily_log_at_all_reports_unknown_man_days()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);
        SeedDay(repo, LastMonth, headcount: 8, paid: 800m, recorded: 8000m);

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "today"));

        result.Value!.Dashboard.ManDays.Should().BeNull(
            "nothing was logged today, so we know nothing about today — not that nobody came");
    }

    /// <summary>
    /// R8's second case, narrowed to a window. A day WAS logged inside it and
    /// carried no labour ⇒ a real, evidenced zero.
    /// </summary>
    [Fact]
    public async Task A_window_whose_logged_days_carry_no_labour_reports_a_genuine_zero()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);
        repo.SeedDailyLog(BuildLog(Guid.NewGuid(), TodayDate));

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "today"));

        result.Value!.Dashboard.ManDays.Should().Be(0m,
            "he told us about today and it involved no hired labour — that IS a fact");
    }

    /// <summary>
    /// R6, narrowed to a window. No job card inside it ⇒ काम झालं is unknown,
    /// and बाकी must NOT be derived from that unknown — not zero, not negative.
    /// </summary>
    [Fact]
    public async Task A_window_with_no_job_card_evidence_reports_unknown_recorded_and_unknown_owed()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), new FarmId(FarmGuid), new UserId(WorkerGuid), AppRole.Worker, Now));
        repo.SeedDailyLog(BuildLog(Guid.NewGuid(), TodayDate));
        repo.SeedUnattributedPayout(BuildCostEntry(TodayDate, 900m));
        repo.SeedJobCard(BuildCompletedJobCard(LastMonth, 8000m)); // real evidence — but not in this window.

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "today"));

        var d = result.Value!.Dashboard;
        d.Wages.Should().Be(900m, "money actually paid today is evidenced by a real CostEntry row");
        d.Money.Recorded.Should().BeNull("no job card falls inside today — absence of evidence (R6)");
        d.Owed.Should().BeNull("never derive a balance from an unknown");
        d.Money.Owed.Should().BeNull();
    }

    /// <summary>
    /// The DELIBERATE asymmetry, and the one judgement in this task most likely
    /// to be read as a fabrication. A window with no labour CostEntry reports
    /// <c>₹0</c> paid, NOT unknown, for two reasons:
    ///
    /// <para>1. The money-consistency invariant. <c>Wages</c>/<c>Money.Paid</c>
    /// exists to equal the finance page's "Labour" bucket for the same farm and
    /// period, off the same rows and the same correction resolution.
    /// <c>GetFinanceSummaryHandler</c> sums an empty date range to a grand
    /// total of <c>0</c>. If labour rendered an em-dash where finance rendered
    /// ₹0 for the identical window, the two screens would contradict each other
    /// — and agreeing with finance is the entire reason this figure is derived
    /// the way it is.</para>
    ///
    /// <para>2. The two absences are not the same shape. मजूर-दिवस depends on
    /// someone having logged the day at all, so "no log" is genuinely "we were
    /// not told". A payment made through the app cannot exist without leaving a
    /// <c>CostEntry</c> row: within the ledger the app owns, no row IS no
    /// payment. (Cash handed over and never entered is invisible to every
    /// figure on this page and always has been — that is a data-entry gap, not
    /// something a null here would communicate.)</para>
    /// </summary>
    [Fact]
    public async Task A_window_with_no_labour_money_reports_a_genuine_zero_paid_not_unknown()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), new FarmId(FarmGuid), new UserId(WorkerGuid), AppRole.Worker, Now));
        repo.SeedDailyLog(BuildLog(Guid.NewGuid(), TodayDate));
        repo.SeedJobCard(BuildCompletedJobCard(TodayDate, 1000m));
        repo.SeedUnattributedPayout(BuildCostEntry(LastMonth, 800m)); // paid, but not in this window.

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "today"));

        var d = result.Value!.Dashboard;
        d.Wages.Should().Be(0m, "no labour cost row inside the window means no labour money moved inside it");
        d.Money.Recorded.Should().Be(1000m);
        d.Owed.Should().Be(1000m, "काम झालं minus a real ₹0 paid is a real ₹1000 outstanding");
    }

    /// <summary>
    /// <c>Logs</c> is a count of records, not a quantity estimated FROM records
    /// — the absence of a row IS the value, exactly observable. So an empty
    /// window reports 0, never unknown.
    /// </summary>
    [Fact]
    public async Task A_window_with_no_logs_reports_zero_logs_not_unknown()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);
        SeedDay(repo, LastMonth, headcount: 8, paid: 800m, recorded: 8000m);

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid), "today"));

        result.Value!.Dashboard.Logs.Should().Be(0);
    }

    // ─── Builders ────────────────────────────────────────────────────────────

    private static DailyLog BuildLog(Guid id, DateOnly logDate)
        => DailyLog.CreateForFarm(
            id: id,
            farmId: new FarmId(FarmGuid),
            operatorUserId: new UserId(OwnerGuid),
            logDate: logDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: Now);

    private static LabourAssignment BuildAssignment(Guid dailyLogId, int workerCount)
        => LabourAssignment.Create(
            id: Guid.NewGuid(),
            dailyLogId: dailyLogId,
            engagementType: LabourEngagementType.Hired,
            maleCount: null,
            femaleCount: null,
            workerCount: workerCount,
            wagePerPerson: null,
            contractUnit: null,
            contractQuantity: null,
            totalCost: null,
            linkedActivityId: null,
            createdAtUtc: Now,
            time: LabourTime.ServerAssumed());

    private static CostEntry BuildCostEntry(DateOnly entryDate, decimal amount)
        => CostEntry.Create(
            Guid.NewGuid(), new FarmId(FarmGuid), plotId: null, cropCycleId: null,
            categoryId: "labour_misc", description: "मजुरी", amount: amount,
            currencyCode: "INR", entryDate: entryDate,
            createdByUserId: new UserId(OwnerGuid), location: null, createdAtUtc: Now);

    /// <summary>
    /// A job card whose <c>PlannedDate</c> is the day the work was for — the
    /// only farm-local calendar date the aggregate carries, and the one this
    /// read-model windows on.
    /// </summary>
    private static JobCard BuildCompletedJobCard(DateOnly plannedDate, decimal total)
    {
        var card = JobCard.CreateDraft(
            Guid.NewGuid(),
            new FarmId(FarmGuid),
            PlotGuid,
            cropCycleId: null,
            new UserId(OwnerGuid),
            plannedDate,
            [new JobCardLineItem("labour", 1m, new Money(total, Currency.Inr), null)],
            Now);

        card.Assign(new UserId(WorkerGuid), new UserId(OwnerGuid), AppRole.PrimaryOwner, Now);
        card.CompleteWithLog(Guid.NewGuid(), new UserId(WorkerGuid), Now);
        return card;
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// The two repository reads this read-model OWNS apply the date window
    /// themselves (production pushes it to SQL, against the existing farm-id +
    /// date indexes), so the fake applies it too — that is the contract under
    /// test at the repository boundary, not an incidental detail. The two reads
    /// it SHARES with other use cases (<c>GetJobCardsForFarmAsync</c>,
    /// <c>GetDailyLogsByFarmAsync</c>) return everything, exactly as production
    /// does, so the handler's own filtering is what these tests exercise.
    /// </summary>
    private sealed class FakeRepo : StubShramSafalRepository
    {
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();
        private readonly List<FarmMembership> _memberships = [];
        private readonly List<LabourAssignment> _assignments = [];
        private readonly Dictionary<Guid, DateOnly> _assignmentDates = new();
        private readonly List<DailyLog> _dailyLogs = [];
        private readonly List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)> _payouts = [];
        private readonly List<JobCard> _jobCards = [];

        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;
        public void SeedMembership(FarmMembership m) => _memberships.Add(m);
        public void SeedDailyLog(DailyLog l) => _dailyLogs.Add(l);
        public void SeedUnattributedPayout(CostEntry e) => _payouts.Add((e, null));
        public void SeedJobCard(JobCard j) => _jobCards.Add(j);

        public void SeedAssignment(LabourAssignment a)
        {
            _assignments.Add(a);
            // Production joins LabourAssignment → DailyLog to reach a date; the
            // fake resolves the same link from the logs already seeded.
            var log = _dailyLogs.FirstOrDefault(l => l.Id == a.DailyLogId);
            if (log is not null)
            {
                _assignmentDates[a.Id] = log.LogDate;
            }
        }

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult(_memberships.Where(m => m.FarmId == farmId).ToList());

        public override Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(
            IEnumerable<Guid> userIds, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<SyncOperatorDto>>([]);

        public override Task<List<JobCard>> GetJobCardsForFarmAsync(
            FarmId farmId, JobCardStatus? statusFilter, CancellationToken ct = default)
            => Task.FromResult(_jobCards.Where(j => j.FarmId == farmId).ToList());

        public override Task<List<DailyLog>> GetDailyLogsByFarmAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult(_dailyLogs.Where(l => l.FarmId == farmId).ToList());

        public override Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(
            IEnumerable<Guid> costEntryIds, CancellationToken ct = default)
            => Task.FromResult(new List<FinanceCorrection>());

        public override Task<List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>> GetLabourPayoutCostEntriesWithJobCardAsync(
            FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default)
            => Task.FromResult(_payouts
                .Where(p => p.CostEntry.FarmId == farmId
                    && (fromDate is null || p.CostEntry.EntryDate >= fromDate.Value)
                    && (toDateInclusive is null || p.CostEntry.EntryDate <= toDateInclusive.Value))
                .ToList());

        public override Task<List<LabourAssignment>> GetLabourAssignmentsForFarmInWindowAsync(
            FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default)
            => Task.FromResult(_assignments
                .Where(a => _assignmentDates.TryGetValue(a.Id, out var date)
                    && (fromDate is null || date >= fromDate.Value)
                    && (toDateInclusive is null || date <= toDateInclusive.Value))
                .ToList());
    }
}
