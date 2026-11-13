// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-79 "unfinished work from daily logs", D-78; R14; P3, P4, P11).
using System.Text.Json;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.PlannedWork;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using SharedFarmId = AgriSync.SharedKernel.Contracts.Ids.FarmId;

namespace ShramSafal.Application.UseCases.Logs.Content;

/// <summary>
/// "Unfinished work from daily logs" (D-79, R14): a piece of work saved <see cref="ExecutionStatus.Partial"/>,
/// <see cref="ExecutionStatus.Delayed"/> or <see cref="ExecutionStatus.Skipped"/> leaves ONE reminder behind, the log speaker's own
/// (source <c>LogLeftover</c>, kind <c>Leftover</c>). Written by the SERVER in the same unit of work as the content or line that said it
/// (P1: they commit together or not at all), so every app version gets it, from three doors:
/// <list type="number">
/// <item><b>A log task line</b> saved with one of those three words (<see cref="StageForTaskAsync"/>, called by <c>AddLogTaskHandler</c>,
/// the only handler that writes a non-Completed line).</item>
/// <item><b>The document of what he said</b> (<see cref="StageFromContentAsync"/>, called by <c>LogContentStaging</c> for a create and for
/// a revision): a <c>cropActivities</c> item whose <c>status</c> is <c>partial</c> ("आज फवारणी अर्धी झाली"), or that carries an
/// <c>executionStatus</c> of Partial, Delayed or Skipped. The document has no other unfinished word, so none is invented.</item>
/// <item><b>The voice parse a 1.0.17 phone confirms</b> (<see cref="StageFromJobAsync"/>), which sends no document: the same item rule,
/// each item keyed by its place in that confirmed parse.</item>
/// </list>
///
/// <list type="bullet">
/// <item><b>His own, handed to nobody.</b> Created by the log's speaker with no assignee: it grants no authority (D-24) and goes to no one
/// without his tap (D-78). Who else sees it is the owner's setting (<c>ReminderVisibility</c>), and the log's own audience always holds.</item>
/// <item><b>Replay-safe, never deleted.</b> The id is <see cref="PlannedWorkIds.ForLeftover"/> (log, task, "leftover"): a second add of the
/// same line, a replay, or a revision of the log finds the reminder by id and leaves it alone, even one he cancelled. A later change of the
/// log (Partial to Completed) never removes it (P3): he removes it himself with one tap ("काढा", a cancel with a reason).</item>
/// <item><b>Only what was said (P4).</b> The title is the work's own words (the line's activity, the item's work type or title), nothing
/// more: no note (it may carry an amount), no date (no cue was given), no assignee, no transcript, no audio (D-31). The place is the log's own
/// plots; a log with no plot (the whole farm) makes a reminder with no plot.</item>
/// <item><b>Audit.</b> One <c>PlannedWorkCreatedFromLeftover</c> row, by the person who saved it, with the four fields and no words.</item>
/// </list>
/// </summary>
public static class LogLeftovers
{
    /// <summary>The audit step of a leftover (the action is <c>PlannedWorkCreatedFromLeftover</c>).</summary>
    public const string CreatedFromLeftoverStep = "CreatedFromLeftover";

    /// <summary>Is a task saved with this status unfinished work?</summary>
    public static bool IsLeftover(ExecutionStatus status) =>
        status is ExecutionStatus.Partial or ExecutionStatus.Delayed or ExecutionStatus.Skipped;

    /// <summary>Is this word (an item's <c>status</c> or <c>executionStatus</c>) an unfinished one?</summary>
    public static bool IsLeftoverWord(string? word) =>
        string.Equals(word?.Trim(), "partial", StringComparison.OrdinalIgnoreCase)
        || string.Equals(word?.Trim(), "delayed", StringComparison.OrdinalIgnoreCase)
        || string.Equals(word?.Trim(), "skipped", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Stages the reminder for a log task LINE saved Partial, Delayed or Skipped (staged, never saved: the caller's own save commits it
    /// with the line). Nothing is made for a finished line, or when the reminder already exists.
    /// </summary>
    /// <returns><c>true</c> when a reminder was staged.</returns>
    public static async Task<bool> StageForTaskAsync(
        IShramSafalRepository repository, DailyLog log, LogTask task, DateTime nowUtc, PlannedWorkCaller caller, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(task);
        return IsLeftover(task.ExecutionStatus)
            && await StageAsync(repository, log, PlannedWorkIds.ForLeftover(log.Id, task.Id), task.Id, task.ActivityType, nowUtc, caller, ct);
    }

    /// <summary>
    /// Stages the reminders for the unfinished <c>cropActivities</c> of <paramref name="content"/> (a create's document or a revision's).
    /// Each is keyed by the id of the task line the item stands for (<see cref="LogTaskProjection"/>), whether or not that line is written.
    /// </summary>
    public static async Task StageFromContentAsync(
        IShramSafalRepository repository, DailyLog log, JsonElement content, DateTime nowUtc, PlannedWorkCaller caller, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);
        ArgumentNullException.ThrowIfNull(caller);
        if (content.ValueKind != JsonValueKind.Object
            || !content.TryGetProperty("cropActivities", out var items)
            || items.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        var lines = LogTaskProjection.Project(log.Id, content)
            .Where(l => l.Bucket == "cropActivities")
            .ToDictionary(l => l.ItemId, l => l, StringComparer.Ordinal);
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object
                || !item.TryGetProperty("id", out var id)
                || id.ValueKind != JsonValueKind.String
                || id.GetString() is not { Length: > 0 } itemId
                || !IsUnfinished(item)
                || !lines.TryGetValue(itemId, out var line))
            {
                continue;
            }

            await StageAsync(repository, log, PlannedWorkIds.ForLeftover(log.Id, line.TaskId), line.TaskId, line.ActivityType, nowUtc, caller, ct);
        }
    }

    /// <summary>
    /// A 1.0.17 phone confirms a spoken log through its voice parse and sends no content: the parse's unfinished <c>cropActivities</c> are
    /// the source, each keyed by its place in the confirmed parse (which never changes). Only ever called when the create carried no
    /// content at all.
    /// </summary>
    public static async Task StageFromJobAsync(
        IShramSafalRepository repository, DailyLog log, JsonElement normalizedResult, DateTime nowUtc, PlannedWorkCaller caller, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);
        ArgumentNullException.ThrowIfNull(caller);
        if (normalizedResult.ValueKind != JsonValueKind.Object
            || !normalizedResult.TryGetProperty("cropActivities", out var items)
            || items.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        var place = 0;
        foreach (var item in items.EnumerateArray())
        {
            var index = place++;
            if (item.ValueKind != JsonValueKind.Object || !IsUnfinished(item) || ActivityOf(item) is not { } activity)
            {
                continue;
            }

            await StageAsync(repository, log, PlannedWorkIds.ForLeftoverJobItem(log.Id, index), null, activity, nowUtc, caller, ct);
        }
    }

    private static bool IsUnfinished(JsonElement item) =>
        (item.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String && string.Equals(status.GetString()?.Trim(), "partial", StringComparison.OrdinalIgnoreCase))
        || (item.TryGetProperty("executionStatus", out var execution) && execution.ValueKind == JsonValueKind.String && IsLeftoverWord(execution.GetString()));

    /// <summary>The work's own words, the way <see cref="LogTaskProjection"/> reads an activity: its first work type, else its title.</summary>
    private static string? ActivityOf(JsonElement item)
    {
        if (item.TryGetProperty("workTypes", out var types) && types.ValueKind == JsonValueKind.Array && types.GetArrayLength() > 0
            && types[0].ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(types[0].GetString()))
        {
            return types[0].GetString();
        }

        return item.TryGetProperty("title", out var title) && title.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(title.GetString())
            ? title.GetString()
            : null;
    }

    private static async Task<bool> StageAsync(
        IShramSafalRepository repository,
        DailyLog log,
        Guid id,
        Guid? logTaskId,
        string activity,
        DateTime nowUtc,
        PlannedWorkCaller caller,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);
        ArgumentNullException.ThrowIfNull(caller);
        if (string.IsNullOrWhiteSpace(activity))
        {
            return false;
        }

        // By id, not by exception: made earlier (a replay, a second add, a revision), or cancelled since - leave it alone.
        if (await repository.GetPlannedWorkByIdAsync(id, ct) is not null)
        {
            return false;
        }

        var title = activity.Trim();
        if (title.Length > PlannedWork.MaxTitle)
        {
            title = title[..PlannedWork.MaxTitle].TrimEnd();
        }

        var plots = log.PlotIds.Append(log.PlotId ?? Guid.Empty).Where(p => p != Guid.Empty).Distinct().ToList();
        var scope = plots.Count switch
        {
            0 => PlannedWorkScope.Unspecified,
            1 => PlannedWorkScope.Plot,
            _ => PlannedWorkScope.MultiPlot,
        };

        PlannedWork reminder;
        try
        {
            reminder = PlannedWork.Create(
                id,
                new SharedFarmId((Guid)log.FarmId),
                new PlannedWorkDetails(
                    title, scope, plots, PlannedDate: null, LooseWhen: null, PlannedTime: null, AssigneeUserId: null,
                    CrewText: null, ExpectedHeadcount: null, QuantityText: null, PayMode: null, Note: null),
                PlannedWorkSource.LogLeftover,
                PlannedWorkSourceKind.Leftover,
                recordedOn: log.LogDate,
                createdByUserId: log.OperatorUserId.Value,
                nowUtc,
                sourceDailyLogId: log.Id,
                sourceLogTaskId: logTaskId,
                sourcePlotId: log.PlotId);
        }
        catch (ArgumentException)
        {
            // A shape the record forbids cannot come from these rules; if it ever does, the work stays in the log and the log still
            // saves (P9: an optional extra never refuses the record) - and the trace says so.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("planned_work.leftover.not_made"));
            return false;
        }

        await repository.AddPlannedWorkAsync(reminder, ct);
        await PlannedWorkDoor.AuditAsync(repository, reminder, CreatedFromLeftoverStep, caller, ct);
        return true;
    }
}
