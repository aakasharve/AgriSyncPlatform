using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Logs.Content;

/// <summary>
/// spec: plr-d10 (lane F1, review N3) — who staged a content row, for the <c>TaskAdded</c> audit
/// row each server-written task line gets: the same provenance trio every other write records.
/// </summary>
public sealed record ContentAuditStamp(
    Guid ActorUserId,
    string? ActorRole,
    string? ClientCommandId,
    string AppVersion,
    string DeviceId,
    string IpHash);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — the ONE place a content row and
/// the task lines it stands for are staged, shared by the create path and the revision path.
/// Staged, never saved: the caller's own save commits them with the log, so the details and the
/// record either commit together or not at all (doctrine P1).
/// </summary>
public static class LogContentStaging
{
    /// <summary>
    /// Stages <paramref name="documentJson"/> as the content of <paramref name="log"/> at the log's
    /// CURRENT version, then writes the task lines it stands for, as <paramref name="taskLines"/> says,
    /// each with its <c>TaskAdded</c> audit row (review N3).
    /// </summary>
    /// <returns>The staged content row.</returns>
    public static async Task<DailyLogContent> StageAsync(
        IShramSafalRepository repository,
        IScheduleComplianceService? complianceService,
        DailyLog log,
        Guid contentId,
        string documentJson,
        string origin,
        int? baseVersion,
        DateTime nowUtc,
        ContentAuditStamp audit,
        TaskLines taskLines,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);
        ArgumentNullException.ThrowIfNull(audit);
        ArgumentNullException.ThrowIfNull(taskLines);

        var row = DailyLogContent.Create(
            contentId,
            log,
            LogContentDocument.SchemaVersion,
            documentJson,
            origin,
            baseVersion,
            new UserId(audit.ActorUserId),
            nowUtc,
            audit.ClientCommandId,
            audit.AppVersion);
        await repository.AddDailyLogContentAsync(row, ct);

        if (taskLines.Write)
        {
            using var parsed = JsonDocument.Parse(documentJson);
            await AddTaskLinesAsync(repository, complianceService, log, parsed.RootElement, taskLines, nowUtc, audit, ct);
        }

        // spec: plr-d10 lane L8c-4 (D-78 = 1) - the planned items of the document become the speaker's own reminders, in this same
        // unit of work, for every app version (see SpokenReminders). Independent of the task LINES above: an older phone's
        // manual draft writes no line here, but its planned items still become reminders.
        using (var reminded = JsonDocument.Parse(documentJson))
        {
            await SpokenReminders.StageFromContentAsync(
                repository, log, reminded.RootElement, isRevision: baseVersion is not null, nowUtc, audit, ct);
        }

        // spec: plr-d10 lane REM-1 (founder D-79, R14) - work he said was only half done leaves ONE reminder of the speaker behind, in
        // this same unit of work, for a create and for a revision alike (replay-safe by id; never deleted by a later revision, P3).
        using (var unfinished = JsonDocument.Parse(documentJson))
        {
            await LogLeftovers.StageFromContentAsync(
                repository,
                log,
                unfinished.RootElement,
                nowUtc,
                new Planning.PlannedWork.PlannedWorkCaller(
                    audit.ActorUserId, audit.ActorRole ?? "unknown", audit.ClientCommandId, audit.AppVersion, audit.DeviceId, audit.IpHash),
                ct);
        }

        // AddTask stamps the phone's capture time on the log's clock, which can be EARLIER than
        // this save; the pull is a delta on that clock, so move it forward to now, never back.
        log.MarkContentRevised(nowUtc);
        return row;
    }

    /// <summary>
    /// The task lines old phones and every server reader of <see cref="LogTask"/> read — one per
    /// content item that has none yet, worded exactly as the phone's <c>buildTaskPayloads</c>, with
    /// the same schedule-compliance stamp and the same <c>TaskAdded</c> audit row
    /// <c>AddLogTaskHandler</c> gives a task.
    /// </summary>
    private static async Task AddTaskLinesAsync(
        IShramSafalRepository repository,
        IScheduleComplianceService? complianceService,
        DailyLog log,
        JsonElement content,
        TaskLines taskLines,
        DateTime nowUtc,
        ContentAuditStamp audit,
        CancellationToken ct)
    {
        var projected = TaskLines.Unlined(
            LogTaskProjection.Project(log.Id, content), log.Tasks, taskLines);
        if (projected.Count == 0)
        {
            return;
        }

        var existing = log.Tasks.Select(t => t.Id).ToHashSet();
        var occurredAtUtc = LogContentDocument.CapturedAtUtc(content) ?? nowUtc;

        // LABOUR_PHASE2 P2.3 — compliance only when the log names a crop cycle; a plot-less log
        // records its tasks with no verdict (null = the evaluator never ran), exactly as
        // AddLogTaskHandler does.
        Domain.Crops.CropCycle? cycle = null;
        if (complianceService is not null && log.CropCycleId is { } cycleId)
        {
            cycle = await repository.GetCropCycleByIdAsync(cycleId, ct);
        }

        foreach (var line in projected)
        {
            if (!existing.Add(line.TaskId))
            {
                continue;
            }

            var task = log.AddTask(line.TaskId, line.ActivityType, line.Notes, occurredAtUtc);
            ComplianceResult? compliance = null;
            if (complianceService is not null && cycle is not null && log.CropCycleId is { } complianceCycleId)
            {
                compliance = await complianceService.EvaluateAsync(
                    new ScheduleComplianceQuery(complianceCycleId, line.ActivityType, cycle.Stage, log.LogDate),
                    ct);
                task.StampCompliance(compliance);
            }

            // Review N3 — the same TaskAdded row AddLogTaskHandler writes, so "which lines exist and
            // where did each come from?" stays answerable from the ledger alone.
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "DailyLog",
                    entityId: log.Id,
                    action: "TaskAdded",
                    actorUserId: audit.ActorUserId,
                    actorRole: audit.ActorRole ?? "unknown",
                    payload: new
                    {
                        logId = log.Id,
                        taskId = task.Id,
                        task.ActivityType,
                        task.Notes,
                        task.OccurredAtUtc,
                        complianceOutcome = compliance?.Outcome.ToString(),
                        complianceDeltaDays = compliance?.DeltaDays,
                        complianceNotEvaluatedReason = compliance is not null
                            ? null
                            : cycle is null
                                ? $"parent daily log scope '{log.Scope}' has no crop cycle"
                                : "schedule compliance was not evaluated",
                        writtenFrom = "content",
                        contentVersion = log.ContentVersion,
                        bucket = line.Bucket,
                        itemId = line.ItemId,
                    },
                    farmId: (Guid)log.FarmId,
                    clientCommandId: audit.ClientCommandId,
                    appVersion: audit.AppVersion,
                    deviceId: audit.DeviceId,
                    ipHash: audit.IpHash,
                    sourceAiJobId: null),
                ct);
        }
    }
}

/// <summary>
/// spec: plr-d10 (lane F1) — which task lines a staged content row writes. Every item gets exactly
/// ONE line, ever, from whichever source wrote it first:
/// <list type="bullet">
/// <item><see cref="All"/> — a NEW phone's create: it sends no <c>add_log_task</c>, so the server writes them.</item>
/// <item><see cref="None"/> — an OLDER phone's create (its manual draft stored as content): that phone
/// sends its own <c>add_log_task</c> for every item, so a server line would be a second one.</item>
/// <item><see cref="NewSince"/> — a revision: only items the PREVIOUS stored document did not have
/// (theirs already have a line).</item>
/// </list>
/// <para><b>An item that already IS a line (review S6).</b> Whatever the case, an item whose id is the
/// id of a task line on this log already has its line: a new phone rebuilding an older record from
/// its task lines gives each item that line's id. With no previous document (a record an older phone
/// made), an item with an id no line carries is new and gets its line — except that an item whose
/// line would read exactly like an existing line no other item has claimed is that line (the older
/// phone's own copy of the record, whose ids its task lines never kept). Changed or removed items
/// keep their old lines: there is no delete path (P3).</para>
/// </summary>
public sealed class TaskLines
{
    private TaskLines(bool write, IReadOnlySet<string> alreadyLined, bool matchOlderLines)
    {
        Write = write;
        AlreadyLined = alreadyLined;
        MatchOlderLines = matchOlderLines;
    }

    public bool Write { get; }

    /// <summary>Item keys (<c>bucket:id</c>) that already have a line.</summary>
    public IReadOnlySet<string> AlreadyLined { get; }

    /// <summary>
    /// True when the record has no previous document: its lines were written by an older phone,
    /// so an unknown item whose line reads exactly like an unclaimed existing line is that line.
    /// </summary>
    public bool MatchOlderLines { get; }

    public static TaskLines All { get; } = new(true, new HashSet<string>(), matchOlderLines: false);

    public static TaskLines None { get; } = new(false, new HashSet<string>(), matchOlderLines: false);

    /// <summary>
    /// Only items absent from <paramref name="previousDocumentJson"/>; with no previous document,
    /// only items no existing line already stands for (see the class remarks).
    /// </summary>
    public static TaskLines NewSince(string? previousDocumentJson)
    {
        if (string.IsNullOrWhiteSpace(previousDocumentJson))
        {
            return new TaskLines(true, new HashSet<string>(), matchOlderLines: true);
        }

        using var previous = JsonDocument.Parse(previousDocumentJson);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        if (previous.RootElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var bucket in LogContentDocument.Buckets)
            {
                if (!previous.RootElement.TryGetProperty(bucket, out var rows) || rows.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                foreach (var item in rows.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Object
                        && item.TryGetProperty("id", out var id)
                        && id.ValueKind == JsonValueKind.String)
                    {
                        keys.Add(KeyOf(bucket, id.GetString()!));
                    }
                }
            }
        }

        return new TaskLines(true, keys, matchOlderLines: false);
    }

    public static string KeyOf(string bucket, string itemId) => $"{bucket}:{itemId}";

    /// <summary>The projected lines that still need writing, in document order.</summary>
    public static IReadOnlyList<ProjectedTask> Unlined(
        IReadOnlyList<ProjectedTask> projected, IEnumerable<LogTask> existingLines, TaskLines taskLines)
    {
        ArgumentNullException.ThrowIfNull(projected);
        ArgumentNullException.ThrowIfNull(taskLines);

        var lines = existingLines.ToList();
        var lineIds = lines.Select(t => t.Id).ToHashSet();

        // An item whose id IS a line on this log stands for that line.
        var claimed = new HashSet<Guid>();
        foreach (var item in projected)
        {
            if (Guid.TryParse(item.ItemId, out var itemLineId) && lineIds.Contains(itemLineId))
            {
                claimed.Add(itemLineId);
            }
        }

        var unclaimed = taskLines.MatchOlderLines
            ? lines.Where(t => !claimed.Contains(t.Id)).ToList()
            : [];

        var result = new List<ProjectedTask>();
        foreach (var item in projected)
        {
            if (taskLines.AlreadyLined.Contains(KeyOf(item.Bucket, item.ItemId)))
            {
                continue;
            }

            if (Guid.TryParse(item.ItemId, out var itemLineId) && lineIds.Contains(itemLineId))
            {
                continue;
            }

            var twin = unclaimed.FirstOrDefault(t =>
                string.Equals(t.ActivityType, item.ActivityType, StringComparison.Ordinal)
                && string.Equals(t.Notes ?? string.Empty, item.Notes ?? string.Empty, StringComparison.Ordinal));
            if (twin is not null)
            {
                unclaimed.Remove(twin);
                continue;
            }

            result.Add(item);
        }

        return result;
    }
}
