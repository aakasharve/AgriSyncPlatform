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

    // API errors (last 2 hours — live signal), each with its farm and where the farm came from
    // (spec company-mis-real-numbers-2026-11-15, plan CR-2e Task 1, C3).
    IReadOnlyList<OpsErrorEventDto> RecentErrors,

    // Farms with two or more problems in the last 24 hours, by the one farm rule and the one problem rule
    // (plan CR-2e Task 2, C1). At most 10, by count then latest.
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
    string? UsualCause,
    // spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1). FarmId is the farm the row belongs to or the
    // farm the request named (AdminErrorFarm.FarmSql); FarmSource says which: "event", "address", or null when no
    // farm was named (a sync upload names none).
    string? FarmSource = null);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2). One farm with repeated problems in the last
/// 24 hours. ErrorCount is every problem; the four area counts split that same total (ProblemArea): SyncErrors =
/// syncing, LogErrors = saving entries, VoiceErrors = voice, OtherErrors = everything else.
/// </summary>
public sealed record OpsFarmErrorDto(
    Guid FarmId,
    int ErrorCount,
    int SyncErrors,
    int LogErrors,
    int VoiceErrors,
    int OtherErrors,
    DateTime LastErrorAt);
