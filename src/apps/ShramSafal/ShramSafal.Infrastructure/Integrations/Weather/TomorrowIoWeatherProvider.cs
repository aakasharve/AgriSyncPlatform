using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Integrations.Weather;

public sealed class TomorrowIoWeatherProvider(
    IHttpClientFactory httpClientFactory,
    IOptions<TomorrowIoOptions> options,
    ILogger<TomorrowIoWeatherProvider> logger) : IWeatherProvider
{
    private const string HttpClientName = "TomorrowIoWeather";

    private readonly TomorrowIoOptions _options = options.Value;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_options.ApiKey);

    public async Task<WeatherSnapshotDto> GetCurrentAsync(
        double latitude,
        double longitude,
        CancellationToken ct = default)
    {
        EnsureConfigured();

        var client = httpClientFactory.CreateClient(HttpClientName);
        var location = FormatLocation(latitude, longitude);
        var url = $"{_options.BaseUrl.TrimEnd('/')}/weather/realtime?location={Uri.EscapeDataString(location)}&units=metric&apikey={Uri.EscapeDataString(_options.ApiKey)}";

        using var response = await client.GetAsync(url, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            logger.LogWarning("Tomorrow.io realtime call failed with {Status}: {Body}", response.StatusCode, body);
            throw new HttpRequestException($"Tomorrow.io realtime call failed with HTTP {(int)response.StatusCode}.");
        }

        var payload = await response.Content.ReadFromJsonAsync<RealtimePayload>(JsonOpts, ct);
        if (payload is null || payload.Data is null || payload.Data.Values is null)
        {
            throw new InvalidOperationException("Tomorrow.io returned an empty realtime payload.");
        }

        var values = payload.Data.Values;
        var observedAt = ParseUtc(payload.Data.Time) ?? DateTime.UtcNow;
        var (conditionText, iconCode) = MapWeatherCode(values.WeatherCode);

        return new WeatherSnapshotDto(
            Provider: "tomorrow.io",
            ObservedAtUtc: observedAt,
            TempC: values.Temperature ?? 0,
            Humidity: values.Humidity ?? 0,
            WindKph: MsToKph(values.WindSpeed),
            WindGustKph: values.WindGust is null ? null : MsToKph(values.WindGust),
            PrecipMm: values.PrecipitationIntensity ?? 0,
            CloudCoverPct: values.CloudCover ?? 0,
            ConditionText: conditionText,
            IconCode: iconCode,
            RainProbNext6h: values.PrecipitationProbability ?? 0,
            UvIndex: values.UvIndex,
            SoilMoistureVolumetric0To10: values.SoilMoistureVolumetric0To10);
    }

    public async Task<IReadOnlyList<DailyForecastDto>> GetForecastAsync(
        double latitude,
        double longitude,
        int days,
        CancellationToken ct = default)
    {
        EnsureConfigured();

        var client = httpClientFactory.CreateClient(HttpClientName);
        var location = FormatLocation(latitude, longitude);
        var url = $"{_options.BaseUrl.TrimEnd('/')}/weather/forecast?location={Uri.EscapeDataString(location)}&timesteps=1d&units=metric&apikey={Uri.EscapeDataString(_options.ApiKey)}";

        using var response = await client.GetAsync(url, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            logger.LogWarning("Tomorrow.io forecast call failed with {Status}: {Body}", response.StatusCode, body);
            throw new HttpRequestException($"Tomorrow.io forecast call failed with HTTP {(int)response.StatusCode}.");
        }

        var payload = await response.Content.ReadFromJsonAsync<ForecastPayload>(JsonOpts, ct);
        var daily = payload?.Timelines?.Daily ?? Array.Empty<DailyEntry>();
        var take = Math.Min(Math.Max(1, days), daily.Count);

        var results = new List<DailyForecastDto>(take);
        for (var i = 0; i < take; i++)
        {
            var entry = daily[i];
            var values = entry.Values ?? new DailyValues();
            var date = ParseDateOnly(entry.Time) ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(i));
            var (conditionText, _) = MapWeatherCode(values.WeatherCodeMax ?? values.WeatherCodeAvg);

            results.Add(new DailyForecastDto(
                Date: date,
                TempMinC: values.TemperatureMin ?? 0,
                TempMaxC: values.TemperatureMax ?? 0,
                RainMm: values.PrecipitationSum ?? values.RainAccumulationSum ?? 0,
                WindSpeedKph: MsToKph(values.WindSpeedAvg),
                Humidity: values.HumidityAvg ?? 0,
                Condition: conditionText));
        }

        return results;
    }

    private void EnsureConfigured()
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException("Tomorrow.io API key is not configured.");
        }
    }

    private static string FormatLocation(double lat, double lng)
        => string.Create(CultureInfo.InvariantCulture, $"{lat:F6},{lng:F6}");

    private static double MsToKph(double? metresPerSecond) =>
        metresPerSecond is null ? 0 : Math.Round(metresPerSecond.Value * 3.6, 2);

    private static DateTime? ParseUtc(string? iso) =>
        DateTime.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var utc)
            ? utc
            : null;

    private static DateOnly? ParseDateOnly(string? iso) =>
        ParseUtc(iso) is { } dt ? DateOnly.FromDateTime(dt) : null;

    private static (string Text, string Icon) MapWeatherCode(int? code) =>
        code switch
        {
            1000 => ("Clear", "clear_day"),
            1100 => ("Mostly Clear", "partly_cloudy"),
            1101 => ("Partly Cloudy", "partly_cloudy"),
            1102 => ("Mostly Cloudy", "cloudy"),
            1001 => ("Cloudy", "cloudy"),
            2000 => ("Fog", "fog"),
            2100 => ("Light Fog", "fog"),
            4000 => ("Drizzle", "rain"),
            4001 => ("Rain", "rain"),
            4200 => ("Light Rain", "rain"),
            4201 => ("Heavy Rain", "storm"),
            5000 => ("Snow", "snow"),
            5001 => ("Flurries", "snow"),
            5100 => ("Light Snow", "snow"),
            5101 => ("Heavy Snow", "snow"),
            8000 => ("Thunderstorm", "storm"),
            _ => ("Unknown", "cloudy"),
        };

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private sealed record RealtimePayload([property: JsonPropertyName("data")] RealtimeData? Data);
    private sealed record RealtimeData(
        [property: JsonPropertyName("time")] string? Time,
        [property: JsonPropertyName("values")] RealtimeValues? Values);

    private sealed record RealtimeValues(
        [property: JsonPropertyName("temperature")] double? Temperature,
        [property: JsonPropertyName("humidity")] double? Humidity,
        [property: JsonPropertyName("windSpeed")] double? WindSpeed,
        [property: JsonPropertyName("windGust")] double? WindGust,
        [property: JsonPropertyName("precipitationIntensity")] double? PrecipitationIntensity,
        [property: JsonPropertyName("precipitationProbability")] double? PrecipitationProbability,
        [property: JsonPropertyName("cloudCover")] double? CloudCover,
        [property: JsonPropertyName("weatherCode")] int? WeatherCode,
        [property: JsonPropertyName("uvIndex")] double? UvIndex,
        [property: JsonPropertyName("soilMoistureVolumetric0To10")] double? SoilMoistureVolumetric0To10);

    private sealed record ForecastPayload([property: JsonPropertyName("timelines")] Timelines? Timelines);
    private sealed record Timelines([property: JsonPropertyName("daily")] IReadOnlyList<DailyEntry>? Daily);
    private sealed record DailyEntry(
        [property: JsonPropertyName("time")] string? Time,
        [property: JsonPropertyName("values")] DailyValues? Values);

    private sealed record DailyValues
    {
        [JsonPropertyName("temperatureMin")] public double? TemperatureMin { get; init; }
        [JsonPropertyName("temperatureMax")] public double? TemperatureMax { get; init; }
        [JsonPropertyName("precipitationSum")] public double? PrecipitationSum { get; init; }
        [JsonPropertyName("rainAccumulationSum")] public double? RainAccumulationSum { get; init; }
        [JsonPropertyName("windSpeedAvg")] public double? WindSpeedAvg { get; init; }
        [JsonPropertyName("humidityAvg")] public double? HumidityAvg { get; init; }
        [JsonPropertyName("weatherCodeMax")] public int? WeatherCodeMax { get; init; }
        [JsonPropertyName("weatherCodeAvg")] public int? WeatherCodeAvg { get; init; }
    }
}
