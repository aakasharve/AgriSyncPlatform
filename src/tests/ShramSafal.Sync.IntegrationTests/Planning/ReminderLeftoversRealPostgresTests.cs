// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 Task 3 (founder D-79 "unfinished work from daily logs", D-78; R14; P3, P4, P11; E3).
//
// Unfinished work becomes one reminder of the log's speaker, on a real Postgres as agrisync_app (E3 first, in every fact), in the same save as
// the line or document that said it: a log task saved Partial, Delayed or Skipped (through the real add-task handler), a "partial" crop activity
// of the document of what he said (create and revision), and one of the voice parse a 1.0.17 phone confirms. Completed makes none; a replay makes
// no second; a revision that finishes the work deletes nothing; the reminder carries no note, no date, no assignee, no transcript.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Persistence;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ReminderLeftoversRealPostgresTests(ITestOutputHelper output) : ReminderLane(output)
{
    private sealed record Leftover(
        Guid Id, string Title, string Scope, string Status, string Source, string? SourceKind, Guid? SourceLog, Guid? SourceTask,
        Guid? SourcePlot, string RecordedOn, string? PlannedDate, Guid? Assignee, Guid CreatedBy, string? Note, int PlotRows);

    private async Task<Guid> SaveLogAsync(Guid speaker, object? content = null, Guid? log = null, Dictionary<string, object?>? more = null)
    {
        var id = log ?? Guid.NewGuid();
        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = id,
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["operatorUserId"] = speaker,
            ["logDate"] = Day,
        };
        if (content is not null)
        {
            payload["content"] = content;
        }

        foreach (var (k, v) in more ?? [])
        {
            payload[k] = v;
        }

        var result = await PushAsync(speaker, "create_daily_log", $"rem1-lo-{id:N}", payload);
        result.Status.Should().BeOneOf(["applied", "duplicate"], $"{result.ErrorCode}: {result.ErrorMessage}");
        return id;
    }

    private static object Crop(string id, string title, string status, string? executionStatus = null) => new Dictionary<string, object?>
    {
        ["id"] = id,
        ["title"] = title,
        ["workTypes"] = new[] { title },
        ["status"] = status,
        ["notes"] = "गुप्त टीप ₹900",
        ["executionStatus"] = executionStatus,
    };

    private static object Content(params object[] crops) => new Dictionary<string, object?>
    {
        ["schema"] = 1,
        ["capturedAtUtc"] = "2026-11-08T05:00:00.000Z",
        ["fullTranscript"] = "आज फवारणी अर्धी झाली उद्या पाईप बघायचा",
        ["cropActivities"] = crops,
    };

    /// <summary>The add-task handler as the host runs it (the committed save, not the rolled-back probe): the only handler that writes a non-Completed line.</summary>
    private async Task<(bool Ok, string? Code)> AddLineAsync(
        Guid actor, Guid log, string activity, ExecutionStatus status, string? reason, Guid? lineId = null)
    {
        await using var scope = HostServices.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<ShramSafalDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync();
        (await sp.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(FarmA, actor)).IsSuccess.Should().BeTrue();
        var result = await sp.GetRequiredService<IHandler<AddLogTaskCommand, DailyLogDto>>().HandleAsync(
            new AddLogTaskCommand(
                log, activity, "नोंद ₹700", null, lineId, actor, "Worker", $"rem1-line-{Guid.NewGuid():N}",
                status, reason, null, "1.0.18"));
        Output.WriteLine($"[REM-1] add line {activity} {status} -> {(result.IsSuccess ? "ok" : result.Error.Code)}");
        if (result.IsSuccess)
        {
            await transaction.CommitAsync();
        }

        return (result.IsSuccess, result.IsSuccess ? null : result.Error.Code);
    }

    private async Task<List<Leftover>> LeftoversOfAsync(Guid log)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT w.id, w.title, w.scope, w.status, w.source, w.source_kind, w.source_daily_log_id, w.source_log_task_id, w.source_plot_id,
                   w.recorded_on::text, w.planned_date::text, w.assignee_user_id, w.created_by_user_id, w.note,
                   (SELECT count(*) FROM ssf.planned_work_plots p WHERE p.planned_work_id = w.id)
            FROM ssf.planned_work w WHERE w.source_daily_log_id = @log AND w.source = 'LogLeftover' ORDER BY w.title, w.id
            """;
        cmd.Parameters.AddWithValue("log", log);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<Leftover>();
        while (await reader.ReadAsync())
        {
            rows.Add(new Leftover(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5), reader.IsDBNull(6) ? null : reader.GetGuid(6),
                reader.IsDBNull(7) ? null : reader.GetGuid(7), reader.IsDBNull(8) ? null : reader.GetGuid(8), reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10), reader.IsDBNull(11) ? null : reader.GetGuid(11), reader.GetGuid(12),
                reader.IsDBNull(13) ? null : reader.GetString(13), (int)reader.GetInt64(14)));
        }

        return rows;
    }

    private async Task<long> LeftoverAuditAsync(Guid task) => await CountAsync(
        "SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'PlannedWork' AND entity_id = @id AND action = 'PlannedWorkCreatedFromLeftover'", ("id", task));

    // ── the line door: Partial, Delayed, Skipped ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(ExecutionStatus.Partial, "weather.rain")]
    [InlineData(ExecutionStatus.Delayed, "input.unavailable")]
    [InlineData(ExecutionStatus.Skipped, "labour.absent")]
    public async Task A_line_saved_Partial_Delayed_or_Skipped_makes_one_own_reminder_of_the_speaker(ExecutionStatus status, string reason)
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam);
        var line = Guid.NewGuid();
        (await AddLineAsync(Worker, log, "फवारणी", status, reason, line)).Ok.Should().BeTrue();

        var made = await LeftoversOfAsync(log);
        made.Should().ContainSingle();
        var reminder = made[0];
        reminder.Id.Should().Be(PlannedWorkIds.ForLeftover(log, line), "the same id every time");
        reminder.Source.Should().Be("LogLeftover");
        reminder.SourceKind.Should().Be("Leftover");
        reminder.CreatedBy.Should().Be(Mukadam, "the log's speaker, not the person who added the line");
        reminder.Assignee.Should().BeNull("handed to nobody without his tap (D-78)");
        reminder.Title.Should().Be("फवारणी", "the work's own words and nothing else (P4)");
        reminder.Note.Should().BeNull("a note may carry an amount: none is copied");
        reminder.PlannedDate.Should().BeNull("no cue was given: no date is made up (P4)");
        reminder.SourceLog.Should().Be(log);
        reminder.SourceTask.Should().Be(line);
        reminder.Status.Should().Be("Open");
        reminder.Scope.Should().Be("Plot", "the log's own plot");
        reminder.PlotRows.Should().Be(1);
        (await LeftoverAuditAsync(reminder.Id)).Should().Be(1);

        // Its maker and the owner see it; no one else does until the owner chooses (D-79).
        (await SeesOnPullAsync(Mukadam, reminder.Id)).Should().BeTrue();
        (await SeesOnPullAsync(Owner, reminder.Id)).Should().BeTrue();
        (await SeesOnPullAsync(Worker, reminder.Id)).Should().BeFalse();
        var seen = (await PulledAsync(Mukadam, reminder.Id))!.Value;
        seen.GetProperty("category").GetString().Should().Be("FromLogs");
        seen.GetProperty("sourceKind").GetString().Should().Be("Leftover");
        seen.GetProperty("createdByUserId").GetGuid().Should().Be(Mukadam);
    }

    [Fact]
    public async Task A_line_saved_Completed_makes_none()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam);
        (await AddLineAsync(Worker, log, "फवारणी", ExecutionStatus.Completed, null)).Ok.Should().BeTrue();
        (await AddLineAsync(Worker, log, "सुधारलेली फवारणी", ExecutionStatus.Modified, "operator.other")).Ok.Should().BeTrue();
        (await LeftoversOfAsync(log)).Should().BeEmpty("a finished or changed line leaves nothing behind");
        // Control: the same log with an unfinished line does make one.
        (await AddLineAsync(Worker, log, "पाणी देणं", ExecutionStatus.Partial, "weather.rain")).Ok.Should().BeTrue();
        (await LeftoversOfAsync(log)).Should().ContainSingle();
    }

    [Fact]
    public async Task A_refused_line_leaves_no_reminder_behind()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam);
        // A reason that is not one of the list: the whole add is refused, so nothing of it - the reminder included - is kept.
        (await AddLineAsync(Worker, log, "फवारणी", ExecutionStatus.Partial, "not.a.reason")).Ok.Should().BeFalse();
        (await LeftoversOfAsync(log)).Should().BeEmpty();
    }

    // ── the document of what he said: create, replay, revision ────────────────────────────────────────────────────────

    [Fact]
    public async Task A_partial_crop_activity_in_the_saved_document_makes_one_reminder_and_the_saved_work_still_stands()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(Crop("a1", "फवारणी", "partial"), Crop("a2", "पाणी देणं", "completed")));

        var made = await LeftoversOfAsync(log);
        made.Should().ContainSingle();
        made[0].Title.Should().Be("फवारणी");
        made[0].CreatedBy.Should().Be(Mukadam);
        made[0].Note.Should().BeNull();
        made[0].Id.Should().Be(PlannedWorkIds.ForLeftover(log, Application.UseCases.Logs.Content.LogTaskProjection.TaskIdFor(log, "cropActivities", "a1")));
        (await CountAsync("SELECT count(*) FROM ssf.log_tasks WHERE daily_log_id = @l", ("l", log))).Should().Be(2, "the log keeps both lines");
    }

    [Fact]
    public async Task A_replay_makes_no_second_reminder()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var content = Content(Crop("a1", "फवारणी", "partial"));
        var log = await SaveLogAsync(Mukadam, content);
        await SaveLogAsync(Mukadam, content, log);
        (await LeftoversOfAsync(log)).Should().ContainSingle("the same log sent again");

        // And a revision that still says the same half-done work (now with one more finished item): the work is staged again and found by its id.
        var revised = await PushAsync(Mukadam, "revise_log_content", $"rem1-rev-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["baseVersion"] = 1,
            ["content"] = Content(Crop("a1", "फवारणी", "partial"), Crop("b2", "पाणी देणं", "completed")),
            ["reason"] = "आणखी एक काम",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        revised.Status.Should().Be("applied", $"{revised.ErrorCode}: {revised.ErrorMessage}");
        (await LeftoversOfAsync(log)).Should().ContainSingle("a revision never makes a second one for the same work");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'PlannedWork' AND action = 'PlannedWorkCreatedFromLeftover' AND entity_id = @id",
            ("id", PlannedWorkIds.ForLeftover(log, Application.UseCases.Logs.Content.LogTaskProjection.TaskIdFor(log, "cropActivities", "a1"))))).Should().Be(1);
    }

    [Fact]
    public async Task A_revision_that_says_partial_became_completed_deletes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(Crop("a1", "फवारणी", "partial")));
        var task = (await LeftoversOfAsync(log)).Single().Id;

        var revised = await PushAsync(Mukadam, "revise_log_content", $"rem1-rev-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["baseVersion"] = 1,
            ["content"] = Content(Crop("a1", "फवारणी", "completed")),
            ["reason"] = "आज पूर्ण केलं",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        revised.Status.Should().Be("applied", $"{revised.ErrorCode}: {revised.ErrorMessage}");

        var after = await LeftoversOfAsync(log);
        after.Should().ContainSingle("P3: nothing is deleted");
        after[0].Id.Should().Be(task);
        after[0].Status.Should().Be("Open", "he removes it himself with one tap");
        (await SeesOnPullAsync(Mukadam, task)).Should().BeTrue();
    }

    [Fact]
    public async Task A_revision_that_adds_a_new_unfinished_item_makes_exactly_that_one_more()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(Crop("a1", "फवारणी", "partial")));
        var revised = await PushAsync(Mukadam, "revise_log_content", $"rem1-rev-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["baseVersion"] = 1,
            ["content"] = Content(Crop("a1", "फवारणी", "partial"), Crop("a3", "खत देणं", "partial")),
            ["reason"] = "एक आणखी राहिलं",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        revised.Status.Should().Be("applied", $"{revised.ErrorCode}: {revised.ErrorMessage}");
        (await LeftoversOfAsync(log)).Select(l => l.Title).Should().BeEquivalentTo(["फवारणी", "खत देणं"]);
    }

    [Fact]
    public async Task A_reminder_the_speaker_removed_is_not_made_again_by_a_replay()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var content = Content(Crop("a1", "फवारणी", "partial"));
        var log = await SaveLogAsync(Mukadam, content);
        var task = (await LeftoversOfAsync(log)).Single().Id;
        (await StepAsync(Mukadam, "cancel", task, reason: "Removed")).Status.Should().Be("applied");

        await SaveLogAsync(Mukadam, content, log);
        var after = await LeftoversOfAsync(log);
        after.Should().ContainSingle("the cancelled one is found by id and left alone");
        after[0].Status.Should().Be("Cancelled");
    }

    // ── a log kept from people keeps its leftover from them ───────────────────────────────────────────────────────────

    [Fact]
    public async Task A_leftover_of_a_log_hidden_only_me_stays_with_its_maker_and_the_owner_whatever_the_setting()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(Crop("a1", "फवारणी", "partial")));
        var task = (await LeftoversOfAsync(log)).Single().Id;
        await SetSettingsAsync(Owner, log: "PlotTeam");
        (await SeesOnPullAsync(Worker, task)).Should().BeTrue("control: the plot team sees it while the log is the team's");

        await SetLogAudienceAsync(log, "OnlyMe");
        (await SeesOnPullAsync(Worker, task)).Should().BeFalse();
        (await SeesOnRestAsync(Worker, task)).Should().BeFalse();
        (await SeesOnPullAsync(Mukadam, task)).Should().BeTrue();
        (await SeesOnPullAsync(Owner, task)).Should().BeTrue();
    }

    // ── 1.0.17: a manual save and a confirmed voice parse ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_log_a_1_0_17_phone_saved_with_a_manual_draft_yields_its_partial_work_too()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // 1.0.17 sends no `content`: a manual save carries `manualDraft`.
        var log = await SaveLogAsync(Mukadam, null, more: new Dictionary<string, object?>
        {
            ["manualDraft"] = new Dictionary<string, object?>
            {
                ["cropActivities"] = new object[] { Crop("legacy-1", "फवारणी", "partial") },
            },
        });
        var made = await LeftoversOfAsync(log);
        made.Should().ContainSingle();
        made[0].Title.Should().Be("फवारणी");
        made[0].CreatedBy.Should().Be(Mukadam);
        made[0].Source.Should().Be("LogLeftover");
    }

    [Fact]
    public async Task A_log_a_1_0_17_phone_confirmed_from_its_voice_parse_yields_the_parses_partial_work_by_place()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var job = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.ai_jobs (
                id, idempotency_key, operation_type, user_id, farm_id, status,
                schema_version, created_at_utc, total_attempts, modified_at_utc,
                source, model_version, prompt_version, transcript_schema_version, normalized_result_json)
            VALUES (
                @id, @key, 'VoiceToStructuredLog', @uid, @fid, 'Succeeded',
                '1.0.0', NOW(), 1, NOW(),
                'voice', 'gemini-2.5-flash', 'v3.2.0', '1.0.0', @json::jsonb);
            """,
            ("id", job), ("key", $"rem1-{job:N}"), ("uid", Mukadam), ("fid", FarmA),
            ("json", """{"cropActivities":[{"title":"पाणी देणं","status":"completed"},{"title":"फवारणी","workTypes":["फवारणी"],"status":"partial"}],"plannedTasks":[{"title":"पाईप बघायचा","dueHint":"उद्या"}],"fullTranscript":"आज फवारणी अर्धी झाली उद्या पाईप बघायचा"}"""));

        var log = await SaveLogAsync(Mukadam, null, more: new Dictionary<string, object?> { ["sourceAiJobId"] = job });

        var made = await LeftoversOfAsync(log);
        made.Should().ContainSingle();
        made[0].Id.Should().Be(PlannedWorkIds.ForLeftoverJobItem(log, 1), "keyed by its place in the confirmed parse");
        made[0].Title.Should().Be("फवारणी");
        // The spoken "पाईप बघायचा" is the other of the two reminders of the acceptance pointer (L8c-4's, not rebuilt here).
        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE source_daily_log_id = @l", ("l", log))).Should().Be(2);

        // The same request again is still the same.
        await SaveLogAsync(Mukadam, null, log, new Dictionary<string, object?> { ["sourceAiJobId"] = job });
        (await LeftoversOfAsync(log)).Should().ContainSingle();
    }

    [Fact]
    public async Task A_log_pushed_by_release_1_0_17s_own_mutation_builder_with_half_done_work_yields_the_same_leftover()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The manual-save payload release b3d28967 builds (its own LogFactory + buildManualDraft, captured with git show): a crop activity saved partial.
        using var captured = JsonDocument.Parse(System.IO.File.ReadAllText(FixturePath("release-1017-manual-save-partial.json")));
        var draft = JsonSerializer.Deserialize<Dictionary<string, object?>>(captured.RootElement.GetProperty("manualDraft").GetRawText())!;
        var activity = captured.RootElement.GetProperty("manualDraft").GetProperty("cropActivities")[0];
        activity.GetProperty("status").GetString().Should().Be("partial", "control: 1.0.17 says it in this very word");
        var itemId = activity.GetProperty("id").GetString()!;

        var log = await SaveLogAsync(Mukadam, null, more: new Dictionary<string, object?> { ["manualDraft"] = draft });
        var made = await LeftoversOfAsync(log);
        made.Should().ContainSingle();
        made[0].Id.Should().Be(PlannedWorkIds.ForLeftover(log, Application.UseCases.Logs.Content.LogTaskProjection.TaskIdFor(log, "cropActivities", itemId)));
        made[0].Title.Should().Be(activity.GetProperty("title").GetString());
        made[0].CreatedBy.Should().Be(Mukadam);
        made[0].Source.Should().Be("LogLeftover");
        made[0].PlannedDate.Should().BeNull();
    }

    private static string FixturePath(string name)
    {
        var current = new System.IO.DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = System.IO.Path.Combine(current.FullName, "sync-contract", "tests", "fixtures", name);
            if (System.IO.File.Exists(candidate))
            {
                return candidate;
            }

            current = current.Parent;
        }

        throw new System.IO.FileNotFoundException($"sync-contract/tests/fixtures/{name} was not found above the test output.");
    }

    // ── the acceptance pointer ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Raju_logs_half_done_spraying_and_a_pipe_to_look_at_and_the_owner_decides_who_else_sees_them()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var job = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.ai_jobs (
                id, idempotency_key, operation_type, user_id, farm_id, status,
                schema_version, created_at_utc, total_attempts, modified_at_utc,
                source, model_version, prompt_version, transcript_schema_version, normalized_result_json)
            VALUES (
                @id, @key, 'VoiceToStructuredLog', @uid, @fid, 'Succeeded',
                '1.0.0', NOW(), 1, NOW(),
                'voice', 'gemini-2.5-flash', 'v3.2.0', '1.0.0', @json::jsonb);
            """,
            ("id", job), ("key", $"rem1-acc-{job:N}"), ("uid", Mukadam), ("fid", FarmA),
            ("json", """{"cropActivities":[{"title":"फवारणी","status":"partial"}],"plannedTasks":[{"title":"पाईप बघायचा"}],"fullTranscript":"आज फवारणी अर्धी झाली, उद्या पाईप बघायचा"}"""));
        var log = await SaveLogAsync(Mukadam, null, more: new Dictionary<string, object?> { ["sourceAiJobId"] = job });
        var mine = await ListAsync(Mukadam);
        mine.Where(t => t.Log == log).Select(t => (t.Category, t.Kind)).Should().BeEquivalentTo([("FromLogs", "Spoken"), ("FromLogs", "Leftover")],
            "two reminders under नोंदीतून: बोलण्यातून and अर्धवट राहिलेलं");
        mine.Should().OnlyContain(t => t.Name == MukadamName, "each carries his name");

        // He removes one with one tap (a cancel with the reason Removed): gone from his list; history kept.
        var leftover = mine.Single(t => t.Kind == "Leftover").Id;
        (await StepAsync(Mukadam, "cancel", leftover, reason: "Removed")).Status.Should().Be("applied");
        (await RowAsync(leftover))!.Status.Should().Be("Cancelled");

        // The owner sees the other one; Worker does not - until the owner chooses नोंदीतून -> plot team.
        var spoken = mine.Single(t => t.Kind == "Spoken").Id;
        (await SeesOnPullAsync(Owner, spoken)).Should().BeTrue();
        (await SeesOnPullAsync(Worker, spoken)).Should().BeFalse();
        await SetSettingsAsync(Owner, log: "PlotTeam");
        (await SeesOnPullAsync(Worker, spoken)).Should().BeTrue();
    }

    private async Task<List<(Guid Id, Guid? Log, string Category, string Kind, string Name)>> ListAsync(Guid user)
    {
        var (status, body) = await GetAsync(user, $"/shramsafal/farms/{FarmA}/planned-work");
        status.Should().Be(System.Net.HttpStatusCode.OK, body);
        return JsonDocument.Parse(body).RootElement.EnumerateArray()
            .Select(t => (
                t.GetProperty("id").GetGuid(),
                t.GetProperty("sourceDailyLogId").ValueKind == JsonValueKind.Null ? (Guid?)null : t.GetProperty("sourceDailyLogId").GetGuid(),
                t.GetProperty("category").GetString()!,
                t.GetProperty("sourceKind").GetString()!,
                t.GetProperty("createdByName").GetString()!))
            .ToList();
    }
}
