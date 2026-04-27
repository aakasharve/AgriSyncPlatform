namespace ShramSafal.Application.UseCases.Farms.GetFarmWeather;

public sealed record GetFarmWeatherCommand(Guid FarmId, Guid CallerUserId);

public sealed record GetFarmForecastCommand(Guid FarmId, Guid CallerUserId, int Days);
