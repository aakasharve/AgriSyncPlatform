using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B typed CHILD of <c>daily_logs</c> (ADR 0023 §1/§2) — the immutable weather
/// snapshot at the moment a log was made (the §4.3 verbal-vs-API divergence baseline).
/// Own table (table-vs-owned resolved to own-table), EXISTS-join child: plain
/// <see cref="DailyLogId"/> FK, no farm_id, no Provenance, no version.
/// <para>System-generated weather readings — no farmer free-text, no PII → KEEP on
/// erasure.</para>
/// </summary>
public sealed class WeatherStamp : Entity<Guid>
{
    private WeatherStamp() : base(Guid.Empty) { } // EF Core

    private WeatherStamp(
        Guid id, Guid dailyLogId, Guid? plotId, DateTime timestampLocal,
        DateTime timestampProvider, WeatherProvider provider, decimal tempC,
        decimal humidity, decimal windKph, decimal precipMm, decimal cloudCoverPct,
        string conditionText, string iconCode, decimal rainProbNext6h,
        decimal? windGustKph, decimal? soilMoisture0To10, decimal? uvIndex,
        string? alertsJson, DateTime createdAtUtc)
        : base(id)
    {
        if (string.IsNullOrWhiteSpace(conditionText))
        {
            throw new ArgumentException("conditionText is required.", nameof(conditionText));
        }

        DailyLogId = dailyLogId;
        PlotId = plotId;
        TimestampLocal = timestampLocal;
        TimestampProvider = timestampProvider;
        Provider = provider;
        TempC = tempC;
        Humidity = humidity;
        WindKph = windKph;
        PrecipMm = precipMm;
        CloudCoverPct = cloudCoverPct;
        ConditionText = conditionText.Trim();
        IconCode = iconCode;
        RainProbNext6h = rainProbNext6h;
        WindGustKph = windGustKph;
        SoilMoisture0To10 = soilMoisture0To10;
        UvIndex = uvIndex;
        AlertsJson = alertsJson;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid DailyLogId { get; private set; }              // parent — EXISTS-join tenancy
    public Guid? PlotId { get; private set; }                 // WeatherStamp.plotId context
    public DateTime TimestampLocal { get; private set; }
    public DateTime TimestampProvider { get; private set; }
    public WeatherProvider Provider { get; private set; }
    public decimal TempC { get; private set; }                // core observed
    public decimal Humidity { get; private set; }
    public decimal WindKph { get; private set; }
    public decimal PrecipMm { get; private set; }
    public decimal CloudCoverPct { get; private set; }
    public string ConditionText { get; private set; } = null!;
    public string IconCode { get; private set; } = null!;     // may be a code; assigned as-is
    public decimal RainProbNext6h { get; private set; }       // decision-grade
    public decimal? WindGustKph { get; private set; }
    public decimal? SoilMoisture0To10 { get; private set; }
    public decimal? UvIndex { get; private set; }
    public string? AlertsJson { get; private set; }           // serialized string[] (jsonb payload)
    public DateTime CreatedAtUtc { get; private set; }

    public static WeatherStamp Create(
        Guid id, Guid dailyLogId, Guid? plotId, DateTime timestampLocal,
        DateTime timestampProvider, WeatherProvider provider, decimal tempC,
        decimal humidity, decimal windKph, decimal precipMm, decimal cloudCoverPct,
        string conditionText, string iconCode, decimal rainProbNext6h,
        decimal? windGustKph, decimal? soilMoisture0To10, decimal? uvIndex,
        string? alertsJson, DateTime createdAtUtc)
        => new(id, dailyLogId, plotId, timestampLocal, timestampProvider, provider,
               tempC, humidity, windKph, precipMm, cloudCoverPct, conditionText,
               iconCode, rainProbNext6h, windGustKph, soilMoisture0To10, uvIndex,
               alertsJson, createdAtUtc);
}
