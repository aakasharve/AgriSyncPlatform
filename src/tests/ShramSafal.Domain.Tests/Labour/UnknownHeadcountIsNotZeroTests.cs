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
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// Task 6 (spec: 2026-08-28-labour-v2-release-1) — Defect B: <c>LabourHeadcount.Resolve</c>
/// collapsed an all-NULL headcount (worker_count/male_count/female_count all unstated) to a plain
/// <c>0</c>, and <c>GetLabourDataHandler</c> summed that straight into <c>Dashboard.ManDays</c>
/// (मजूर-दिवस). So a log where the farmer never stated a headcount contributed a confident zero
/// to a figure he reads as fact — NULL means "we were not told"; <c>0</c> means "he said nobody
/// came". They are different facts and the schema already distinguishes them (P4/P8).
///
/// <para><b>Fix round 1/5 — the THREE-CASE rule.</b> The first pass at this task collapsed two
/// genuinely different situations into one <c>0</c> ("no assignments this week" and "assignments
/// exist but none states a headcount"), which inverted Task 1's own <c>hasJobCardEvidence</c>
/// ruling (R6: absence of ANY evidence farm-wide is unknown, never zero) for the structurally
/// analogous week-wide case. The corrected rule, in the order <c>GetLabourDataHandler</c> checks
/// it:</para>
/// <list type="number">
/// <item><description><b>No daily log at all this week</b> — we have no record of the week
/// whatsoever. Silence is not a statement: UNKNOWN (`null`), same polarity as R6.</description></item>
/// <item><description><b>Logs exist this week, but none carries a <see cref="LabourAssignment"/></b>
/// — the farmer told us about those days, and none of them involved hired labour. That IS a real,
/// evidenced fact: a genuine <c>0</c>.</description></item>
/// <item><description><b>Labour WAS logged this week, but no assignment in it ever stated a
/// headcount</b> — UNKNOWN (`null`), unchanged from the first pass. Within this case, an
/// assignment with a KNOWN headcount alongside unknown ones still contributes its real number —
/// mirrors Task 1's per-item-absence-contributes-nothing pattern.</description></item>
/// </list>
/// </summary>
public sealed class UnknownHeadcountIsNotZeroTests
{
    private static readonly DateTime Now = new(2026, 8, 28, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid OwnerGuid = Guid.Parse("55555555-5555-5555-5555-555555555555");

    private static GetLabourDataHandler BuildHandler(FakeRepo repo) => new(repo, new FixedClock(Now));

    private static FakeRepo BaseRepo()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);
        return repo;
    }

    private static LabourAssignment BuildAssignment(int? workerCount, int? maleCount, int? femaleCount, Guid dailyLogId)
        => LabourAssignment.Create(
            id: Guid.NewGuid(),
            dailyLogId: dailyLogId,
            engagementType: LabourEngagementType.Hired,
            maleCount: maleCount,
            femaleCount: femaleCount,
            workerCount: workerCount,
            wagePerPerson: null,
            contractUnit: null,
            contractQuantity: null,
            totalCost: null,
            linkedActivityId: null,
            createdAtUtc: Now,
            time: LabourTime.ServerAssumed());

    /// <summary>A daily log dated "today" (the fixed clock's date) — always inside the current week.</summary>
    private static DailyLog BuildLog(Guid id)
        => DailyLog.CreateForFarm(
            id: id,
            farmId: new FarmId(FarmGuid),
            operatorUserId: new UserId(OwnerGuid),
            logDate: DateOnly.FromDateTime(Now),
            idempotencyKey: null,
            location: null,
            createdAtUtc: Now);

    [Fact]
    public async Task No_daily_log_at_all_this_week_makes_the_week_total_unknown_not_zero()
    {
        // Neither a log nor an assignment seeded — we have no record of the
        // week at all. Different from "logged, but no labour" (below): this
        // is an absence of EVIDENCE about the week, not evidence of an empty one.
        var repo = BaseRepo();

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid)));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Dashboard.ManDays.Should().BeNull(
            "silence is not a statement — no log this week means we know nothing about it, "
            + "mirroring Task 1's R6 (farm-wide absence of job-card evidence is unknown, never zero)");
    }

    [Fact]
    public async Task Logged_days_with_no_labour_at_all_is_a_genuine_zero_not_unknown()
    {
        // A real daily log exists this week, but it carries no LabourAssignment
        // at all — the farmer told us about the day, and it involved no hired
        // labour. That IS a real, evidenced fact.
        var repo = BaseRepo();
        repo.SeedDailyLog(BuildLog(Guid.NewGuid()));

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid)));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Dashboard.ManDays.Should().Be(0m,
            "the farmer DID tell us about this day — a logged day with no labour assignment is a genuine 0, not an unknown");
    }

    [Fact]
    public async Task A_log_with_no_stated_headcount_makes_the_week_total_unknown_not_zero()
    {
        var repo = BaseRepo();
        var logId = Guid.NewGuid();
        repo.SeedDailyLog(BuildLog(logId));
        repo.SeedAssignment(BuildAssignment(workerCount: null, maleCount: null, femaleCount: null, dailyLogId: logId));

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid)));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Dashboard.ManDays.Should().BeNull(
            "the farmer said nothing about how many worked — that is an ABSENCE of evidence, not evidence of zero (P4)");
    }

    [Fact]
    public async Task An_unstated_headcount_contributes_nothing_to_a_week_with_other_known_assignments()
    {
        var repo = BaseRepo();
        var logId = Guid.NewGuid();
        repo.SeedDailyLog(BuildLog(logId));
        repo.SeedAssignment(BuildAssignment(workerCount: 3, maleCount: null, femaleCount: null, dailyLogId: logId));
        repo.SeedAssignment(BuildAssignment(workerCount: null, maleCount: null, femaleCount: null, dailyLogId: logId));

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid)));

        result.IsSuccess.Should().BeTrue();
        // The unknown assignment contributes NOTHING — the total is the real,
        // known 3, not silently under-reported to something else, and not
        // poisoned to null just because ONE of several logs was silent.
        result.Value!.Dashboard.ManDays.Should().Be(3m);
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FakeRepo : StubShramSafalRepository
    {
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();
        private readonly List<LabourAssignment> _assignments = [];
        private readonly List<DailyLog> _dailyLogs = [];

        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;
        public void SeedAssignment(LabourAssignment a) => _assignments.Add(a);
        public void SeedDailyLog(DailyLog l) => _dailyLogs.Add(l);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult(new List<FarmMembership>());

        public override Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(
            IEnumerable<Guid> userIds, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<SyncOperatorDto>>([]);

        public override Task<List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>> GetLabourPayoutCostEntriesWithJobCardAsync(
            FarmId farmId, CancellationToken ct = default)
            => Task.FromResult(new List<(CostEntry, Guid?)>());

        public override Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(
            IEnumerable<Guid> costEntryIds, CancellationToken ct = default)
            => Task.FromResult(new List<FinanceCorrection>());

        public override Task<List<LabourAssignment>> GetLabourAssignmentsForFarmSinceAsync(
            FarmId farmId, DateOnly weekStart, CancellationToken ct = default)
            => Task.FromResult(_assignments.ToList());

        public override Task<List<DailyLog>> GetDailyLogsByFarmAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult(_dailyLogs.ToList());
    }
}
