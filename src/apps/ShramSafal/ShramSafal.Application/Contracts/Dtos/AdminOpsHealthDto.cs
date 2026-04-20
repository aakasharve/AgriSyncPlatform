namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Admin Ops Dashboard — real-time operational health snapshot.
/// Sources: analytics.events (ai.invocation, api.error, client.error).
/// Refreshes every time the endpoint is called — no materialized view lag.
/// </summary>
public sealed record AdminOpsHealthDto(
    // Voice/AI pipeline health (last 24 hours)
    int VoiceInvocations24h,
    int VoiceFailures24h,
    decimal VoiceFailureRatePct,
    decimal VoiceAvgLatencyMs,
    decimal VoiceP95LatencyMs,

    // API errors (last 2 hours — live signal)
    // Empty until RequestObservabilityMiddleware is deployed (Ops Phase 1)
    IReadOnlyList<OpsErrorEventDto> RecentErrors,

    // Top farms by error count (last 24 hours)
    IReadOnlyList<OpsFarmErrorDto> TopSufferingFarms,

    // Alert breach state (from mis.alert_r9/r10 — may be null if views not yet created)
    bool? ApiErrorSpike,
    bool? VoiceDegraded,

    // When this snapshot was computed
    DateTime ComputedAtUtc);

public sealed record OpsErrorEventDto(
    string EventType,
    string Endpoint,
    int? StatusCode,
    int? LatencyMs,
    Guid? FarmId,
    DateTime OccurredAtUtc);

public sealed record OpsFarmErrorDto(
    Guid FarmId,
    int ErrorCount,
    int SyncErrors,
    int LogErrors,
    int VoiceErrors,
    DateTime LastErrorAt);
