using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Farms.GetFarmWeather;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class GetCoordinateWeatherHandlerTests
{
    private sealed class FakeWeatherProvider : IWeatherProvider
    {
        public bool IsConfigured { get; init; } = true;
        public int LastDays { get; private set; }

        public Task<WeatherSnapshotDto> GetCurrentAsync(double latitude, double longitude, CancellationToken ct = default)
            => Task.FromResult(new WeatherSnapshotDto(
                "tomorrow.io", DateTime.UtcNow, 25, 50, 5, null, 0, 10, "Clear", "1000", 0, null, null));

        public Task<IReadOnlyList<DailyForecastDto>> GetForecastAsync(double latitude, double longitude, int days, CancellationToken ct = default)
        {
            LastDays = days;
            return Task.FromResult<IReadOnlyList<DailyForecastDto>>(new[]
            {
                new DailyForecastDto(DateOnly.FromDateTime(DateTime.UtcNow), 20, 30, 0, 5, 50, "Sunny"),
            });
        }
    }

    [Fact]
    public async Task Current_valid_coords_returns_snapshot()
    {
        var handler = new GetCoordinateWeatherHandler(new FakeWeatherProvider());
        var result = await handler.HandleAsync(new GetCoordinateWeatherCommand(20.1, 73.7));
        result.IsSuccess.Should().BeTrue();
        result.Value!.Provider.Should().Be("tomorrow.io");
    }

    [Theory]
    [InlineData(91, 0)]
    [InlineData(-91, 0)]
    [InlineData(0, 181)]
    [InlineData(0, -181)]
    public async Task Current_out_of_range_coords_returns_invalid_command(double lat, double lon)
    {
        var handler = new GetCoordinateWeatherHandler(new FakeWeatherProvider());
        var result = await handler.HandleAsync(new GetCoordinateWeatherCommand(lat, lon));
        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.InvalidCommand");
    }

    [Fact]
    public async Task Current_provider_not_configured_returns_provider_error()
    {
        var handler = new GetCoordinateWeatherHandler(new FakeWeatherProvider { IsConfigured = false });
        var result = await handler.HandleAsync(new GetCoordinateWeatherCommand(20.1, 73.7));
        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.WeatherProviderNotConfigured");
    }

    [Fact]
    public async Task Forecast_clamps_days_to_max_7()
    {
        var provider = new FakeWeatherProvider();
        var handler = new GetCoordinateWeatherHandler(provider);
        var result = await handler.HandleAsync(new GetCoordinateForecastCommand(20.1, 73.7, 30));
        result.IsSuccess.Should().BeTrue();
        provider.LastDays.Should().Be(7);
    }

    [Fact]
    public async Task Forecast_zero_days_defaults_to_5()
    {
        var provider = new FakeWeatherProvider();
        var handler = new GetCoordinateWeatherHandler(provider);
        await handler.HandleAsync(new GetCoordinateForecastCommand(20.1, 73.7, 0));
        provider.LastDays.Should().Be(5);
    }
}
