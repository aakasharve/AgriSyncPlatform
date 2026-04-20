using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.UseCases.Farms.CreatePlot;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Analytics;

/// <summary>
/// MIS Integration Phase 2 Batch B2: verifies <see cref="CreatePlotHandler"/>
/// emits a <c>plot.created</c> analytics event at commit time.
/// </summary>
public sealed class CreatePlotHandlerAnalyticsTests
{
    [Fact]
    public async Task HandleAsync_OnSuccess_EmitsPlotCreatedEvent()
    {
        var analytics = new CapturingAnalyticsWriter();
        var repo = new StubShramSafalRepository();

        var ownerUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var farmIdGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var now = new DateTime(2026, 4, 19, 12, 0, 0, DateTimeKind.Utc);
        var farm = Farm.Create(farmIdGuid, "Patil Farm", ownerUserId, now);
        repo.SeedFarm(farm);
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), farmIdGuid, ownerUserId, AppRole.PrimaryOwner, now));

        var plotId = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var ids = new SequentialIdGenerator(plotId);
        var clock = new FixedClock(now);

        var handler = new CreatePlotHandler(repo, ids, clock, new AllowEntitlementPolicy(), analytics);

        var result = await handler.HandleAsync(
            new CreatePlotCommand(
                FarmId: farmIdGuid,
                Name: "North Block",
                AreaInAcres: 2.5m,
                ActorUserId: ownerUserId));

        Assert.True(result.IsSuccess);
        Assert.Single(analytics.Events);

        var evt = analytics.Events[0];
        Assert.Equal(AnalyticsEventType.PlotCreated, evt.EventType);
        Assert.Equal(ownerUserId, evt.ActorUserId!.Value.Value);
        Assert.Equal(farmIdGuid, evt.FarmId!.Value.Value);
        Assert.Equal("primaryowner", evt.ActorRole);
        Assert.Equal("manual", evt.Trigger);
        Assert.Equal("v1", evt.SchemaVersion);
        Assert.Contains("plotId", evt.PropsJson);
        Assert.Contains("areaInAcres", evt.PropsJson);
    }
}
