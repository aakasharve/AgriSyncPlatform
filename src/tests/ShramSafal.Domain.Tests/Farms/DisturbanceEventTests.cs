using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class DisturbanceEventTests
{
    private static readonly Guid Log = Guid.Parse("88888888-8888-8888-8888-888888888888");

    [Fact]
    public void Create_sets_all_fields()
    {
        var id = Guid.NewGuid();
        var weather = Guid.NewGuid();
        var when = new DateTime(2025, 10, 19, 6, 30, 0, DateTimeKind.Utc);

        var dist = DisturbanceEvent.Create(
            id, Log,
            scope: DisturbanceScope.Partial,
            reason: "पाऊस आला म्हणून फवारणी थांबवली",
            severity: DisturbanceSeverity.High,
            blockedSegmentsJson: "[\"input\",\"machinery\"]",
            weatherEventId: weather,
            createdAtUtc: when);

        Assert.Equal(id, dist.Id);
        Assert.Equal(Log, dist.DailyLogId);
        Assert.Equal(DisturbanceScope.Partial, dist.Scope);
        Assert.Equal("पाऊस आला म्हणून फवारणी थांबवली", dist.Reason);
        Assert.Equal(DisturbanceSeverity.High, dist.Severity);
        Assert.Equal("[\"input\",\"machinery\"]", dist.BlockedSegmentsJson);
        Assert.Equal(weather, dist.WeatherEventId);
        Assert.Equal(when, dist.CreatedAtUtc);
    }

    [Fact]
    public void Create_accepts_null_optionals()
    {
        var dist = DisturbanceEvent.Create(
            Guid.NewGuid(), Log,
            scope: DisturbanceScope.FullDay,
            reason: "labour no-show",
            severity: null,
            blockedSegmentsJson: null,
            weatherEventId: null,
            createdAtUtc: DateTime.UtcNow);

        Assert.Null(dist.Severity);
        Assert.Null(dist.BlockedSegmentsJson);
        Assert.Null(dist.WeatherEventId);
        Assert.Equal("labour no-show", dist.Reason);          // free-text always present
        Assert.Equal(DisturbanceScope.FullDay, dist.Scope);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_throws_on_blank_reason(string blank)
    {
        Assert.Throws<ArgumentException>(() => DisturbanceEvent.Create(
            Guid.NewGuid(), Log,
            scope: DisturbanceScope.FullDay,
            reason: blank,
            severity: null,
            blockedSegmentsJson: null,
            weatherEventId: null,
            createdAtUtc: DateTime.UtcNow));
    }

    [Fact]
    public void Create_trims_reason()
    {
        var dist = DisturbanceEvent.Create(
            Guid.NewGuid(), Log,
            scope: DisturbanceScope.Delayed,
            reason: "  pump broke  ",
            severity: null,
            blockedSegmentsJson: null,
            weatherEventId: null,
            createdAtUtc: DateTime.UtcNow);

        Assert.Equal("pump broke", dist.Reason);
    }
}
