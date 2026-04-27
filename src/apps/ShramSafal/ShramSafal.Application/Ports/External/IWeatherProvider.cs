using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports.External;

public interface IWeatherProvider
{
    bool IsConfigured { get; }

    Task<WeatherSnapshotDto> GetCurrentAsync(
        double latitude,
        double longitude,
        CancellationToken ct = default);

    Task<IReadOnlyList<DailyForecastDto>> GetForecastAsync(
        double latitude,
        double longitude,
        int days,
        CancellationToken ct = default);
}
