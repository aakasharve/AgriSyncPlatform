using System.Text.Json;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Analytics;

public sealed class AnalyticsWriterTests
{
    [Fact]
    public async Task EmitAsync_PersistsAllFields_IncludingJsonProps()
    {
        await using var context = CreateInMemoryContext(nameof(EmitAsync_PersistsAllFields_IncludingJsonProps));
        var writer = new AnalyticsWriter(context, NullLogger<AnalyticsWriter>.Instance);

        var userId = UserId.New();
        var farmId = FarmId.New();
        var ownerAccountId = OwnerAccountId.New();
        var occurredAt = DateTime.UtcNow;
        var deviceAt = occurredAt.AddMinutes(-3);
        var props = JsonSerializer.Serialize(new { logId = Guid.NewGuid(), deltaDaysVsSchedule = 2 });

        var evt = new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.LogCreated,
            OccurredAtUtc: occurredAt,
            ActorUserId: userId,
            FarmId: farmId,
            OwnerAccountId: ownerAccountId,
            ActorRole: "operator",
            Trigger: "voice",
            DeviceOccurredAtUtc: deviceAt,
            SchemaVersion: "v1",
            PropsJson: props);

        await writer.EmitAsync(evt);

        await using var verify = CreateInMemoryContext(nameof(EmitAsync_PersistsAllFields_IncludingJsonProps));
        var stored = await verify.Events.SingleAsync();

        Assert.Equal(evt.EventId, stored.EventId);
        Assert.Equal(AnalyticsEventType.LogCreated, stored.EventType);
        Assert.Equal(occurredAt, stored.OccurredAtUtc);
        Assert.Equal(userId, stored.ActorUserId);
        Assert.Equal(farmId, stored.FarmId);
        Assert.Equal(ownerAccountId, stored.OwnerAccountId);
        Assert.Equal("operator", stored.ActorRole);
        Assert.Equal("voice", stored.Trigger);
        Assert.Equal(deviceAt, stored.DeviceOccurredAtUtc);
        Assert.Equal("v1", stored.SchemaVersion);
        Assert.Equal(props, stored.PropsJson);
    }

    [Fact]
    public async Task EmitAsync_SwallowsDbFailure_SoDomainWriteNeverBreaks()
    {
        await using var context = CreateInMemoryContext(nameof(EmitAsync_SwallowsDbFailure_SoDomainWriteNeverBreaks));
        // Dispose before use so any DB call throws ObjectDisposedException.
        await context.DisposeAsync();

        var writer = new AnalyticsWriter(context, NullLogger<AnalyticsWriter>.Instance);

        var evt = NewMinimalEvent();

        var ex = await Record.ExceptionAsync(() => writer.EmitAsync(evt));

        Assert.Null(ex);
    }

    [Fact]
    public async Task EmitAsync_PropagatesCancellation_ButStillDoesNotFailDomain()
    {
        await using var context = CreateInMemoryContext(nameof(EmitAsync_PropagatesCancellation_ButStillDoesNotFailDomain));
        var writer = new AnalyticsWriter(context, NullLogger<AnalyticsWriter>.Instance);

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => writer.EmitAsync(NewMinimalEvent(), cts.Token));
    }

    [Fact]
    public async Task EmitManyAsync_PersistsAllEvents()
    {
        await using var context = CreateInMemoryContext(nameof(EmitManyAsync_PersistsAllEvents));
        var writer = new AnalyticsWriter(context, NullLogger<AnalyticsWriter>.Instance);

        var batch = new[] { NewMinimalEvent(), NewMinimalEvent(), NewMinimalEvent() };

        await writer.EmitManyAsync(batch);

        await using var verify = CreateInMemoryContext(nameof(EmitManyAsync_PersistsAllEvents));
        Assert.Equal(3, await verify.Events.CountAsync());
    }

    private static AnalyticsDbContext CreateInMemoryContext(string databaseName)
    {
        var options = new DbContextOptionsBuilder<AnalyticsDbContext>()
            .UseInMemoryDatabase(databaseName)
            .Options;
        return new AnalyticsDbContext(options);
    }

    private static AnalyticsEvent NewMinimalEvent() => new(
        EventId: Guid.NewGuid(),
        EventType: AnalyticsEventType.UserRegistered,
        OccurredAtUtc: DateTime.UtcNow,
        ActorUserId: null,
        FarmId: null,
        OwnerAccountId: null,
        ActorRole: "system",
        Trigger: "system",
        DeviceOccurredAtUtc: null,
        SchemaVersion: "v1",
        PropsJson: "{}");
}
