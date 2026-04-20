using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Auth;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

/// <summary>
/// Baseline regression suite locking in the structural decision from
/// commit <c>814ec70</c> ("architecture: add farm-scoped memberships for
/// ShramSafal access"). These three tests correspond exactly to the
/// behaviours listed in the multi-user plan §7.3 and in §13.1 Rule 1.
///
/// If any of these fail during Phase 2–8 work, STOP. The change is
/// corrupting the multi-tenant model regardless of whether the new
/// feature "works".
///
/// Trait: <c>Baseline_814ec70</c> — CI filters on this for the mandatory
/// pre-merge gate.
/// </summary>
[Trait("Suite", "Baseline_814ec70")]
public sealed class FarmMembershipAuthorizationBaselineTests
{
    private static readonly FarmId FarmA = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly FarmId FarmB = new(Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"));

    private static readonly UserId OwnerOfA = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId WorkerOfA = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly UserId SecondaryOwnerOfA = new(Guid.Parse("33333333-3333-3333-3333-333333333333"));

    private static (ShramSafalAuthorizationEnforcer enforcer, FakeAuthorizationRepository repo) CreateSubject()
    {
        var repo = new FakeAuthorizationRepository();
        var enforcer = new ShramSafalAuthorizationEnforcer(repo);
        return (enforcer, repo);
    }

    [Fact(DisplayName = "A member of Farm A cannot access Farm B")]
    public async Task MemberOfFarmA_CannotAccessFarmB()
    {
        var (enforcer, repo) = CreateSubject();
        repo.AddMembership(FarmA, OwnerOfA, AppRole.PrimaryOwner);

        // Acts as owner on their own farm — allowed.
        await enforcer.EnsureIsFarmMember(OwnerOfA, FarmA);

        // Same user, different farm — denied.
        var ex = await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => enforcer.EnsureIsFarmMember(OwnerOfA, FarmB));

        Assert.Contains(OwnerOfA.Value.ToString(), ex.Message);
        Assert.Contains(FarmB.Value.ToString(), ex.Message);
    }

    [Fact(DisplayName = "A worker cannot perform owner-only actions on their own farm")]
    public async Task Worker_CannotPerformOwnerOnlyActions()
    {
        var (enforcer, repo) = CreateSubject();
        repo.AddMembership(FarmA, WorkerOfA, AppRole.Worker);

        // The worker can still be detected as a member (read access).
        await enforcer.EnsureIsFarmMember(WorkerOfA, FarmA);

        // But cannot be promoted to an owner-only operation.
        var ex = await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => enforcer.EnsureIsOwner(WorkerOfA, FarmA));

        Assert.Contains("owner", ex.Message, StringComparison.OrdinalIgnoreCase);

        // And cannot verify logs on that farm (the single most sensitive
        // owner-only primitive in ShramSafal).
        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: FarmA,
            plotId: Guid.NewGuid(),
            cropCycleId: Guid.NewGuid(),
            operatorUserId: WorkerOfA,
            logDate: DateOnly.FromDateTime(DateTime.UtcNow),
            idempotencyKey: null,
            location: null,
            createdAtUtc: DateTime.UtcNow);
        repo.AddLog(log);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => enforcer.EnsureCanVerify(WorkerOfA, log.Id));
    }

    [Fact(DisplayName = "A SecondaryOwner can perform owner-only actions on their assigned farm")]
    public async Task SecondaryOwner_CanPerformOwnerOnlyActions()
    {
        var (enforcer, repo) = CreateSubject();
        repo.AddMembership(FarmA, SecondaryOwnerOfA, AppRole.SecondaryOwner);

        await enforcer.EnsureIsFarmMember(SecondaryOwnerOfA, FarmA);
        await enforcer.EnsureIsOwner(SecondaryOwnerOfA, FarmA);

        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: FarmA,
            plotId: Guid.NewGuid(),
            cropCycleId: Guid.NewGuid(),
            operatorUserId: SecondaryOwnerOfA,
            logDate: DateOnly.FromDateTime(DateTime.UtcNow),
            idempotencyKey: null,
            location: null,
            createdAtUtc: DateTime.UtcNow);
        repo.AddLog(log);

        await enforcer.EnsureCanVerify(SecondaryOwnerOfA, log.Id);
    }
}
