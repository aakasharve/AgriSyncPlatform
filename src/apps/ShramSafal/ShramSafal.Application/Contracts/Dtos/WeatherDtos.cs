namespace ShramSafal.Application.Contracts.Dtos;

public sealed record WeatherSnapshotDto(
    string Provider,
    DateTime ObservedAtUtc,
    double TempC,
    double Humidity,
    double WindKph,
    double? WindGustKph,
    double PrecipMm,
    double CloudCoverPct,
    string ConditionText,
    string IconCode,
    double RainProbNext6h,
    double? UvIndex,
    double? SoilMoistureVolumetric0To10);

public sealed record DailyForecastDto(
    DateOnly Date,
    double TempMinC,
    double TempMaxC,
    double RainMm,
    double WindSpeedKph,
    double Humidity,
    string Condition);
