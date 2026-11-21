// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9, N1-C1 code half)
namespace ShramSafal.Application.Ports;

/// <summary>
/// Whether the analytics store is recording right now. <see cref="IsRecording"/> false means every number read from
/// <c>analytics.events</c> is not measured (<see cref="NotRecordingReason"/>), never 0, an empty list or a frozen date.
/// <see cref="StoppedAtUtc"/> is when recording stopped, where known (null otherwise, and always null while recording).
/// </summary>
public sealed record AnalyticsRecording(bool IsRecording, DateTime? StoppedAtUtc)
{
    /// <summary>The reason every analytics-backed number carries while the store is not recording.</summary>
    public const string NotRecordingReason = "analytics_not_recording";

    /// <summary>The store is recording.</summary>
    public static readonly AnalyticsRecording Recording = new(true, null);

    /// <summary><see cref="NotRecordingReason"/> while not recording; null while recording.</summary>
    public string? NotMeasuredReason => IsRecording ? null : NotRecordingReason;
}

/// <summary>
/// The server telling "nothing happened" apart from "nothing was recorded": analytics writes are swallowed by design
/// (<c>AnalyticsWriter</c>), so when they fail every reader still succeeds and finds no rows. One check, cached up to
/// <see cref="AnalyticsRecordingRules.CacheFor"/>; the readers' answers carry its result.
/// </summary>
public interface IAnalyticsRecordingCheck
{
    /// <summary>
    /// The current state. <paramref name="readerUserId"/> is named in the audit row of the one cross-farm read the check
    /// makes (the newest entry). A failed read escapes (500), never "recording".
    /// </summary>
    Task<AnalyticsRecording> CheckAsync(Guid readerUserId, CancellationToken ct);
}

/// <summary>
/// The recording rule, pure. Recording = the current UTC month's partition of <c>analytics.events</c> exists, AND, when
/// <c>ssf.daily_logs</c> has an entry in the last <see cref="RecentEntryWindow"/>, the newest server-written
/// <c>log.created</c> event is not more than <see cref="MaxLag"/> older than the newest entry (every saved entry writes
/// one <c>log.created</c>, a server-only event).
/// </summary>
public static class AnalyticsRecordingRules
{
    /// <summary>The newest <c>log.created</c> may trail the newest entry by at most this.</summary>
    public static readonly TimeSpan MaxLag = TimeSpan.FromMinutes(60);

    /// <summary>The lag is judged only when an entry was saved in this window.</summary>
    public static readonly TimeSpan RecentEntryWindow = TimeSpan.FromHours(24);

    /// <summary>A check is reused for at most this long.</summary>
    public static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);

    /// <summary>
    /// The state from the three facts. A missing month partition refuses every insert from the first instant of the
    /// month (UTC), so that is when recording stopped. A lagging <c>log.created</c> stopped at the newest one written
    /// (null when there is none).
    /// </summary>
    public static AnalyticsRecording Decide(
        bool currentMonthPartitionExists, DateTime? newestLogCreatedUtc, DateTime? newestEntryUtc, DateTime nowUtc)
    {
        if (!currentMonthPartitionExists)
        {
            return new AnalyticsRecording(false, new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc));
        }

        if (newestEntryUtc is { } entry
            && entry >= nowUtc - RecentEntryWindow
            && (newestLogCreatedUtc is not { } logged || entry - logged > MaxLag))
        {
            return new AnalyticsRecording(false, newestLogCreatedUtc);
        }

        return AnalyticsRecording.Recording;
    }
}
