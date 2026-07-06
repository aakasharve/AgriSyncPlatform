using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.GetFarmWeather;

/// <summary>
/// Weather for arbitrary coordinates (e.g. the caller's device GPS) when a farm
/// has no canonical centre yet. Unlike <see cref="GetFarmWeatherHandler"/> this
/// does NO farm read / membership / RLS work — it validates the coordinates and
/// calls the weather provider directly. Auth is enforced at the endpoint edge.
/// </summary>
public sealed class GetCoordinateWeatherHandler(IWeatherProvider weatherProvider)
{
    public async Task<Result<WeatherSnapshotDto>> HandleAsync(
        GetCoordinateWeatherCommand command,
        CancellationToken ct = default)
    {
        if (!IsValidCoordinate(command.Latitude, command.Longitude))
        {
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.InvalidCommand);
        }

        if (!weatherProvider.IsConfigured)
        {
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.WeatherProviderNotConfigured);
        }

        try
        {
            var snapshot = await weatherProvider.GetCurrentAsync(command.Latitude, command.Longitude, ct);
            return Result.Success(snapshot);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            // Upstream provider failure (quota/timeout/bad payload) → 503, not a 500.
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.WeatherProviderUnavailable);
        }
    }

    public async Task<Result<IReadOnlyList<DailyForecastDto>>> HandleAsync(
        GetCoordinateForecastCommand command,
        CancellationToken ct = default)
    {
        if (!IsValidCoordinate(command.Latitude, command.Longitude))
        {
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.InvalidCommand);
        }

        if (!weatherProvider.IsConfigured)
        {
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.WeatherProviderNotConfigured);
        }

        var days = command.Days <= 0 ? 5 : Math.Min(command.Days, 7);
        try
        {
            var forecast = await weatherProvider.GetForecastAsync(command.Latitude, command.Longitude, days, ct);
            return Result.Success(forecast);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.WeatherProviderUnavailable);
        }
    }

    private static bool IsValidCoordinate(double latitude, double longitude) =>
        latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;
}
