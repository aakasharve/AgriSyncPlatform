using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B typed CHILD of <c>daily_logs</c> (ADR 0023 §1/§2) — a day's-work disruption
/// (rain stopped spraying, labour no-show, pump broke): its scale, the farmer's free-text
/// reason, severity, what it blocked, and an optional weather-spine link. EXISTS-join child:
/// plain <see cref="DailyLogId"/> FK, no farm_id, no Provenance, no version chain.
/// <para>The free-text <see cref="Reason"/> is <b>PRESERVED</b> per founder directive
/// D-FREETEXT-PRESERVE-2026-06-29 — KEEP on erasure, never scrubbed. §3.2g structured
/// enhancements (typed cause / affectedScope / impact / resolvedStatus) DEFERRED to B2.7.</para>
/// </summary>
public sealed class DisturbanceEvent : Entity<Guid>
{
    private DisturbanceEvent() : base(Guid.Empty) { } // EF Core

    private DisturbanceEvent(
        Guid id, Guid dailyLogId, DisturbanceScope scope, string reason,
        DisturbanceSeverity? severity, string? blockedSegmentsJson, Guid? weatherEventId,
        DateTime createdAtUtc)
        : base(id)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException(
                "reason is required — the disturbance free-text is the load-bearing content.",
                nameof(reason));
        }

        DailyLogId = dailyLogId;
        Scope = scope;
        Reason = reason.Trim();
        Severity = severity;
        BlockedSegmentsJson = blockedSegmentsJson;
        WeatherEventId = weatherEventId;
        CreatedAtUtc = createdAtUtc;
    }

    public Guid DailyLogId { get; private set; }
    public DisturbanceScope Scope { get; private set; }              // required — the disruption's scale
    public string Reason { get; private set; } = null!;             // farmer's words — preserved free-text
    public DisturbanceSeverity? Severity { get; private set; }
    public string? BlockedSegmentsJson { get; private set; }        // serialized LogSegment[] (jsonb); null = none
    public Guid? WeatherEventId { get; private set; }               // soft-ref to the weather spine; no FK
    public DateTime CreatedAtUtc { get; private set; }

    public static DisturbanceEvent Create(
        Guid id, Guid dailyLogId, DisturbanceScope scope, string reason,
        DisturbanceSeverity? severity, string? blockedSegmentsJson, Guid? weatherEventId,
        DateTime createdAtUtc)
        => new(id, dailyLogId, scope, reason, severity, blockedSegmentsJson,
               weatherEventId, createdAtUtc);
}
