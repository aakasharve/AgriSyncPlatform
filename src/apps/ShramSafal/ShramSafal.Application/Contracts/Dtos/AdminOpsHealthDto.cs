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
    DateTime OccurredAtUtc,
    // 2026-08-30 — the identity of the failure, not just its status code.
    // All nullable: rows written before this deploy have none of these keys,
    // and props->>'errorCode' on an absent key is SQL NULL. A non-nullable
    // member would force a fabricated default onto every historical row, and
    // analytics.events is append-only so there is no backfill.
    string? ErrorCode,
    string? WorkKept,
    string? Message,
    string? AppVersion,
    // Resolved from ErrorExplanations at READ time, not stored — so improved
    // wording reaches old rows too. `Message` is what we said at the time;
    // `Meaning` / `UsualCause` are what we say now.
    string? Meaning,
    string? UsualCause);

public sealed record OpsFarmErrorDto(
    Guid FarmId,
    int ErrorCount,
    int SyncErrors,
    int LogErrors,
    int VoiceErrors,
    DateTime LastErrorAt);
