using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
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
/// <para>Mirrors Task 1's farm-wide-evidence-vs-per-item-absence split
/// (<c>hasJobCardEvidence</c> in <c>GetLabourDataHandler</c>): one assignment with no stated
/// headcount contributes NOTHING to the week's sum (never a fabricated 0m). The week total itself
/// is unknown only when labour WAS logged this week but its headcount was never captured in any
/// of it — an empty week (nothing logged at all) is a different, genuine fact: a confirmed zero
/// man-days, not an unknown one. See the report for this judgment call, written out the way
/// Task 1's R6 ruling was.</para>
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

    private static LabourAssignment BuildAssignment(int? workerCount, int? maleCount, int? femaleCount)
        => LabourAssignment.Create(
            id: Guid.NewGuid(),
            dailyLogId: Guid.NewGuid(),
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

    [Fact]
    public async Task A_log_with_no_stated_headcount_makes_the_week_total_unknown_not_zero()
    {
        var repo = BaseRepo();
        repo.SeedAssignment(BuildAssignment(workerCount: null, maleCount: null, femaleCount: null));

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
        repo.SeedAssignment(BuildAssignment(workerCount: 3, maleCount: null, femaleCount: null));
        repo.SeedAssignment(BuildAssignment(workerCount: null, maleCount: null, femaleCount: null));

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid)));

        result.IsSuccess.Should().BeTrue();
        // The unknown assignment contributes NOTHING — the total is the real,
        // known 3, not silently under-reported to something else, and not
        // poisoned to null just because ONE of several logs was silent.
        result.Value!.Dashboard.ManDays.Should().Be(3m);
    }

    [Fact]
    public async Task A_week_with_no_assignments_logged_at_all_is_a_genuine_zero_not_unknown()
    {
        // No SeedAssignment call at all — nobody logged any labour this week.
        // Different fact from "logged, but headcount unstated": this is a
        // confirmed absence of work, not an absence of evidence about work
        // that happened.
        var repo = BaseRepo();

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid)));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Dashboard.ManDays.Should().Be(0m);
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

        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;
        public void SeedAssignment(LabourAssignment a) => _assignments.Add(a);

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
    }
}
