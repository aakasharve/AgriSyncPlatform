using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// Track B typed CHILD of <c>daily_logs</c> (ADR 0023 §1/§2) — a day's-work disruption
/// (rain stopped spraying, labour no-show, pump broke): its scale, the farmer's free-text
/// reason, severity, what it blocked, and an optional weather-spine link. EXISTS-join child:
/// plain <see cref="DailyLogId"/> FK, no farm_id, no Provenance, no version chain.
/// <para>The free-text <see cref="Reason"/> is <b>PRESERVED</b> per founder directive
/// D-FREETEXT-PRESERVE-2026-06-29 — KEEP on erasure, never scrubbed. §3.2g structured
/// enhancements (typed <see cref="Cause"/> / <see cref="AffectedScope"/> / <see cref="Impact"/> /
/// <see cref="ResolvedStatus"/>) added in B2.7 — all optional, non-breaking. The free-text
/// <see cref="Impact"/> is likewise PRESERVED on erasure like <see cref="Reason"/>.</para>
/// </summary>
public sealed class DisturbanceEvent : Entity<Guid>
{
    private DisturbanceEvent() : base(Guid.Empty) { } // EF Core

    private DisturbanceEvent(
        Guid id, Guid dailyLogId, DisturbanceScope scope, string reason,
        DisturbanceSeverity? severity, string? blockedSegmentsJson, Guid? weatherEventId,
        DateTime createdAtUtc,
        DisturbanceCause? cause, AffectedScope? affectedScope,
        string? impact, ResolvedStatus? resolvedStatus)
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
        Cause = cause;
        AffectedScope = affectedScope;
        Impact = impact;
        ResolvedStatus = resolvedStatus;
    }

    public Guid DailyLogId { get; private set; }
    public DisturbanceScope Scope { get; private set; }              // required — the disruption's scale
    public string Reason { get; private set; } = null!;             // farmer's words — preserved free-text
    public DisturbanceSeverity? Severity { get; private set; }
    public string? BlockedSegmentsJson { get; private set; }        // serialized LogSegment[] (jsonb); null = none
    public Guid? WeatherEventId { get; private set; }               // soft-ref to the weather spine; no FK
    public DateTime CreatedAtUtc { get; private set; }

    // §3.2g structured enhancements (B2.7) — all optional, non-breaking.
    public DisturbanceCause? Cause { get; private set; }            // typed cause; null = unspecified
    public AffectedScope? AffectedScope { get; private set; }       // event | bucket | whole_day; null = unspecified
    public string? Impact { get; private set; }                     // farmer's free-text impact — PRESERVED like Reason
    public ResolvedStatus? ResolvedStatus { get; private set; }     // ongoing | resolved_same_day | carried_over

    public static DisturbanceEvent Create(
        Guid id, Guid dailyLogId, DisturbanceScope scope, string reason,
        DisturbanceSeverity? severity, string? blockedSegmentsJson, Guid? weatherEventId,
        DateTime createdAtUtc,
        DisturbanceCause? cause = null, AffectedScope? affectedScope = null,
        string? impact = null, ResolvedStatus? resolvedStatus = null)
        => new(id, dailyLogId, scope, reason, severity, blockedSegmentsJson,
               weatherEventId, createdAtUtc, cause, affectedScope, impact, resolvedStatus);
}
