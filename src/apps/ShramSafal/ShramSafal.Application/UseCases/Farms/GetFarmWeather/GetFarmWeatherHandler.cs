using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.GetFarmWeather;

public sealed class GetFarmWeatherHandler(
    IShramSafalRepository repository,
    IWeatherProvider weatherProvider)
{
    public async Task<Result<WeatherSnapshotDto>> HandleAsync(
        GetFarmWeatherCommand command,
        CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty || command.CallerUserId == Guid.Empty)
        {
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.FarmNotFound);
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.CallerUserId, ct);
        if (!isMember)
        {
            // Return FarmNotFound (not Forbidden) to avoid leaking existence across tenants.
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.FarmNotFound);
        }

        if (farm.CanonicalCentreLat is null || farm.CanonicalCentreLng is null)
        {
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.FarmCentreMissing);
        }

        if (!weatherProvider.IsConfigured)
        {
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.WeatherProviderNotConfigured);
        }

        try
        {
            var snapshot = await weatherProvider.GetCurrentAsync(
                farm.CanonicalCentreLat.Value,
                farm.CanonicalCentreLng.Value,
                ct);

            return Result.Success(snapshot);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            // Upstream provider failure (quota/timeout/bad payload) → 503, not a 500.
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.WeatherProviderUnavailable);
        }
    }

    public async Task<Result<IReadOnlyList<DailyForecastDto>>> HandleAsync(
        GetFarmForecastCommand command,
        CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty || command.CallerUserId == Guid.Empty)
        {
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.FarmNotFound);
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.CallerUserId, ct);
        if (!isMember)
        {
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.FarmNotFound);
        }

        if (farm.CanonicalCentreLat is null || farm.CanonicalCentreLng is null)
        {
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.FarmCentreMissing);
        }

        if (!weatherProvider.IsConfigured)
        {
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.WeatherProviderNotConfigured);
        }

        var days = command.Days <= 0 ? 5 : Math.Min(command.Days, 7);
        try
        {
            var forecast = await weatherProvider.GetForecastAsync(
                farm.CanonicalCentreLat.Value,
                farm.CanonicalCentreLng.Value,
                days,
                ct);

            return Result.Success(forecast);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.WeatherProviderUnavailable);
        }
    }
}
