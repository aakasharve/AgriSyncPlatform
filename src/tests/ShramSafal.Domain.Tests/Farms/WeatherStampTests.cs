using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class WeatherStampTests
{
    private static readonly Guid Log = Guid.Parse("77777777-7777-7777-7777-777777777777");

    [Fact]
    public void Create_sets_all_fields()
    {
        var id = Guid.NewGuid();
        var plot = Guid.NewGuid();
        var local = new DateTime(2025, 10, 19, 12, 0, 0, DateTimeKind.Utc);
        var providerTs = new DateTime(2025, 10, 19, 11, 55, 0, DateTimeKind.Utc);
        var created = new DateTime(2025, 10, 19, 12, 0, 5, DateTimeKind.Utc);

        var stamp = WeatherStamp.Create(
            id, Log, plotId: plot,
            timestampLocal: local,
            timestampProvider: providerTs,
            provider: WeatherProvider.TomorrowIo,
            tempC: 28.5m,
            humidity: 65m,
            windKph: 12m,
            precipMm: 0m,
            cloudCoverPct: 40m,
            conditionText: "Partly Cloudy",
            iconCode: "partly_cloudy",
            rainProbNext6h: 20m,
            windGustKph: 18m,
            soilMoisture0To10: 33m,
            uvIndex: 6m,
            alertsJson: "[\"Heat Wave\"]",
            createdAtUtc: created);

        Assert.Equal(id, stamp.Id);
        Assert.Equal(Log, stamp.DailyLogId);
        Assert.Equal(plot, stamp.PlotId);
        Assert.Equal(local, stamp.TimestampLocal);
        Assert.Equal(providerTs, stamp.TimestampProvider);
        Assert.Equal(WeatherProvider.TomorrowIo, stamp.Provider);
        Assert.Equal(28.5m, stamp.TempC);
        Assert.Equal(65m, stamp.Humidity);
        Assert.Equal(12m, stamp.WindKph);
        Assert.Equal(0m, stamp.PrecipMm);
        Assert.Equal(40m, stamp.CloudCoverPct);
        Assert.Equal("Partly Cloudy", stamp.ConditionText);
        Assert.Equal("partly_cloudy", stamp.IconCode);
        Assert.Equal(20m, stamp.RainProbNext6h);
        Assert.Equal(18m, stamp.WindGustKph);
        Assert.Equal(33m, stamp.SoilMoisture0To10);
        Assert.Equal(6m, stamp.UvIndex);
        Assert.Equal("[\"Heat Wave\"]", stamp.AlertsJson);
        Assert.Equal(created, stamp.CreatedAtUtc);
    }

    [Fact]
    public void Create_accepts_null_optionals()
    {
        var stamp = WeatherStamp.Create(
            Guid.NewGuid(), Log, plotId: null,
            timestampLocal: DateTime.UtcNow,
            timestampProvider: DateTime.UtcNow,
            provider: WeatherProvider.Mock,
            tempC: 22m,
            humidity: 50m,
            windKph: 8m,
            precipMm: 1.2m,
            cloudCoverPct: 75m,
            conditionText: "Cloudy",
            iconCode: "cloudy",
            rainProbNext6h: 60m,
            windGustKph: null,
            soilMoisture0To10: null,
            uvIndex: null,
            alertsJson: null,
            createdAtUtc: DateTime.UtcNow);

        Assert.Null(stamp.PlotId);
        Assert.Null(stamp.WindGustKph);
        Assert.Null(stamp.SoilMoisture0To10);
        Assert.Null(stamp.UvIndex);
        Assert.Null(stamp.AlertsJson);
        Assert.Equal(WeatherProvider.Mock, stamp.Provider);
        Assert.Equal(22m, stamp.TempC);
        Assert.Equal(50m, stamp.Humidity);
        Assert.Equal(8m, stamp.WindKph);
        Assert.Equal(1.2m, stamp.PrecipMm);
        Assert.Equal(75m, stamp.CloudCoverPct);
        Assert.Equal("Cloudy", stamp.ConditionText);
        Assert.Equal("cloudy", stamp.IconCode);
        Assert.Equal(60m, stamp.RainProbNext6h);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_throws_on_blank_conditionText(string blank)
    {
        Assert.Throws<ArgumentException>(() => WeatherStamp.Create(
            Guid.NewGuid(), Log, plotId: null,
            timestampLocal: DateTime.UtcNow,
            timestampProvider: DateTime.UtcNow,
            provider: WeatherProvider.OpenWeather,
            tempC: 22m,
            humidity: 50m,
            windKph: 8m,
            precipMm: 0m,
            cloudCoverPct: 10m,
            conditionText: blank,
            iconCode: "clear",
            rainProbNext6h: 5m,
            windGustKph: null,
            soilMoisture0To10: null,
            uvIndex: null,
            alertsJson: null,
            createdAtUtc: DateTime.UtcNow));
    }

    [Fact]
    public void Create_trims_conditionText()
    {
        var stamp = WeatherStamp.Create(
            Guid.NewGuid(), Log, plotId: null,
            timestampLocal: DateTime.UtcNow,
            timestampProvider: DateTime.UtcNow,
            provider: WeatherProvider.OpenWeather,
            tempC: 30m,
            humidity: 40m,
            windKph: 5m,
            precipMm: 0m,
            cloudCoverPct: 0m,
            conditionText: "  Sunny  ",
            iconCode: "clear",
            rainProbNext6h: 0m,
            windGustKph: null,
            soilMoisture0To10: null,
            uvIndex: null,
            alertsJson: null,
            createdAtUtc: DateTime.UtcNow);

        Assert.Equal("Sunny", stamp.ConditionText);
    }
}
