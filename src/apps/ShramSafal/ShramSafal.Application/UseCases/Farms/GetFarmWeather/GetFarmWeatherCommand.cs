namespace ShramSafal.Application.UseCases.Farms.GetFarmWeather;

public sealed record GetFarmWeatherCommand(Guid FarmId, Guid CallerUserId);

public sealed record GetFarmForecastCommand(Guid FarmId, Guid CallerUserId, int Days);

// Coordinate-based weather — used when a farm has no drawn centre, so weather
// is fetched for arbitrary (device-GPS) coordinates rather than the farm anchor.
public sealed record GetCoordinateWeatherCommand(double Latitude, double Longitude);

public sealed record GetCoordinateForecastCommand(double Latitude, double Longitude, int Days);
