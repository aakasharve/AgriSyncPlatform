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
/// Task 1 (spec: 2026-08-28-labour-v2-release-1) — P4: no figure without
/// explainable evidence. <c>GetLabourDataHandler.cs:99-106</c> computes
/// recorded wages PURELY from JobCard evidence in {Completed,
/// VerifiedForPayout, PaidOut}. Production holds ZERO job cards, while real
/// labour money IS paid out (labour_misc <see cref="CostEntry"/> rows have no
/// JobCard link at all) — so "recorded work" was structurally ₹0 while Paid
/// was not, driving <c>Dashboard.Money.Owed</c> negative and the client into
/// rendering "जास्त दिलं" (you overpaid) for a farmer who did not. Zero job
/// cards is an ABSENCE of evidence, never evidence of zero — the two must not
/// be conflated.
///
/// <para>Proves the fix at BOTH sites the same root cause reaches:
/// per-PERSON (<see cref="LabourPersonDto.RecordedWages"/>) and FARM-WIDE
/// (<see cref="LabourDashboardDto.Owed"/> / <see cref="LabourMoneyDto.Recorded"/>
/// / <see cref="LabourMoneyDto.Owed"/>). Both must be <c>null</c> — never
/// <c>0m</c> — when zero job-card evidence exists, and no Owed/overpayment
/// figure may ever be derived from that null.</para>
///
/// <para>Deliberately never seeds a <c>JobCard</c> — the absence of one is
/// exactly the condition under test, not a gap in the fixture.</para>
/// </summary>
public sealed class EarnedIsUnknownNotZeroTests
{
    private static readonly DateTime Now = new(2026, 8, 28, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmGuid = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid WorkerGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static GetLabourDataHandler BuildHandler(FakeRepo repo) => new(repo, new FixedClock(Now));

    /// <summary>
    /// The verified production shape: one real, active worker; real money
    /// paid out (an unattributed labour_misc <see cref="CostEntry"/> — no
    /// JobCard link, per Decision 3a 2026-07-19); and ZERO job cards anywhere
    /// on the farm.
    /// </summary>
    private static FakeRepo Scenario(decimal paidAmount = 4000m)
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, OwnerGuid, AppRole.PrimaryOwner);
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), new FarmId(FarmGuid), new UserId(WorkerGuid), AppRole.Worker, Now));

        var costEntry = CostEntry.Create(
            Guid.NewGuid(), new FarmId(FarmGuid), plotId: null, cropCycleId: null,
            categoryId: "labour_misc", description: "मजुरी", amount: paidAmount,
            currencyCode: "INR", entryDate: DateOnly.FromDateTime(Now),
            createdByUserId: new UserId(OwnerGuid), location: null, createdAtUtc: Now);
        repo.SeedUnattributedPayout(costEntry);

        return repo;
    }

    [Fact]
    public async Task Zero_job_cards_yields_null_earned_and_no_overpayment_at_farm_level()
    {
        var repo = Scenario(paidAmount: 4000m);

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid)));

        result.IsSuccess.Should().BeTrue();
        var data = result.Value!;

        // The mechanism: real money WAS paid — that fact stays intact.
        data.Dashboard.Wages.Should().Be(4000m, "money actually paid is evidenced by a real CostEntry row");
        data.Dashboard.Money!.Paid.Should().Be(4000m);

        // ...while job-card evidence is entirely absent, so RecordedWages
        // ("काम झालं") must be UNKNOWN, never a fabricated ₹0.
        data.Dashboard.Money.Recorded.Should().BeNull(
            "zero job cards is an ABSENCE of evidence, not evidence of zero (P4)");

        // And a balance must never be derived from that unknown.
        data.Dashboard.Owed.Should().BeNull(
            "never derive Owed from a null Earned — the balance is absent, not zero, not negative");
        data.Dashboard.Money.Owed.Should().BeNull();
    }

    [Fact]
    public async Task Zero_job_cards_for_a_specific_worker_yields_null_recorded_wages_not_zero()
    {
        var repo = Scenario();

        var result = await BuildHandler(repo).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(OwnerGuid)));

        result.IsSuccess.Should().BeTrue();
        var worker = result.Value!.People.Should().ContainSingle().Which;

        worker.RecordedWages.Should().BeNull(
            "this worker has no Completed/VerifiedForPayout/PaidOut job card — an absent fact, not a ₹0 one");
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FakeRepo : StubShramSafalRepository
    {
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();
        private readonly List<FarmMembership> _memberships = [];
        private readonly List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)> _payouts = [];

        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;
        public void SeedMembership(FarmMembership m) => _memberships.Add(m);
        public void SeedUnattributedPayout(CostEntry entry) => _payouts.Add((entry, null));

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult(_memberships.Where(m => m.FarmId == farmId).ToList());

        public override Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(
            IEnumerable<Guid> userIds, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<SyncOperatorDto>>([]);

        // Task 9 (spec: 2026-08-28-labour-v2-release-1) — the date window. These
        // tests send no window, so both bounds arrive null (आजपर्यंत / all time)
        // and the predicate is a no-op; it is honoured anyway so the double
        // cannot silently disagree with production about what the bounds mean.
        public override Task<List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>> GetLabourPayoutCostEntriesWithJobCardAsync(
            FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default)
            => Task.FromResult(_payouts
                .Where(p => p.CostEntry.FarmId == farmId
                    && (fromDate is null || p.CostEntry.EntryDate >= fromDate.Value)
                    && (toDateInclusive is null || p.CostEntry.EntryDate <= toDateInclusive.Value))
                .ToList());

        public override Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(
            IEnumerable<Guid> costEntryIds, CancellationToken ct = default)
            => Task.FromResult(new List<FinanceCorrection>());
    }
}
