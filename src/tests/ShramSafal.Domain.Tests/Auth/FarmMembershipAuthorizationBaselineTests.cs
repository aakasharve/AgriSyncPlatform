using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Common;
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
///
/// <para>
/// Sub-plan 03 T-IGH-03-AUTHZ-RESULT (2026-05-01): the assertions
/// migrated from <c>Assert.ThrowsAsync&lt;UnauthorizedAccessException&gt;</c>
/// to inspecting <c>Result.IsSuccess == false</c> with the typed
/// <see cref="ShramSafalErrors.Forbidden"/> error. The structural
/// decision being locked in is unchanged — owners-only operations
/// still reject non-owners. Only the failure SHAPE moved from a
/// thrown exception to a typed Result.
/// </para>
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
        var allowed = await enforcer.EnsureIsFarmMember(OwnerOfA, FarmA);
        Assert.True(allowed.IsSuccess);

        // Same user, different farm — denied.
        var denied = await enforcer.EnsureIsFarmMember(OwnerOfA, FarmB);
        Assert.False(denied.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, denied.Error);
        Assert.Equal(ErrorKind.Forbidden, denied.Error.Kind);
    }

    [Fact(DisplayName = "A worker cannot perform owner-only actions on their own farm")]
    public async Task Worker_CannotPerformOwnerOnlyActions()
    {
        var (enforcer, repo) = CreateSubject();
        repo.AddMembership(FarmA, WorkerOfA, AppRole.Worker);

        // The worker can still be detected as a member (read access).
        var memberCheck = await enforcer.EnsureIsFarmMember(WorkerOfA, FarmA);
        Assert.True(memberCheck.IsSuccess);

        // But cannot be promoted to an owner-only operation.
        var ownerCheck = await enforcer.EnsureIsOwner(WorkerOfA, FarmA);
        Assert.False(ownerCheck.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, ownerCheck.Error);

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

        var verifyCheck = await enforcer.EnsureCanVerify(WorkerOfA, log.Id);
        Assert.False(verifyCheck.IsSuccess);
        Assert.Equal(ShramSafalErrors.Forbidden, verifyCheck.Error);
    }

    [Fact(DisplayName = "A SecondaryOwner can perform owner-only actions on their assigned farm")]
    public async Task SecondaryOwner_CanPerformOwnerOnlyActions()
    {
        var (enforcer, repo) = CreateSubject();
        repo.AddMembership(FarmA, SecondaryOwnerOfA, AppRole.SecondaryOwner);

        Assert.True((await enforcer.EnsureIsFarmMember(SecondaryOwnerOfA, FarmA)).IsSuccess);
        Assert.True((await enforcer.EnsureIsOwner(SecondaryOwnerOfA, FarmA)).IsSuccess);

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

        Assert.True((await enforcer.EnsureCanVerify(SecondaryOwnerOfA, log.Id)).IsSuccess);
    }
}
