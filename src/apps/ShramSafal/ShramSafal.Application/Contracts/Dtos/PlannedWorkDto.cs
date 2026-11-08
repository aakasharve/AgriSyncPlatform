// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24c, D-29, D-30).
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// One task or reminder as ONE reader may see it (pull and REST). <see cref="Plots"/> holds only the plot rows he sees.
/// Dates travel as <c>yyyy-MM-dd</c> and the time as <c>HH:mm</c>; every word list travels as its NAME. Every field is
/// words (D-24a, P4): the headcount, quantity and pay words stand for nothing else. Additive: an older phone never reads it.
/// </summary>
public sealed record PlannedWorkDto(
    Guid Id,
    Guid FarmId,
    string Title,
    string Scope,
    string? PlannedDate,
    string? LooseWhen,
    string? PlannedTime,
    Guid? AssigneeUserId,
    string? CrewText,
    int? ExpectedHeadcount,
    string? QuantityText,
    string? PayMode,
    string? Note,
    string Status,
    string Source,
    string? SourceKind,
    Guid? SourceDailyLogId,
    Guid? SourceLogTaskId,
    Guid? SourcePlotId,
    string RecordedOn,
    IReadOnlyList<Guid> LinkedDailyLogIds,
    Guid CreatedByUserId,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc,
    DateTime? SeenAtUtc,
    DateTime? AcceptedAtUtc,
    DateTime? DoneAtUtc,
    Guid? DoneByUserId,
    DateTime? CancelledAtUtc,
    Guid? CancelledByUserId,
    string? CancelReason,
    IReadOnlyList<PlannedWorkPlotDto> Plots,
    string? ConfirmationState = null)
{
    /// <summary>
    /// The task with only the plot rows in <paramref name="visiblePlots"/> (what this reader may see).
    /// <paramref name="statusOf"/> gives the standing of a linked log (<c>null</c> = not found): lane L8c-3's
    /// <see cref="ConfirmationState"/> is read from it, for the task and for each plot row from its own logs.
    /// </summary>
    public static PlannedWorkDto From(
        PlannedWork work, IReadOnlyCollection<Guid> visiblePlots, Func<Guid, ShramSafal.Domain.Logs.VerificationStatus?>? statusOf = null)
    {
        Func<Guid, ShramSafal.Domain.Logs.VerificationStatus?> standing = statusOf ?? (_ => null);
        return new(
            work.Id,
            (Guid)work.FarmId,
            work.Title,
            work.Scope.ToString(),
            work.PlannedDate?.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            work.LooseWhen?.ToString(),
            work.PlannedTime?.ToString("HH':'mm", System.Globalization.CultureInfo.InvariantCulture),
            work.AssigneeUserId,
            work.CrewText,
            work.ExpectedHeadcount,
            work.QuantityText,
            work.PayMode?.ToString(),
            work.Note,
            work.Status.ToString(),
            work.Source.ToString(),
            work.SourceKind?.ToString(),
            work.SourceDailyLogId,
            work.SourceLogTaskId,
            work.SourcePlotId,
            work.RecordedOn.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            work.LinkedDailyLogIds,
            work.CreatedByUserId,
            work.CreatedAtUtc,
            work.ModifiedAtUtc,
            work.SeenAtUtc,
            work.AcceptedAtUtc,
            work.DoneAtUtc,
            work.DoneByUserId,
            work.CancelledAtUtc,
            work.CancelledByUserId,
            work.CancelReason,
            work.LivePlots
                .Where(p => visiblePlots.Contains(p.PlotId))
                .OrderBy(p => p.PlotId)
                .Select(p => new PlannedWorkPlotDto(
                    p.PlotId, p.Status.ToString(), p.DoneAtUtc, p.DoneByUserId, p.LinkedDailyLogIds,
                    PlannedWorkConfirmation.Of(p.LinkedDailyLogIds.ToList(), standing)))
                .ToList(),
            PlannedWorkConfirmation.Of(work.LinkedDailyLogIds.ToList(), standing));
    }
}

/// <summary>One plot of a task (pending or done; a dropped plot is no longer on the task).</summary>
public sealed record PlannedWorkPlotDto(
    Guid PlotId,
    string Status,
    DateTime? DoneAtUtc,
    Guid? DoneByUserId,
    IReadOnlyList<Guid> LinkedDailyLogIds,
    string? ConfirmationState = null);
