// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-4 Task 1 (founder D-78 = 1, D-29, D-31, D-26, E4, P3, P11).
using System.Text.Json;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Planning.PlannedWork;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using SharedFarmId = AgriSync.SharedKernel.Contracts.Ids.FarmId;

namespace ShramSafal.Application.UseCases.Logs.Content;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4, D-78 = 1) - a spoken "to do" becomes the speaker's OWN
/// reminder, written by the SERVER in the same unit of work as the log's content: no half state (the log and its reminders
/// commit together or not at all, P1), and the same path for every app version because both ways a log's details arrive
/// (<see cref="LogContentStaging"/>: create and revision) and the voice parse a 1.0.17 phone confirms go through it.
///
/// <list type="bullet">
/// <item><b>His own.</b> Created by the one who wrote this version of the log, with no assignee: it is handed to nobody
/// without his tap (D-78), and it grants no authority (D-24). Source <c>VoiceLog</c> / kind <c>Spoken</c> for what was said;
/// <c>Planning</c> / <c>Typed</c> for a reminder typed into a manual save. No attendance, wage, job card or cost is touched.</item>
/// <item><b>Replay-safe.</b> The id is <see cref="PlannedWorkIds"/>'s - the same every time - and a task that already exists
/// (even one he cancelled) is skipped by id, never re-made and never rewritten. A revision therefore adds a task for a NEW
/// item only; a removed item leaves its task, a reworded one leaves its task as it was (P3: he edits or cancels it himself).</item>
/// <item><b>One more guard for a revision.</b> The phone's correction flow gives the SAME words new item ids; an item whose
/// words (trimmed, case-insensitive) are those of a task this log already made is that task, not a second one.</item>
/// <item><b>A day only from a clear cue</b> (<see cref="DueHintResolver"/>, from the log's day); otherwise undated - never
/// "today by default" (D-29).</item>
/// <item><b>A place only when it can be trusted (E4).</b> <c>Unspecified</c> unless the item itself names a plot, other than the
/// log's own (the log's plot is where he was, not a place he said: it is the task's <c>source_plot_id</c>), that belongs to the
/// log's farm and that the speaker covers; anything else falls back to <c>Unspecified</c>.</item>
/// <item><b>Words (D-31).</b> Only a short title; never the transcript, the audio, the source text or the interpretation.</item>
/// <item><b>Audit.</b> One <c>PlannedWorkCreatedFromVoice</c> row per task, by the speaker, with the four fields and no words.</item>
/// <item><b>Who sees it</b> is <see cref="PlannedWorkVisibility"/>, including the log's own audience: a log the owner hid
/// ("फक्त मी") hides its tasks from every reader the log is hidden from, except its maker and the primary owner.</item>
/// </list>
/// </summary>
public static class SpokenReminders
{
    /// <summary>The audit step of a spoken create (the action is <c>PlannedWorkCreatedFromVoice</c>).</summary>
    public const string CreatedFromVoiceStep = "CreatedFromVoice";

    /// <summary>
    /// Stages the reminders for the planned items of <paramref name="content"/> (staged, never saved: the caller's own save
    /// commits them with the log). <paramref name="isRevision"/>: this is a later version of the log.
    /// </summary>
    public static async Task StageFromContentAsync(
        IShramSafalRepository repository,
        DailyLog log,
        JsonElement content,
        bool isRevision,
        DateTime nowUtc,
        ContentAuditStamp audit,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);
        ArgumentNullException.ThrowIfNull(audit);

        var found = PlannedWorkProjection.Project(log.Id, log.LogDate, content);
        if (found.Count == 0)
        {
            return;
        }

        var spokenLog = log.SourceAiJobId is not null
            || log.VoiceClipId is not null
            || (content.TryGetProperty("fullTranscript", out var said)
                && said.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(said.GetString()));
        await StageAsync(repository, log, found, spokenLog, isRevision, nowUtc, audit, ct);
    }

    /// <summary>
    /// A 1.0.17 phone confirms a spoken log through its voice parse and sends no content: the parse's own planned items are the
    /// source (<see cref="PlannedWorkProjection.ProjectJob"/>). Only ever called when the create carried no content at all - a
    /// phone that sent content has said, in that document, exactly which items it kept.
    /// </summary>
    public static async Task StageFromJobAsync(
        IShramSafalRepository repository,
        DailyLog log,
        string normalizedResultJson,
        DateTime nowUtc,
        ContentAuditStamp audit,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);
        ArgumentNullException.ThrowIfNull(audit);
        if (string.IsNullOrWhiteSpace(normalizedResultJson))
        {
            return;
        }

        IReadOnlyList<SpokenReminder> found;
        try
        {
            using var parsed = JsonDocument.Parse(normalizedResultJson);
            found = PlannedWorkProjection.ProjectJob(log.Id, log.LogDate, parsed.RootElement);
        }
        catch (JsonException)
        {
            // A stored parse that is not JSON has no planned items to read; the log itself is untouched (and the trace says so).
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("planned_work.spoken.job_parse_unreadable"));
            return;
        }

        if (found.Count > 0)
        {
            await StageAsync(repository, log, found, spokenLog: true, isRevision: false, nowUtc, audit, ct);
        }
    }

    private static async Task StageAsync(
        IShramSafalRepository repository,
        DailyLog log,
        IReadOnlyList<SpokenReminder> found,
        bool spokenLog,
        bool isRevision,
        DateTime nowUtc,
        ContentAuditStamp audit,
        CancellationToken ct)
    {
        var farmId = (Guid)log.FarmId;
        var ownPlaces = log.PlotIds.Append(log.PlotId ?? Guid.Empty).Where(p => p != Guid.Empty).ToHashSet();

        // The words of the tasks this log already made: the correction flow's fresh ids for the same words are not new items.
        HashSet<string> madeWords = [];
        if (isRevision)
        {
            // REM-1: a leftover is made from a log task line, not from a planned item: its words are not "a task this log already made".
            madeWords = (await repository.GetPlannedWorkBySourceLogAsync(farmId, log.Id, ct))
                .Where(t => t.Source != PlannedWorkSource.LogLeftover)
                .Select(t => Words(t.Title))
                .ToHashSet(StringComparer.Ordinal);
        }

        var caller = new PlannedWorkCaller(
            audit.ActorUserId, audit.ActorRole ?? "unknown", audit.ClientCommandId, audit.AppVersion, audit.DeviceId, audit.IpHash);

        foreach (var reminder in found)
        {
            // By id, not by exception: the task is already there (made earlier, replayed, or cancelled since) - leave it alone.
            if (await repository.GetPlannedWorkByIdAsync(reminder.TaskId, ct) is not null)
            {
                continue;
            }

            if (isRevision && madeWords.Contains(Words(reminder.Title)))
            {
                continue;
            }

            var (scope, plotIds) = await PlaceAsync(repository, farmId, reminder, ownPlaces, audit.ActorUserId, nowUtc, ct);
            var spoken = spokenLog || reminder.ItemSourceType == "ai_extracted";

            Domain.Planning.PlannedWork task;
            try
            {
                task = Domain.Planning.PlannedWork.Create(
                    reminder.TaskId,
                    new SharedFarmId(farmId),
                    new PlannedWorkDetails(
                        reminder.Title, scope, plotIds, reminder.DueDate, LooseWhen: null, PlannedTime: null, AssigneeUserId: null,
                        CrewText: null, ExpectedHeadcount: null, QuantityText: null, PayMode: null, Note: null),
                    spoken ? PlannedWorkSource.VoiceLog : PlannedWorkSource.Planning,
                    spoken ? PlannedWorkSourceKind.Spoken : PlannedWorkSourceKind.Typed,
                    recordedOn: log.LogDate,
                    createdByUserId: audit.ActorUserId,
                    nowUtc,
                    sourceDailyLogId: log.Id,
                    sourcePlotId: log.PlotId);
            }
            catch (ArgumentException)
            {
                // A shape the record forbids cannot come from these rules; if it ever does, the item stays in the log's own
                // content and the log still saves (P9: an optional extra never refuses the record) - and the trace says so.
                System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("planned_work.spoken.item_not_made"));
                continue;
            }

            await repository.AddPlannedWorkAsync(task, ct);
            await PlannedWorkDoor.AuditAsync(repository, task, CreatedFromVoiceStep, caller, ct);
        }
    }

    /// <summary>E4: a named plot is trusted only when it is this farm's and the speaker covers it; otherwise "not fixed".</summary>
    private static async Task<(PlannedWorkScope Scope, IReadOnlyList<Guid> PlotIds)> PlaceAsync(
        IShramSafalRepository repository, Guid farmId, SpokenReminder reminder, HashSet<Guid> ownPlaces, Guid speaker, DateTime nowUtc, CancellationToken ct)
    {
        if (reminder.NamedPlotId is not { } plot || ownPlaces.Contains(plot))
        {
            return (PlannedWorkScope.Unspecified, []);
        }

        if (await ScheduleChangeGate.RefusePlotsOfFarmAsync(repository, farmId, [plot], ShramSafalErrors.PlotNotFound, ct) is not null
            || await PlotScopeGate.RefuseAsync(repository, farmId, [(Guid?)plot], speaker, nowUtc, ct) is not null)
        {
            return (PlannedWorkScope.Unspecified, []);
        }

        return (PlannedWorkScope.Plot, [plot]);
    }

    private static string Words(string title) => title.Trim().ToLowerInvariant();
}
