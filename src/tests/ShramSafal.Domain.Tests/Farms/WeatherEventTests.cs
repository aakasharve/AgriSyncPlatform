using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class WeatherEventTests
{
    private static readonly Guid Farm = Guid.Parse("99999999-9999-9999-9999-999999999999");

    [Fact]
    public void Create_sets_all_fields()
    {
        var id = Guid.NewGuid();
        var plot = Guid.NewGuid();
        var log = Guid.NewGuid();
        var start = new DateTime(2025, 10, 19, 14, 0, 0, DateTimeKind.Utc);
        var end = new DateTime(2025, 10, 19, 15, 30, 0, DateTimeKind.Utc);

        var ev = WeatherEvent.Create(
            id, Farm,
            plotId: plot,
            eventType: WeatherEventType.HeavyRain,
            severity: WeatherEventSeverity.High,
            tsStart: start,
            tsEnd: end,
            signalsJson: "{\"rainMm\":42}",
            source: "tomorrow.io_trigger",
            linkedLogId: log,
            createdAtUtc: start);

        Assert.Equal(id, ev.Id);
        Assert.Equal(Farm, ev.FarmId);
        Assert.Equal(plot, ev.PlotId);
        Assert.Equal(WeatherEventType.HeavyRain, ev.EventType);
        Assert.Equal(WeatherEventSeverity.High, ev.Severity);
        Assert.Equal(start, ev.TsStart);
        Assert.Equal(end, ev.TsEnd);
        Assert.Equal("{\"rainMm\":42}", ev.SignalsJson);
        Assert.Equal("tomorrow.io_trigger", ev.Source);
        Assert.Equal(log, ev.LinkedLogId);
        Assert.Equal(start, ev.CreatedAtUtc);
    }

    [Fact]
    public void Create_accepts_null_optionals()
    {
        var start = new DateTime(2025, 11, 1, 9, 0, 0, DateTimeKind.Utc);

        var ev = WeatherEvent.Create(
            Guid.NewGuid(), Farm,
            plotId: null,
            eventType: WeatherEventType.DrySpell,
            severity: WeatherEventSeverity.Low,
            tsStart: start,
            tsEnd: null,
            signalsJson: null,
            source: "tomorrow.io_trigger",
            linkedLogId: null,
            createdAtUtc: start);

        Assert.Null(ev.PlotId);
        Assert.Null(ev.TsEnd);
        Assert.Null(ev.SignalsJson);
        Assert.Null(ev.LinkedLogId);
        Assert.Equal(Farm, ev.FarmId);                       // tenancy key always present
        Assert.Equal("tomorrow.io_trigger", ev.Source);
        Assert.Equal(WeatherEventType.DrySpell, ev.EventType);
        Assert.Equal(WeatherEventSeverity.Low, ev.Severity);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_throws_on_blank_source(string blank)
    {
        Assert.Throws<ArgumentException>(() => WeatherEvent.Create(
            Guid.NewGuid(), Farm,
            plotId: null,
            eventType: WeatherEventType.HighWind,
            severity: WeatherEventSeverity.Medium,
            tsStart: DateTime.UtcNow,
            tsEnd: null,
            signalsJson: null,
            source: blank,
            linkedLogId: null,
            createdAtUtc: DateTime.UtcNow));
    }

    [Fact]
    public void Create_trims_source()
    {
        var ev = WeatherEvent.Create(
            Guid.NewGuid(), Farm,
            plotId: null,
            eventType: WeatherEventType.RainStart,
            severity: WeatherEventSeverity.Medium,
            tsStart: DateTime.UtcNow,
            tsEnd: null,
            signalsJson: null,
            source: "  tomorrow.io  ",
            linkedLogId: null,
            createdAtUtc: DateTime.UtcNow);

        Assert.Equal("tomorrow.io", ev.Source);
    }
}
