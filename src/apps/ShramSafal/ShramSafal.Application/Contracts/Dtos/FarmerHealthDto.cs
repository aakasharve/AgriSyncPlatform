namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Response root for <c>GET /admin/farmer-health/{farmId}</c>, the one-farm page.
/// </summary>
/// <remarks>
/// <para>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 3 as rewritten by C21). Platform owners only (C13).
/// Every block is real or absent with a reason (doctrine P4); nothing here is a placeholder.
/// </para>
/// <list type="bullet">
/// <item><see cref="FarmerName"/>: the owner display name from <c>public.users</c> (C23); null when none. <see cref="FarmName"/>: the farm name.</item>
/// <item><see cref="Phone"/>: the farm owner's phone from <c>public.users</c>; null when the owner has none
///   recorded, never a dash.</item>
/// <item><see cref="Score"/>: always null. The farm score is not computed here (P2 stays "Not built yet", plan
///   H-SCORE).</item>
/// <item><see cref="Timeline"/>: the 14 India days ending today, oldest first.</item>
/// <item><see cref="SyncState"/>, <see cref="AiHealth"/>: null for a caller without <c>ops.errors</c> /
///   <c>ops.voice</c> read (a platform owner holds both).</item>
/// <item><see cref="Verifications"/>, <see cref="WorkerSummary"/>: read as the app login through row-level
///   security for this farm only.</item>
/// </list>
/// </remarks>
public sealed record FarmerHealthDto(
    Guid FarmId,
    string? FarmerName,
    string? Phone,
    FarmerHealthScoreBreakdownDto? Score,
    IReadOnlyList<FarmerHealthTimelineDto> Timeline,
    FarmerHealthSyncStateDto? SyncState,
    FarmerHealthAiHealthDto? AiHealth,
    FarmerHealthVerificationCountsDto Verifications,
    IReadOnlyList<FarmerHealthWorkerSummaryDto> WorkerSummary,
    string FarmName)
{
    /// <summary>
    /// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9): <c>"analytics_not_recording"</c> when the analytics
    /// store is not recording; then the timeline's four closure columns and its errors per day (read from
    /// <c>analytics.events</c>) are not measured, not zeros. Null when recording.
    /// </summary>
    public string? AnalyticsNotMeasuredReason { get; init; }

    /// <summary>When analytics recording stopped, where known (with <see cref="AnalyticsNotMeasuredReason"/>).</summary>
    public DateTime? AnalyticsStoppedAtUtc { get; init; }
}
