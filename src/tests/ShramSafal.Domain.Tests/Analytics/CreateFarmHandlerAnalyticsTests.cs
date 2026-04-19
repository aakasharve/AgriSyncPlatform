using AgriSync.BuildingBlocks.Analytics;
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using Xunit;

namespace ShramSafal.Domain.Tests.Analytics;

/// <summary>
/// MIS Integration Phase 2 Batch B1: verifies <see cref="CreateFarmHandler"/>
/// emits a <c>farm.created</c> analytics event at commit time.
/// </summary>
public sealed class CreateFarmHandlerAnalyticsTests
{
    [Fact]
    public async Task HandleAsync_OnSuccess_EmitsFarmCreatedEvent()
    {
        var analytics = new CapturingAnalyticsWriter();
        var repo = new StubShramSafalRepository();
        var farmIdSeed = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        var membershipIdSeed = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        var ids = new SequentialIdGenerator(farmIdSeed, membershipIdSeed);
        var clock = new FixedClock(new DateTime(2026, 4, 19, 12, 0, 0, DateTimeKind.Utc));

        var handler = new CreateFarmHandler(repo, ids, clock, analytics);

        var ownerUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var result = await handler.HandleAsync(
            new CreateFarmCommand(Name: "Patil Farm", OwnerUserId: ownerUserId));

        Assert.True(result.IsSuccess);
        Assert.Single(analytics.Events);

        var evt = analytics.Events[0];
        Assert.Equal(AnalyticsEventType.FarmCreated, evt.EventType);
        Assert.Equal(ownerUserId, evt.ActorUserId!.Value.Value);
        Assert.Equal(farmIdSeed, evt.FarmId!.Value.Value);
        Assert.Equal("primaryowner", evt.ActorRole);
        Assert.Equal("manual", evt.Trigger);
        Assert.Equal("v1", evt.SchemaVersion);
        Assert.Contains("farmName", evt.PropsJson);
        Assert.Contains("primaryOwnerUserId", evt.PropsJson);
    }
}
