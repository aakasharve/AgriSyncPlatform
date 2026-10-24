using AgriSync.BuildingBlocks.Abstractions;
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
/// Task 20 (spec: 2026-08-28-labour-v2-release-1) — DEFECT 1: the approval
/// card showed nothing to approve.
///
/// <para><b>The mechanism.</b> <c>GetLabourDataHandler</c> §8 built every
/// review row with a hard-coded <c>new LabourPointsDto(null, null, null, null,
/// [])</c>. The client renders those points faithfully; there was simply
/// nothing in them. So a मुकादम's "८ मजूर, ऊस तोडणी, ₹2400" reached the owner
/// as a circle, a name and a relative date — and an owner with a backlog who
/// cannot see what he is approving taps सगळं मंजूर and approves it unseen,
/// after which the system records that he checked. The facts were ABSENT FROM
/// THE PAYLOAD, not present-and-unrendered.</para>
///
/// <para><b>The rule the fix must not break</b> (release-governing, P4/R6):
/// absence of a record ⇒ unknown (<c>null</c> here, an em-dash on screen),
/// never a fabricated <c>0</c> / <c>₹0</c>. A log carrying no labour
/// engagement at all reports every point as <c>null</c>; it must never report
/// "0 मजूर, ₹0", which asserts that nobody worked and nothing was owed.</para>
///
/// <para><b>NO-MULTIPLY holds here too.</b> <c>Amount</c> is the STATED
/// <see cref="LabourAssignment.TotalCost"/> only. A wage-per-person times a
/// headcount is a number the farmer never said, and this card is where he
/// decides money.</para>
///
/// <para>DEFECT 2's server half is at the bottom: <c>Pending</c> and
/// <c>Review</c> must be the same set (they already were — this pins it), and
/// the list is ordered newest-first by the date the farmer READS (LogDate),
/// not by when a row happened to be touched.</para>
/// </summary>
public sealed class ReviewCardCarriesTheFactsTests
{
    private static readonly DateTime Now = new(2026, 8, 28, 9, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 8, 28);

    private static readonly Guid FarmGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid OwnerGuid = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly Guid PlotGuid = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    private static readonly Guid SecondPlotGuid = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff");

    private static GetLabourDataHandler BuildHandler(FakeRepo repo) => new(repo, new FixedClock(Now));

    private static FakeRepo NewFarm()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);
        repo.SeedPlot(Plot.Create(PlotGuid, new FarmId(FarmGuid), "ऊस-१", 2m, Now));
        repo.SeedPlot(Plot.Create(SecondPlotGuid, new FarmId(FarmGuid), "द्राक्ष-२", 1m, Now));
        return repo;
    }

    /// <summary>Runs the read-model and fails the test loudly if the handler itself refused.</summary>
    private static async Task<LabourDataDto> Run(FakeRepo repo)
    {
        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid)));
        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    // ─── DEFECT 1 — the four facts the owner judges by ───────────────────────

    [Fact]
    public async Task A_review_card_carries_headcount_task_money_and_the_plot_it_happened_on()
    {
        var repo = NewFarm();
        var logId = Guid.NewGuid();
        repo.SeedDailyLog(PlotLog(logId, PlotGuid, Today));
        repo.SeedAssignment(Assignment(
            logId, workerCount: 8, task: "ऊस तोडणी", totalCost: 2400m,
            shift: LabourShift.Full, workerNames: ["रमेश"]));

        var card = (await Run(repo)).Review.Single();

        card.Points.Count.Should().Be(8, "the owner cannot judge an approval without the headcount");
        card.Points.Task.Should().Be("ऊस तोडणी", "what work was done is the second thing he judges by");
        card.Points.Amount.Should().Be(2400m, "this card decides money — the stated total must be on it");
        card.Points.Shift.Should().Be("full", "lower-cased to the wire union the client's SHIFT_LABEL is keyed by");
        card.Points.Names.Should().Contain("रमेश");
        card.Plot.Should().Be("ऊस-१", "which plot the work happened on");
        card.PlotScope.Should().Be("Plot");
    }

    [Fact]
    public async Task A_log_with_no_labour_engagement_reports_every_point_unknown_never_a_fabricated_zero()
    {
        var repo = NewFarm();
        repo.SeedDailyLog(PlotLog(Guid.NewGuid(), PlotGuid, Today));

        var card = (await Run(repo)).Review.Single();

        card.Points.Count.Should().BeNull("no engagement means we were not told a headcount — not that nobody came");
        card.Points.Task.Should().BeNull();
        card.Points.Amount.Should().BeNull("a fabricated ₹0 on an approval card is a claim the farmer owes nothing");
        card.Points.Shift.Should().BeNull();
        card.Points.Names.Should().BeEmpty();
    }

    [Fact]
    public async Task An_engagement_that_stated_no_cost_reports_unknown_money_never_multiplied_from_the_wage()
    {
        var repo = NewFarm();
        var logId = Guid.NewGuid();
        repo.SeedDailyLog(PlotLog(logId, PlotGuid, Today));
        // ₹300 each × 8 people is a number the farmer never said. NO-MULTIPLY.
        repo.SeedAssignment(Assignment(logId, workerCount: 8, wagePerPerson: 300m, totalCost: null));

        var card = (await Run(repo)).Review.Single();

        card.Points.Count.Should().Be(8);
        card.Points.Amount.Should().BeNull("only the STATED total may appear — 8 × ₹300 was never said");
    }

    [Fact]
    public async Task A_farm_wide_log_says_so_rather_than_inventing_a_plot()
    {
        var repo = NewFarm();
        var logId = Guid.NewGuid();
        repo.SeedDailyLog(DailyLog.CreateForFarm(
            logId, new FarmId(FarmGuid), new UserId(OwnerGuid), Today, null, null, Now));
        repo.SeedAssignment(Assignment(logId, workerCount: 3));

        var card = (await Run(repo)).Review.Single();

        card.PlotScope.Should().Be("Farm", "संपूर्ण शेत is a stated fact, distinguishable from an unknown plot");
        card.Plot.Should().BeNull("no plot was named, so none is invented");
    }

    [Fact]
    public async Task A_multi_plot_log_names_every_plot_it_covers()
    {
        var repo = NewFarm();
        var logId = Guid.NewGuid();
        repo.SeedDailyLog(DailyLog.CreateForMultiPlot(
            logId, new FarmId(FarmGuid), [PlotGuid, SecondPlotGuid],
            new UserId(OwnerGuid), Today, null, null, Now));
        repo.SeedAssignment(Assignment(logId, workerCount: 5));

        var card = (await Run(repo)).Review.Single();

        card.PlotScope.Should().Be("MultiPlot");
        card.Plot.Should().Contain("ऊस-१").And.Contain("द्राक्ष-२");
    }

    [Fact]
    public async Task Two_engagements_on_one_day_sum_the_known_headcounts_and_the_stated_money()
    {
        var repo = NewFarm();
        var logId = Guid.NewGuid();
        repo.SeedDailyLog(PlotLog(logId, PlotGuid, Today));
        repo.SeedAssignment(Assignment(logId, workerCount: 8, task: "ऊस तोडणी", totalCost: 2400m));
        // The second gang's headcount was never stated. It must not drag the
        // known 8 down to nothing, and must not be counted as a 0 either.
        repo.SeedAssignment(Assignment(logId, workerCount: null, task: "फवारणी", totalCost: 600m));

        var card = (await Run(repo)).Review.Single();

        card.Points.Count.Should().Be(8, "a known figure among unknowns is never poisoned to null");
        card.Points.Amount.Should().Be(3000m);
        card.Points.Task.Should().Contain("ऊस तोडणी").And.Contain("फवारणी");
    }

    // ─── DEFECT 2 (server half) — one set, newest first ──────────────────────

    [Fact]
    public async Task The_pending_badge_counts_exactly_the_rows_the_review_list_carries()
    {
        var repo = NewFarm();
        for (var i = 0; i < 5; i++)
        {
            repo.SeedDailyLog(PlotLog(Guid.NewGuid(), PlotGuid, Today.AddDays(-i * 30)));
        }

        var data = await Run(repo);

        data.Review.Should().HaveCount(5);
        data.Dashboard.Pending.Should().Be(data.Review.Count,
            "the badge and the list must be the same set — a badge that can never reach zero is a lie about the queue");
    }

    [Fact]
    public async Task Old_work_is_never_dropped_from_the_review_payload()
    {
        var repo = NewFarm();
        repo.SeedDailyLog(PlotLog(Guid.NewGuid(), PlotGuid, Today.AddDays(-400)));

        var data = await Run(repo);

        data.Review.Should().HaveCount(1, "no recorded work may be unreachable from every screen in the app");
        data.Dashboard.Pending.Should().Be(1);
    }

    [Fact]
    public async Task The_review_list_is_ordered_newest_first_by_the_date_the_farmer_reads()
    {
        var repo = NewFarm();
        var oldest = Guid.NewGuid();
        var middle = Guid.NewGuid();
        var newest = Guid.NewGuid();
        // Seeded oldest-day-last so insertion order cannot produce the answer.
        repo.SeedDailyLog(PlotLog(middle, PlotGuid, Today.AddDays(-10)));
        repo.SeedDailyLog(PlotLog(newest, PlotGuid, Today));
        repo.SeedDailyLog(PlotLog(oldest, PlotGuid, Today.AddDays(-90)));

        var review = (await Run(repo)).Review;

        review.Select(r => r.Id).Should().Equal(
            newest.ToString(), middle.ToString(), oldest.ToString());
    }

    // ─── Builders ────────────────────────────────────────────────────────────

    private static DailyLog PlotLog(Guid id, Guid plotId, DateOnly logDate)
        => DailyLog.Create(
            id: id,
            farmId: new FarmId(FarmGuid),
            plotId: plotId,
            cropCycleId: Guid.NewGuid(),
            operatorUserId: new UserId(OwnerGuid),
            logDate: logDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: Now);

    private static LabourAssignment Assignment(
        Guid dailyLogId,
        int? workerCount = null,
        string? task = null,
        decimal? totalCost = null,
        decimal? wagePerPerson = null,
        LabourShift? shift = null,
        IReadOnlyList<string>? workerNames = null)
        => LabourAssignment.Create(
            id: Guid.NewGuid(),
            dailyLogId: dailyLogId,
            engagementType: LabourEngagementType.Hired,
            maleCount: null,
            femaleCount: null,
            workerCount: workerCount,
            wagePerPerson: wagePerPerson,
            contractUnit: null,
            contractQuantity: null,
            totalCost: totalCost,
            linkedActivityId: null,
            createdAtUtc: Now,
            time: LabourTime.ServerAssumed(),
            shift: shift,
            task: task,
            workerNames: workerNames);

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// Mirrors <c>LabourWindowScopingTests.FakeRepo</c>: the reads this
    /// read-model OWNS apply their own date window (production pushes it to
    /// SQL), the reads it SHARES with other use cases return everything.
    /// </summary>
    private sealed class FakeRepo : StubShramSafalRepository
    {
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();
        private readonly List<DailyLog> _dailyLogs = [];
        private readonly List<LabourAssignment> _assignments = [];
        private readonly Dictionary<Guid, DateOnly> _assignmentDates = new();
        private readonly List<Plot> _plots = [];

        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;
        public void SeedDailyLog(DailyLog l) => _dailyLogs.Add(l);
        public void SeedPlot(Plot p) => _plots.Add(p);

        public void SeedAssignment(LabourAssignment a)
        {
            _assignments.Add(a);
            var log = _dailyLogs.FirstOrDefault(l => l.Id == a.DailyLogId);
            if (log is not null)
            {
                _assignmentDates[a.Id] = log.LogDate;
            }
        }

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult(new List<FarmMembership>());

        public override Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(
            IEnumerable<Guid> userIds, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<SyncOperatorDto>>([]);

        public override Task<List<JobCard>> GetJobCardsForFarmAsync(
            FarmId farmId, JobCardStatus? statusFilter, CancellationToken ct = default)
            => Task.FromResult(new List<JobCard>());

        public override Task<List<DailyLog>> GetDailyLogsByFarmAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult(_dailyLogs.Where(l => l.FarmId == farmId).ToList());

        public override Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(
            IEnumerable<Guid> costEntryIds, CancellationToken ct = default)
            => Task.FromResult(new List<FinanceCorrection>());

        public override Task<List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>> GetLabourPayoutCostEntriesWithJobCardAsync(
            FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default)
            => Task.FromResult(new List<(CostEntry, Guid?)>());

        public override Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult(_plots.Where(p => p.FarmId == new FarmId(farmId)).ToList());

        public override Task<List<LabourAssignment>> GetLabourAssignmentsForFarmInWindowAsync(
            FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default)
            => Task.FromResult(_assignments
                .Where(a => _assignmentDates.TryGetValue(a.Id, out var date)
                    && (fromDate is null || date >= fromDate.Value)
                    && (toDateInclusive is null || date <= toDateInclusive.Value))
                .ToList());
    }
}
