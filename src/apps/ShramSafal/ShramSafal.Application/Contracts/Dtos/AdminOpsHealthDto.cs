namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Admin Ops Dashboard — real-time operational health snapshot.
/// Sources: analytics.events (ai.invocation, api.error, client.error) only; no cross-farm read.
/// Refreshes every time the endpoint is called — no materialized view lag.
/// </summary>
public sealed record AdminOpsHealthDto(
    // Voice/AI pipeline health (last 24 hours). Read by the phone app's old admin page (plan CR-2d, D4); a failed
    // read answers 500, never zeros.
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

    // spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 5, C29). R9, counted live on every call from
    // analytics.events: api.error rows in the 60 minutes before the request; a breach above 30. The nightly
    // mis.alert_r9/r10 views are no longer read. R10 (voice) is not here: it reads farm by farm and has its own
    // route, GET /shramsafal/admin/ops/voice-check, which this polled route never opens (C11).
    AlertCheckDto AlertR9,

    // When this snapshot was computed
    DateTime ComputedAtUtc,

    // Obsolete (C30): sent only because the phone app's old admin page still reads them. They stay for go-live
    // (decided in plan CR-2d) and leave after it, with that page, in a phone release. Use AlertR9 instead.
    // = AlertR9.State == "breach".
    bool? ApiErrorSpike = null,

    // Obsolete (C30): same reason and same exit. Always null: the voice check lives on its own route
    // (GET /shramsafal/admin/ops/voice-check).
    bool? VoiceDegraded = null);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 5, C29). One alert check, judged live.
/// <list type="bullet">
/// <item><see cref="Rule"/>: <c>"R9"</c> (server errors) or <c>"R10"</c> (voice recordings failing).</item>
/// <item><see cref="State"/>: <c>"breach"</c>, <c>"clear"</c> or <c>"not_judged"</c>. Not judged is never clear.</item>
/// <item><see cref="Counted"/>: the figure the rule judges (R9: server errors; R10: failed recordings), null when
/// it could not be counted. <see cref="OutOf"/>: R10's finished recordings; always null for R9.</item>
/// <item><see cref="WindowStartUtc"/> to <see cref="WindowEndUtc"/>: the counted window; the end is the moment it
/// was counted.</item>
/// <item><see cref="Reason"/>: why a check is not judged (<c>"too_few_recordings"</c>,
/// <c>"too_many_farms_for_live_count"</c>, <c>"farm_list_unreadable"</c>); null when judged.</item>
/// </list>
/// </summary>
public sealed record AlertCheckDto(
    string Rule,
    string State,
    int? Counted,
    int? OutOf,
    DateTime WindowStartUtc,
    DateTime WindowEndUtc,
    string? Reason);

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
