namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Wrapper that every admin endpoint returns.
/// Frontend <DataFreshnessChip> reads Source + LastRefreshedUtc.
/// </summary>
public sealed record AdminResponseDto<T>(
    T Data,
    AdminMetaDto Meta);

public sealed record AdminMetaDto(
    /// <summary>live | live-aggregated | materialized</summary>
    string Source,
    string Window,
    DateTime LastRefreshedUtc,
    int TtlSeconds)
{
    /// <summary>
    /// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9): <c>"analytics_not_recording"</c> when the analytics
    /// store is not recording, so every number on the answer read from <c>analytics.events</c> is not measured (its 0,
    /// empty list or date is not a fact); null when it is recording or the answer reads nothing from analytics.
    /// </summary>
    public string? AnalyticsNotMeasuredReason { get; init; }

    /// <summary>When analytics recording stopped, where known (with <see cref="AnalyticsNotMeasuredReason"/>).</summary>
    public DateTime? AnalyticsStoppedAtUtc { get; init; }

    /// <summary>This meta carrying the analytics recording state of <paramref name="recording"/>.</summary>
    public AdminMetaDto WithAnalytics(Ports.AnalyticsRecording recording) => this with
    {
        AnalyticsNotMeasuredReason = recording.NotMeasuredReason,
        AnalyticsStoppedAtUtc = recording.IsRecording ? null : recording.StoppedAtUtc,
    };
}
