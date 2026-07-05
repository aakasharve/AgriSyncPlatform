using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class IrrigationEntryTests
{
    private static readonly Guid Log = Guid.Parse("55555555-5555-5555-5555-555555555555");

    [Theory]
    [InlineData(IrrigationRole.SprayCarrier)]
    [InlineData(IrrigationRole.Irrigation)]
    [InlineData(IrrigationRole.Fertigation)]
    public void Create_sets_role_and_fields(IrrigationRole role)
    {
        var e = IrrigationEntry.Create(Guid.NewGuid(), Log, role, false, "drip", "borewell", 4m, 1000m, null,
            new DateTime(2025, 10, 23, 0, 0, 0, DateTimeKind.Utc));
        Assert.Equal(Log, e.DailyLogId);
        Assert.Equal(role, e.Role);
        Assert.False(e.WeatherAdjusted);
        Assert.Equal("drip", e.Method);
        Assert.Equal("borewell", e.Source);
        Assert.Equal(4m, e.DurationHours);
        Assert.Equal(1000m, e.WaterVolumeLitres);
        Assert.Null(e.LinkedActivityId);
    }

    [Fact]
    public void Create_allows_null_optionals_and_weatherAdjusted()
    {
        var e = IrrigationEntry.Create(Guid.NewGuid(), Log, IrrigationRole.Irrigation, true, null, null, null, null, null, DateTime.UtcNow);
        Assert.True(e.WeatherAdjusted);
        Assert.Null(e.Method);
        Assert.Null(e.Source);
        Assert.Null(e.DurationHours);
        Assert.Null(e.WaterVolumeLitres);
        Assert.Null(e.LinkedActivityId);
    }

    [Fact]
    public void Create_carries_linked_activity_for_spray_carrier()
    {
        var linked = Guid.NewGuid();
        var e = IrrigationEntry.Create(Guid.NewGuid(), Log, IrrigationRole.SprayCarrier, false, null, null, null, 1000m, linked, DateTime.UtcNow);
        Assert.Equal(linked, e.LinkedActivityId);
        Assert.Equal(IrrigationRole.SprayCarrier, e.Role);
    }
}
