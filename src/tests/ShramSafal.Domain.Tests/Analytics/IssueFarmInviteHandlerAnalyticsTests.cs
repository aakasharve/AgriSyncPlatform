using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Analytics;

/// <summary>
/// MIS Integration Phase 2 Batch B3: verifies <see cref="IssueFarmInviteHandler"/>
/// emits an <c>invitation.issued</c> analytics event on the new-issue success path.
/// </summary>
public sealed class IssueFarmInviteHandlerAnalyticsTests
{
    [Fact]
    public async Task HandleAsync_OnNewIssue_EmitsInvitationIssuedEvent()
    {
        var analytics = new CapturingAnalyticsWriter();
        var farmRepo = new StubShramSafalRepository();
        var invRepo = new StubFarmInvitationRepository();

        var ownerUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var farmIdGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var now = new DateTime(2026, 4, 19, 12, 0, 0, DateTimeKind.Utc);

        var farm = Farm.Create(farmIdGuid, "Patil Farm", ownerUserId, now);
        farmRepo.SeedFarm(farm);

        var clock = new FixedClock(now);
        // Sub-plan 03 Task 8: handler no longer takes IAuthorizationEnforcer
        // — authorization moved to IssueFarmInviteAuthorizer (pipeline stage).
        var handler = new IssueFarmInviteHandler(
            invRepo, farmRepo, clock, analytics);

        var result = await handler.HandleAsync(
            new IssueFarmInviteCommand(new FarmId(farmIdGuid), new UserId(ownerUserId)));

        Assert.True(result.IsSuccess);
        Assert.Single(analytics.Events);

        var evt = analytics.Events[0];
        Assert.Equal(AnalyticsEventType.InvitationIssued, evt.EventType);
        Assert.Equal(ownerUserId, evt.ActorUserId!.Value.Value);
        Assert.Equal(farmIdGuid, evt.FarmId!.Value.Value);
        Assert.Equal("primaryowner", evt.ActorRole);
        Assert.Equal("v1", evt.SchemaVersion);
        Assert.Contains("invitationId", evt.PropsJson);
        Assert.Contains("inviteeRole", evt.PropsJson);
    }
}
