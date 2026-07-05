using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B typed <b>DIRECT-farm_id</b> row (ADR 0023 §2 — weather is farm-level) — a
/// significant weather occurrence (rain start, heat spike, high wind…) for a farm: its
/// type, severity, time window, the signal readings, and an optional link to the day's log.
/// Carries its own <see cref="FarmId"/> (tenancy via direct RLS, like <c>FarmOperation</c>),
/// nullable <see cref="PlotId"/> context. System-generated weather data — no farmer
/// free-text, no PII → KEEP on erasure. No Provenance, no version chain.
/// </summary>
public sealed class WeatherEvent : Entity<Guid>
{
    private WeatherEvent() : base(Guid.Empty) { } // EF Core

    private WeatherEvent(
        Guid id, Guid farmId, Guid? plotId, WeatherEventType eventType,
        WeatherEventSeverity severity, DateTime tsStart, DateTime? tsEnd,
        string? signalsJson, string source, Guid? linkedLogId, DateTime createdAtUtc)
        : base(id)
    {
        if (string.IsNullOrWhiteSpace(source))
        {
            throw new ArgumentException(
                "source is required — a weather event must record its provenance.",
                nameof(source));
        }

        FarmId = farmId;
        PlotId = plotId;
        EventType = eventType;
        Severity = severity;
        TsStart = tsStart;
        TsEnd = tsEnd;
        SignalsJson = signalsJson;
        Source = source.Trim();
        LinkedLogId = linkedLogId;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid FarmId { get; private set; }                  // tenancy key — direct RLS
    public Guid? PlotId { get; private set; }                 // WeatherEvent.plotId context
    public WeatherEventType EventType { get; private set; }
    public WeatherEventSeverity Severity { get; private set; }
    public DateTime TsStart { get; private set; }             // window start (required)
    public DateTime? TsEnd { get; private set; }              // window end (nullable — an ongoing event has no end)
    public string? SignalsJson { get; private set; }         // serialized signals{rainMm,rainProb,temp,wind,humidity}; jsonb payload; null = none
    public string Source { get; private set; } = null!;      // e.g. "tomorrow.io_trigger" — required, non-blank
    public Guid? LinkedLogId { get; private set; }            // WeatherEvent.linkedLogId soft-ref; no FK
    public DateTime CreatedAtUtc { get; private set; }

    public static WeatherEvent Create(
        Guid id, Guid farmId, Guid? plotId, WeatherEventType eventType,
        WeatherEventSeverity severity, DateTime tsStart, DateTime? tsEnd,
        string? signalsJson, string source, Guid? linkedLogId, DateTime createdAtUtc)
        => new(id, farmId, plotId, eventType, severity, tsStart, tsEnd,
               signalsJson, source, linkedLogId, createdAtUtc);
}
