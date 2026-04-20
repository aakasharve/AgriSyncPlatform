using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.UseCases.Memberships.ExitMembership;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Analytics;

/// <summary>
/// MIS Integration Phase 2 Batch B5: verifies <see cref="ExitMembershipHandler"/>
/// emits a <c>membership.revoked</c> analytics event on self-exit success.
/// </summary>
public sealed class ExitMembershipHandlerAnalyticsTests
{
    [Fact]
    public async Task HandleAsync_OnSelfExit_EmitsMembershipRevokedEvent()
    {
        var analytics = new CapturingAnalyticsWriter();
        var repo = new StubShramSafalRepository();

        var farmIdGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var ownerUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var workerUserId = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var now = new DateTime(2026, 4, 19, 12, 0, 0, DateTimeKind.Utc);

        // Seed two memberships so the worker's exit does not hit invariant I3.
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), farmIdGuid, ownerUserId, AppRole.PrimaryOwner, now));
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), farmIdGuid, workerUserId, AppRole.Worker, now));

        var handler = new ExitMembershipHandler(repo, new FixedClock(now), analytics);

        var result = await handler.HandleAsync(
            new FarmId(farmIdGuid),
            new UserId(workerUserId));

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.AlreadyExited);
        Assert.Single(analytics.Events);

        var evt = analytics.Events[0];
        Assert.Equal(AnalyticsEventType.MembershipRevoked, evt.EventType);
        Assert.Equal(workerUserId, evt.ActorUserId!.Value.Value);
        Assert.Equal(farmIdGuid, evt.FarmId!.Value.Value);
        Assert.Equal("worker", evt.ActorRole);
        Assert.Equal("v1", evt.SchemaVersion);
        Assert.Contains("exitedByUserId", evt.PropsJson);
        Assert.Contains("farmId", evt.PropsJson);
    }
}
