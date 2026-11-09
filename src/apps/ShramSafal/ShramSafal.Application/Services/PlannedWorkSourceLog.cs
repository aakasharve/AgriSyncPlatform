// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-4 (founder D-26, D-31): a task made from a log is no more visible than the log.
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Application.Services;

/// <summary>
/// ONE place that says whether the log a spoken task was made from is kept from THIS reader by its audience ("फक्त मी", or a
/// chosen few he is not among): <see cref="RecordVisibility.HiddenByAudience"/>, which already leaves the log's maker and the
/// primary account holder out of it. Asked by the pull, the REST reads, the door and the audit read, and handed to
/// <see cref="PlannedWorkVisibility.VisiblePlots"/>, so they cannot disagree.
/// </summary>
public static class PlannedWorkSourceLog
{
    public static bool HiddenFrom(RecordVisibility visibility, PlannedWork task)
    {
        ArgumentNullException.ThrowIfNull(visibility);
        ArgumentNullException.ThrowIfNull(task);
        return task.SourceDailyLogId is { } logId && visibility.HiddenByAudience(RecordKinds.DailyLog, logId);
    }
}
