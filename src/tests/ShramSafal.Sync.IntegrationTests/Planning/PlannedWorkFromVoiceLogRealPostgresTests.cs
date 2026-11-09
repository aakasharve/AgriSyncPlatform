// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-4 Task 1 (founder D-78 = 1, D-29, D-31, D-26, D-79, E4, P3, P11).
//
// "A spoken to-do becomes his own reminder", on a real Postgres as agrisync_app (E3 first, in every fact): the server writes one
// task per planned item in the SAME save as the log's content (create and revision alike), under an id that is the same every
// time; a replay never doubles, a revision adds only the new items and never takes one away or rewrites one; the due date comes
// from a clear cue or not at all; a place the farm does not own falls back to "not fixed" (E4); the task never carries the log's
// words; a log the owner hid ("फक्त मी") yields tasks only its maker and the owner can see - and a holder of "see all tasks" who
// had them is told to forget them; and a log a 1.0.17 phone saved yields its tasks through the same rule.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class PlannedWorkFromVoiceLogRealPostgresTests(ITestOutputHelper output) : PlannedWorkLane(output)
{
    private const string Day = "2026-11-08";
    private const string Said = "आज फवारणी केली उद्या पाईपलाईन दुरुस्त करायची";
    private const string SourceText = "उद्या पाईपलाईन दुरुस्त करायची आणि खत आणायचं";
    private const string Interpreted = "pipeline repair tomorrow";

    private sealed record Made(
        Guid Id, string Title, string Scope, string Status, string Source, string? SourceKind, Guid? SourceLog, Guid? SourcePlot,
        string RecordedOn, string? PlannedDate, string? LooseWhen, Guid? Assignee, Guid CreatedBy, string? Note, int PlotRows);

    private static object Item(string id, string title, string? dueHint = null, string? plotId = null, string sourceType = "ai_extracted", string status = "pending") =>
        new Dictionary<string, object?>
        {
            ["id"] = id,
            ["title"] = title,
            ["dueHint"] = dueHint,
            ["status"] = status,
            ["priority"] = "normal",
            ["sourceType"] = sourceType,
            ["plotId"] = plotId ?? "FARM_GLOBAL",
            ["cropId"] = "FARM_GLOBAL",
            ["createdAt"] = "2026-11-08T05:00:00.000Z",
            ["sourceText"] = SourceText,
            ["systemInterpretation"] = Interpreted,
        };

    private static object Content(params object[] planned) => new Dictionary<string, object?>
    {
        ["schema"] = 1,
        ["capturedAtUtc"] = "2026-11-08T05:00:00.000Z",
        ["fullTranscript"] = Said,
        ["plannedTasks"] = planned,
    };

    private async Task<Guid> SaveLogAsync(Guid speaker, object? content, Guid? log = null, Dictionary<string, object?>? more = null, string key = "")
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

        var result = await PushAsync(speaker, "create_daily_log", $"l8c4-log-{id:N}{key}", payload);
        // The same request id again is answered as the duplicate it is (the sync door's own idempotency); anything else must apply.
        result.Status.Should().BeOneOf(["applied", "duplicate"], $"{result.ErrorCode}: {result.ErrorMessage}");
        return id;
    }

    private async Task<SyncMutationResultDto> ReviseAsync(Guid actor, Guid log, int baseVersion, object content)
    {
        var result = await PushAsync(actor, "revise_log_content", $"l8c4-rev-{log:N}-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["baseVersion"] = baseVersion,
            ["content"] = content,
            ["reason"] = "दुरुस्ती",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    private async Task<List<Made>> TasksOfLogAsync(Guid log)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT w.id, w.title, w.scope, w.status, w.source, w.source_kind, w.source_daily_log_id, w.source_plot_id,
                   w.recorded_on::text, w.planned_date::text, w.loose_when, w.assignee_user_id, w.created_by_user_id, w.note,
                   (SELECT count(*) FROM ssf.planned_work_plots p WHERE p.planned_work_id = w.id)
            FROM ssf.planned_work w WHERE w.source_daily_log_id = @log ORDER BY w.title, w.id
            """;
        cmd.Parameters.AddWithValue("log", log);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<Made>();
        while (await reader.ReadAsync())
        {
            rows.Add(new Made(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5), reader.IsDBNull(6) ? null : reader.GetGuid(6),
                reader.IsDBNull(7) ? null : reader.GetGuid(7), reader.GetString(8), reader.IsDBNull(9) ? null : reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10), reader.IsDBNull(11) ? null : reader.GetGuid(11), reader.GetGuid(12),
                reader.IsDBNull(13) ? null : reader.GetString(13), (int)reader.GetInt64(14)));
        }

        return rows;
    }

    private static Guid IdOf(Guid log, string item) => PlannedWorkIds.ForSpokenItem(log, item);

    private async Task SetAudienceAsync(Guid actor, Guid log, string audience)
    {
        var result = await PushAsync(actor, "set_record_audience", $"l8c4-aud-{log:N}-{audience}-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["recordKind"] = "DailyLog",
            ["recordId"] = log,
            ["audience"] = audience,
            ["selectedUserIds"] = Array.Empty<Guid>(),
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
    }

    // ── Task 1: two items -> two tasks ────────────────────────────────────────────────────

    [Fact]
    public async Task A_log_with_two_planned_items_makes_two_of_his_own_reminders_marked_spoken()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(
            Item("t1", "पाईपलाईन दुरुस्त करायची", "उद्या"),
            Item("t2", "खत आणायचं")));

        var tasks = await TasksOfLogAsync(log);
        tasks.Should().HaveCount(2);
        tasks.Select(t => t.Id).Should().BeEquivalentTo([IdOf(log, "t1"), IdOf(log, "t2")], "the id is the same every time");

        var pipeline = tasks.Single(t => t.Title == "पाईपलाईन दुरुस्त करायची");
        pipeline.Source.Should().Be("VoiceLog");
        pipeline.SourceKind.Should().Be("Spoken");
        pipeline.SourceLog.Should().Be(log);
        pipeline.SourcePlot.Should().Be(PlotA, "the log's own plot");
        pipeline.RecordedOn.Should().Be(Day, "the log's day");
        pipeline.PlannedDate.Should().Be("2026-11-09", "a clear cue: उद्या from the log's day");
        pipeline.Assignee.Should().BeNull("his own reminder, handed to nobody");
        pipeline.CreatedBy.Should().Be(Mukadam, "the speaker");
        pipeline.Status.Should().Be("Open");
        pipeline.Scope.Should().Be("Unspecified", "he did not say where; the place is not fixed");
        pipeline.PlotRows.Should().Be(0);
        pipeline.LooseWhen.Should().BeNull();

        var khat = tasks.Single(t => t.Title == "खत आणायचं");
        khat.PlannedDate.Should().BeNull("no cue is no date - never today");
    }

    [Fact]
    public async Task An_unclear_cue_is_undated_and_a_clear_cue_is_dated()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(
            Item("a", "आज करायचं", "आज"),
            Item("b", "परवा करायचं", "परवा"),
            Item("c", "३ दिवसांनी करायचं", "३ दिवसांनी"),
            Item("d", "नंतर करायचं", "नंतर"),
            Item("e", "या आठवड्यात करायचं", "या आठवड्यात"),
            Item("f", "बिन तारखेचं", null)));

        var by = (await TasksOfLogAsync(log)).ToDictionary(t => t.Title, t => t.PlannedDate);
        by["आज करायचं"].Should().Be("2026-11-08");
        by["परवा करायचं"].Should().Be("2026-11-10");
        by["३ दिवसांनी करायचं"].Should().Be("2026-11-11");
        by["नंतर करायचं"].Should().BeNull("an unclear cue is never invented into a day");
        by["या आठवड्यात करायचं"].Should().BeNull();
        by["बिन तारखेचं"].Should().BeNull();
    }

    [Fact]
    public async Task Replaying_the_create_leaves_exactly_two()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var content = Content(Item("t1", "पाईपलाईन दुरुस्त करायची", "उद्या"), Item("t2", "खत आणायचं"));
        var log = await SaveLogAsync(Mukadam, content);
        var firstRows = await TasksOfLogAsync(log);

        // The same request again (the phone retried): the sync door answers "duplicate" and writes nothing.
        await SaveLogAsync(Mukadam, content, log);

        var after = await TasksOfLogAsync(log);
        after.Should().HaveCount(2);
        after.Select(t => (t.Id, t.Title)).Should().BeEquivalentTo(firstRows.Select(t => (t.Id, t.Title)));
        (await TaskCountAsync()).Should().Be(2, "no stray task anywhere");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'PlannedWork'")).Should().Be(2, "one audit row per task, none for a replay");
    }

    [Fact]
    public async Task A_revision_adding_a_third_item_makes_three_and_the_first_two_are_untouched()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(Item("t1", "पाईपलाईन दुरुस्त करायची", "उद्या"), Item("t2", "खत आणायचं")));
        var before = await TasksOfLogAsync(log);

        await ReviseAsync(Mukadam, log, 1, Content(
            Item("t1", "पाईपलाईन दुरुस्त करायची", "उद्या"),
            Item("t2", "खत आणायचं"),
            Item("t3", "औषध घ्यायचं", "परवा")));

        var after = await TasksOfLogAsync(log);
        after.Should().HaveCount(3);
        after.Single(t => t.Id == IdOf(log, "t3")).PlannedDate.Should().Be("2026-11-10");
        foreach (var old in before)
        {
            after.Single(t => t.Id == old.Id).Should().Be(old, "an item already in the log keeps its task exactly as it was");
        }
    }

    [Fact]
    public async Task A_revision_removing_an_item_leaves_its_task_and_a_revision_changing_its_words_leaves_the_task_as_it_was()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(
            Item("t1", "पाईपलाईन दुरुस्त करायची", "उद्या"), Item("t2", "खत आणायचं"), Item("t3", "औषध घ्यायचं")));
        var before = await TasksOfLogAsync(log);
        before.Should().HaveCount(3);

        // t3 removed, t1 reworded and re-dated, t2 kept: the log's own content follows him; his tasks do not (P3).
        await ReviseAsync(Mukadam, log, 1, Content(Item("t1", "पाईपलाईन बदलायची", "परवा"), Item("t2", "खत आणायचं")));

        var after = await TasksOfLogAsync(log);
        after.Should().HaveCount(3, "removing an item never deletes its task - he cancels it himself");
        after.Should().BeEquivalentTo(before, "nor does a changed word or day rewrite one");
    }

    [Fact]
    public async Task A_task_he_cancelled_is_not_made_again_by_a_later_revision_of_the_same_log()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(Item("t1", "पाईपलाईन दुरुस्त करायची"), Item("t2", "खत आणायचं")));
        (await StepAsync(Mukadam, "cancel", IdOf(log, "t1"))).Status.Should().Be("applied");

        await ReviseAsync(Mukadam, log, 1, Content(Item("t1", "पाईपलाईन दुरुस्त करायची"), Item("t2", "खत आणायचं"), Item("t3", "नवं")));

        var after = await TasksOfLogAsync(log);
        after.Should().HaveCount(3);
        after.Single(t => t.Id == IdOf(log, "t1")).Status.Should().Be("Cancelled", "cancelled stays cancelled; no second copy is made");
    }

    [Fact]
    public async Task A_correction_that_gives_the_same_words_new_item_ids_does_not_double_the_reminder()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(Item("old-1", "पाईपलाईन दुरुस्त करायची", "उद्या")));

        // The phone's correction flow mints fresh ids for the SAME words.
        await ReviseAsync(Mukadam, log, 1, Content(Item("new-1", "पाईपलाईन दुरुस्त करायची", "उद्या")));

        (await TasksOfLogAsync(log)).Should().ContainSingle("the same words are the same reminder");
    }

    // ── D-31: nothing of the log's words, no money, no labour ─────────────────────────────

    [Fact]
    public async Task The_task_never_carries_the_transcript_the_source_text_or_the_interpretation_and_nothing_else_is_written()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // A control: a log with the same shape and NO planned item. Whatever saving a log writes, a spoken reminder adds nothing.
        var beforeControl = await MoneyAndLabourRowsAsync();
        await SaveLogAsync(Mukadam, new Dictionary<string, object?> { ["schema"] = 1, ["fullTranscript"] = Said });
        var controlDelta = Delta(beforeControl, await MoneyAndLabourRowsAsync());

        var before = await MoneyAndLabourRowsAsync();
        before.Keys.Should().Contain(k => k.Contains("job_card") || k.Contains("cost") || k.Contains("attendance") || k.Contains("labour"),
            "the sweep reads the tables it claims to");
        var log = await SaveLogAsync(Mukadam, Content(Item("t1", "पाईपलाईन दुरुस्त करायची", "उद्या")));

        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT (SELECT string_agg(row_to_json(w)::text, ' ') FROM ssf.planned_work w WHERE w.source_daily_log_id = @log)
                || ' ' || coalesce((SELECT string_agg(payload::text, ' ') FROM ssf.audit_events WHERE entity_type = 'PlannedWork'), '')
                || ' ' || coalesce((SELECT string_agg(row_to_json(p)::text, ' ') FROM ssf.planned_work_plots p), '')
            """;
        cmd.Parameters.AddWithValue("log", log);
        var everything = (string)(await cmd.ExecuteScalarAsync())!;
        everything.Should().Contain("पाईपलाईन दुरुस्त करायची", "control: the task's own short title is there");
        everything.Should().NotContain("फवारणी केली", "the transcript");
        everything.Should().NotContain("आणि खत आणायचं", "the item's source text");
        everything.Should().NotContain(Interpreted, "the interpretation");

        Delta(before, await MoneyAndLabourRowsAsync()).Should().BeEquivalentTo(controlDelta,
            "no attendance, wage, job card or cost is written by a spoken reminder (D-24a / P4)");
        var row = (await TasksOfLogAsync(log)).Single();
        row.Note.Should().BeNull();
    }

    private async Task<Dictionary<string, long>> MoneyAndLabourRowsAsync()
    {
        var tables = new List<string>();
        await using (var db = new NpgsqlConnection(SuperuserConn))
        {
            await db.OpenAsync();
            await using var cmd = db.CreateCommand();
            cmd.CommandText = """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'ssf' AND table_type = 'BASE TABLE'
                  AND (table_name ~ 'job_card|cost|attendance|labour|wage|payment|ledger|settle|finance|allocation|money')
                ORDER BY table_name
                """;
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                tables.Add(reader.GetString(0));
            }
        }

        var counts = new Dictionary<string, long>();
        foreach (var table in tables)
        {
            counts[table] = await CountAsync($"SELECT count(*) FROM ssf.\"{table}\"");
        }

        return counts;
    }

    private static Dictionary<string, long> Delta(Dictionary<string, long> before, Dictionary<string, long> after) =>
        after.Where(kv => kv.Value != before.GetValueOrDefault(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value - before.GetValueOrDefault(kv.Key));

    [Fact]
    public async Task One_audit_row_per_task_by_the_speaker_with_the_four_fields_and_no_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(Item("t1", "पाईपलाईन दुरुस्त करायची", "उद्या"), Item("t2", "खत आणायचं")));

        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT entity_id, action, actor_user_id, payload::text, farm_id FROM ssf.audit_events WHERE entity_type = 'PlannedWork' ORDER BY entity_id";
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<(Guid Id, string Action, Guid Actor, string Payload, Guid Farm)>();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetGuid(0), reader.GetString(1), reader.GetGuid(2), reader.GetString(3), reader.GetGuid(4)));
        }

        rows.Select(r => r.Id).Should().BeEquivalentTo([IdOf(log, "t1"), IdOf(log, "t2")]);
        rows.Should().OnlyContain(r => r.Actor == Mukadam && r.Farm == FarmA && r.Action == "PlannedWorkCreatedFromVoice");
        foreach (var row in rows)
        {
            using var payload = JsonDocument.Parse(row.Payload);
            // The ledger writes its payload keys in camelCase (the audit factory's serializer); the four fields are the same four.
            payload.RootElement.EnumerateObject().Select(p => p.Name.ToLowerInvariant()).Should().BeEquivalentTo(["plannedworkid", "farmid", "status", "step"]);
            payload.RootElement.EnumerateObject().Single(p => p.Name.Equals("step", StringComparison.OrdinalIgnoreCase)).Value.GetString().Should().Be("CreatedFromVoice");
            row.Payload.Should().NotContain("पाईपलाईन").And.NotContain("खत");
        }
    }

    // ── E4: a place the farm does not own ─────────────────────────────────────────────────

    [Fact]
    public async Task An_item_naming_another_farms_plot_falls_back_to_not_fixed_and_the_log_still_saves()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plotA2, _) = await SeedSeasonAsync("Sugarcane");
        var log = await SaveLogAsync(Mukadam, Content(
            Item("foreign", "दुसऱ्या शेताचं काम", plotId: PlotB.ToString()),
            Item("own", "याच शेताच्या दुसऱ्या प्लॉटचं काम", plotId: plotA2.ToString()),
            Item("anchor", "याच प्लॉटचं काम", plotId: PlotA.ToString()),
            Item("made-up", "भलतंच", plotId: Guid.NewGuid().ToString())));

        var by = (await TasksOfLogAsync(log)).ToDictionary(t => t.Title);
        by["दुसऱ्या शेताचं काम"].Scope.Should().Be("Unspecified", "E4: another farm's plot is never trusted");
        by["दुसऱ्या शेताचं काम"].PlotRows.Should().Be(0);
        by["भलतंच"].Scope.Should().Be("Unspecified", "a plot nobody has is the same answer");
        by["याच शेताच्या दुसऱ्या प्लॉटचं काम"].Scope.Should().Be("Plot", "a plot of this farm the item itself names");
        by["याच शेताच्या दुसऱ्या प्लॉटचं काम"].PlotRows.Should().Be(1);
        by["याच प्लॉटचं काम"].Scope.Should().Be("Unspecified", "the log's own plot is where he was, not a place he said (it is the source plot)");
        by["याच प्लॉटचं काम"].SourcePlot.Should().Be(PlotA);
    }

    // ── D-26 / D-79: who sees it, and a log hidden "फक्त मी" ───────────────────────────────

    [Fact]
    public async Task His_reminder_is_seen_by_him_and_the_owner_and_by_nobody_else_without_the_grant()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(Item("t1", "पाईपलाईन दुरुस्त करायची")));
        var id = IdOf(log, "t1");

        var speakerPull = await PullAsync(Mukadam);
        var ownerPull = await PullAsync(Owner);
        PlannedIds(speakerPull.Root).Should().Contain(id, "the speaker");
        PlannedIds(ownerPull.Root).Should().Contain(id, "the primary owner");
        KeepPullBody("speaker", speakerPull.Body);
        KeepPullBody("owner", ownerPull.Body);
        foreach (var other in new[] { CoOwner, Worker, Worker2 })
        {
            PlannedIds((await PullAsync(other)).Root).Should().NotContain(id, "an unrelated seat gets nothing, not even a hint");
            (await GetAsync(other, TaskUrl(id))).Status.Should().Be(HttpStatusCode.NotFound);
        }
    }

    [Fact]
    public async Task A_log_hidden_phakt_mi_yields_tasks_only_its_maker_and_the_owner_see_and_a_holder_who_had_them_is_told_to_forget_them()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GrantAsync(CoOwner, FarmAuthority.SeeAllTasks);
        var log = await SaveLogAsync(Mukadam, Content(Item("t1", "पाईपलाईन दुरुस्त करायची"), Item("t2", "खत आणायचं")));
        var ids = new[] { IdOf(log, "t1"), IdOf(log, "t2") };

        // Control: while the log is the team's, the holder of "see all tasks" sees them.
        PlannedIds((await PullAsync(CoOwner)).Root).Should().Contain(ids, "control: SeeAllTasks widens the base");
        var cursor = await CursorAfterNowAsync();

        await SetAudienceAsync(Owner, log, "OnlyMe");

        PlannedIds((await PullAsync(Mukadam)).Root).Should().Contain(ids, "the maker keeps what he said");
        PlannedIds((await PullAsync(Owner)).Root).Should().Contain(ids, "the primary owner");
        PlannedIds((await PullAsync(CoOwner)).Root).Should().NotContain(ids, "hidden from the team, hidden from its tasks");
        foreach (var id in ids)
        {
            (await GetAsync(CoOwner, TaskUrl(id))).Status.Should().Be(HttpStatusCode.NotFound, "REST follows the pull");
            (await GetAsync(Mukadam, TaskUrl(id))).Status.Should().Be(HttpStatusCode.OK);
            (await GetAsync(Owner, TaskUrl(id))).Status.Should().Be(HttpStatusCode.OK);
        }

        // The phone of the holder that already had them is told, content-free, to forget them (once the change's second is over).
        await Task.Delay(TimeSpan.FromMilliseconds(1100));
        var (_, since) = await PullAsync(CoOwner, cursor);
        Withdrawn(since).Where(w => w.Kind == "PlannedWork").Select(w => w.Id).Should().Contain(ids);

        // Back to the team: they come back to him.
        await SetAudienceAsync(Owner, log, "Team");
        PlannedIds((await PullAsync(CoOwner)).Root).Should().Contain(ids);
    }

    [Fact]
    public async Task The_audit_row_of_a_spoken_task_is_hidden_from_whoever_the_log_is_hidden_from()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The सहमालक may read the farm's whole trail (money rights, every plot) and holds SeeAllTasks - but the log is hidden "फक्त मी".
        await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET permissions = 1 | 2 | 256 WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", CoOwner));
        await GrantAsync(CoOwner, FarmAuthority.SeeAllTasks, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        var log = await SaveLogAsync(Mukadam, Content(Item("t1", "पाईपलाईन दुरुस्त करायची")));
        var id = IdOf(log, "t1");
        var trail = $"/shramsafal/audit?entityType=PlannedWork&entityId={id}&farmId={FarmA}";

        JsonDocument.Parse((await GetAsync(CoOwner, trail)).Body).RootElement.GetArrayLength().Should().Be(1, "control: while the log is the team's he reads the trail");

        await SetAudienceAsync(Owner, log, "OnlyMe");

        JsonDocument.Parse((await GetAsync(CoOwner, trail)).Body).RootElement.GetArrayLength().Should().Be(0, "the log is hidden from him, so is its task's trail");
        JsonDocument.Parse((await GetAsync(Owner, trail)).Body).RootElement.GetArrayLength().Should().Be(1, "the owner keeps it");
        var stream = JsonDocument.Parse((await GetAsync(CoOwner, $"/shramsafal/audit?farmId={FarmA}")).Body).RootElement;
        stream.EnumerateArray().Count(e => e.GetProperty("entityType").GetString() == "PlannedWork").Should().Be(0);
    }

    [Fact]
    public async Task A_task_made_by_a_later_revision_of_an_already_hidden_log_is_hidden_the_same()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GrantAsync(CoOwner, FarmAuthority.SeeAllTasks);
        var log = await SaveLogAsync(Mukadam, Content(Item("t1", "पाईपलाईन दुरुस्त करायची")));
        await SetAudienceAsync(Owner, log, "OnlyMe");

        await ReviseAsync(Mukadam, log, 1, Content(Item("t1", "पाईपलाईन दुरुस्त करायची"), Item("t2", "खत आणायचं")));

        PlannedIds((await PullAsync(CoOwner)).Root).Should().NotContain([IdOf(log, "t1"), IdOf(log, "t2")]);
        PlannedIds((await PullAsync(Mukadam)).Root).Should().Contain([IdOf(log, "t1"), IdOf(log, "t2")]);
    }

    // ── P11: a log a 1.0.17 phone saved ───────────────────────────────────────────────────

    [Fact]
    public async Task A_log_saved_by_a_1_0_17_manual_save_also_yields_its_tasks_with_the_same_rule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // 1.0.17 sends no `content`: a manual save carries `manualDraft`, and a typed reminder is filed under the log's day.
        var log = await SaveLogAsync(Mukadam, null, more: new Dictionary<string, object?>
        {
            ["manualDraft"] = new Dictionary<string, object?>
            {
                ["plannedTasks"] = new object[]
                {
                    new Dictionary<string, object?>
                    {
                        ["id"] = "legacy-1", ["title"] = "ठिबकची नळी तपासायची", ["status"] = "pending", ["priority"] = "normal",
                        ["sourceType"] = "observation_derived", ["plotId"] = "FARM_GLOBAL", ["cropId"] = "FARM_GLOBAL",
                        ["dueDate"] = Day, ["createdAt"] = "2026-11-08T05:00:00.000Z",
                    },
                },
            },
        });

        var tasks = await TasksOfLogAsync(log);
        tasks.Should().ContainSingle();
        tasks[0].Title.Should().Be("ठिबकची नळी तपासायची");
        tasks[0].PlannedDate.Should().BeNull("a typed reminder was filed under the log's day (\"today by default\"); that is not a clear cue (D-29)");
        tasks[0].SourceKind.Should().Be("Typed", "typed in a manual save, not spoken");
        tasks[0].CreatedBy.Should().Be(Mukadam);
        tasks[0].Id.Should().Be(IdOf(log, "legacy-1"));
    }

    [Fact]
    public async Task A_log_pushed_by_release_1_0_17s_own_mutation_builder_yields_the_same_task()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The manual-save payload release b3d28967 builds (its own LogFactory + buildManualDraft, captured with git show): the typed
        // reminder is filed under the log's own day, "today by default".
        using var captured = JsonDocument.Parse(File.ReadAllText(FixturePath("release-1017-manual-save-reminder.json")));
        var draft = JsonSerializer.Deserialize<Dictionary<string, object?>>(captured.RootElement.GetProperty("manualDraft").GetRawText())!;
        var itemId = captured.RootElement.GetProperty("manualDraft").GetProperty("plannedTasks")[0].GetProperty("id").GetString()!;
        var title = captured.RootElement.GetProperty("manualDraft").GetProperty("plannedTasks")[0].GetProperty("title").GetString()!;
        captured.RootElement.GetProperty("manualDraft").GetProperty("plannedTasks")[0].GetProperty("dueDate").GetString().Should().Be(Day, "control: 1.0.17 files it under the log's day");

        var log = await SaveLogAsync(Mukadam, null, more: new Dictionary<string, object?> { ["manualDraft"] = draft });

        var tasks = await TasksOfLogAsync(log);
        tasks.Should().ContainSingle();
        tasks[0].Id.Should().Be(IdOf(log, itemId));
        tasks[0].Title.Should().Be(title);
        tasks[0].PlannedDate.Should().BeNull("a date with no cue behind it is not a clear cue (D-29)");
        tasks[0].Source.Should().Be("Planning");
        tasks[0].SourceKind.Should().Be("Typed");
        tasks[0].Assignee.Should().BeNull();
        tasks[0].CreatedBy.Should().Be(Mukadam);
    }

    /// <summary>
    /// Evidence for the P11 check (release 1.0.17's own pull code on the bodies THIS server sends): when <c>L8C4_P11_BODIES</c> names
    /// a folder, the raw pull bodies of this fact are kept there. Without it nothing is written.
    /// </summary>
    private static void KeepPullBody(string who, string body)
    {
        if (Environment.GetEnvironmentVariable("L8C4_P11_BODIES") is { Length: > 0 } folder)
        {
            Directory.CreateDirectory(folder);
            File.WriteAllText(Path.Combine(folder, $"l8c4-spoken-{who}.json"), body);
        }
    }

    private static string FixturePath(string name)
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "sync-contract", "tests", "fixtures", name);
            if (File.Exists(candidate))
            {
                return candidate;
            }

            current = current.Parent;
        }

        throw new FileNotFoundException($"sync-contract/tests/fixtures/{name} was not found above the test output.");
    }

    [Fact]
    public async Task A_log_a_1_0_17_phone_confirmed_from_its_voice_parse_yields_the_parses_planned_items_by_place()
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
            ("id", job), ("key", $"l8c4-{job:N}"), ("uid", Mukadam), ("fid", FarmA),
            ("json", """{"plannedTasks":[{"title":"पाईपलाईन दुरुस्त करायची","dueHint":"उद्या","category":"maintenance","sourceText":"उद्या पाईपलाईन","systemInterpretation":"x"},{"title":"खत आणायचं","dueHint":null,"category":"procurement","sourceText":"खत","systemInterpretation":"y"}],"fullTranscript":"आज फवारणी केली उद्या पाईपलाईन दुरुस्त करायची"}"""));

        var log = await SaveLogAsync(Mukadam, null, more: new Dictionary<string, object?> { ["sourceAiJobId"] = job });

        var tasks = await TasksOfLogAsync(log);
        tasks.Should().HaveCount(2);
        tasks.Select(t => t.Id).Should().BeEquivalentTo([PlannedWorkIds.ForJobItem(log, 0), PlannedWorkIds.ForJobItem(log, 1)]);
        tasks.Single(t => t.Title == "पाईपलाईन दुरुस्त करायची").PlannedDate.Should().Be("2026-11-09");
        tasks.Should().OnlyContain(t => t.Source == "VoiceLog" && t.SourceKind == "Spoken" && t.CreatedBy == Mukadam);

        // The same request again is still two.
        await SaveLogAsync(Mukadam, null, log, new Dictionary<string, object?> { ["sourceAiJobId"] = job });
        (await TasksOfLogAsync(log)).Should().HaveCount(2);
    }

    [Fact]
    public async Task A_new_phone_that_sends_both_the_content_and_its_voice_parse_makes_each_task_once()
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
            ("id", job), ("key", $"l8c4-{job:N}"), ("uid", Mukadam), ("fid", FarmA),
            ("json", """{"plannedTasks":[{"title":"पाईपलाईन दुरुस्त करायची","dueHint":"उद्या"}]}"""));

        var log = await SaveLogAsync(Mukadam, Content(Item("t1", "पाईपलाईन दुरुस्त करायची", "उद्या")), more: new Dictionary<string, object?> { ["sourceAiJobId"] = job });

        (await TasksOfLogAsync(log)).Should().ContainSingle("the content is the statement; the parse is only the fallback when there is none");
    }

    // ── It does not break what was there ──────────────────────────────────────────────────

    [Fact]
    public async Task The_one_time_upload_of_an_old_to_do_is_accepted_as_his_own_typed_reminder_and_is_on_a_second_device()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // Exactly the payload the phone's one-time upload queues (legacyTodoUpload.ts): an id derived from the OLD to-do's id, the whole
        // farm, a typed reminder, and NO "made on" day (an old to-do may be weeks old: the server uses its own).
        var id = Guid.Parse("ff9e753e-a078-550e-8888-683f199d09b7"); // legacyTodoTaskId('task_1730000000000'), pinned by planned-work-ids.json
        var created = await PushAsync(Mukadam, "plannedwork.create", $"plannedwork.create:{id}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = id,
            ["farmId"] = FarmA,
            ["title"] = "ठिबकची नळी तपासायची",
            ["scope"] = "Farm",
            ["plotIds"] = Array.Empty<Guid>(),
            ["plannedDate"] = "2026-11-12",
            ["sourceKind"] = "Typed",
        });
        created.Status.Should().Be("applied", $"{created.ErrorCode}: {created.ErrorMessage}");
        // A resend of the same change (the upload ran twice) is the same task.
        var again = await PushAsync(Mukadam, "plannedwork.create", $"plannedwork.create:{id}:again", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = id,
            ["farmId"] = FarmA,
            ["title"] = "ठिबकची नळी तपासायची",
            ["scope"] = "Farm",
            ["plotIds"] = Array.Empty<Guid>(),
            ["plannedDate"] = "2026-11-12",
            ["sourceKind"] = "Typed",
        });
        again.Status.Should().Be("applied");
        (await TaskCountAsync()).Should().Be(1);

        var row = (await RowAsync(id))!;
        row.Title.Should().Be("ठिबकची नळी तपासायची");
        row.Scope.Should().Be("Farm");
        row.Assignee.Should().BeNull();
        row.CreatedBy.Should().Be(Mukadam);
        // The same person signing in on a second device has it; the owner sees it too (D-79); a stranger does not.
        PlannedIds((await PullAsync(Mukadam)).Root).Should().Contain(id);
        PlannedIds((await PullAsync(Owner)).Root).Should().Contain(id);
        PlannedIds((await PullAsync(Worker)).Root).Should().NotContain(id);
    }

    [Fact]
    public async Task A_log_with_no_planned_items_or_no_details_at_all_makes_no_task_and_still_saves()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var plain = await SaveLogAsync(Mukadam, null);
        var empty = await SaveLogAsync(Mukadam, new Dictionary<string, object?> { ["schema"] = 1 });
        var done = await SaveLogAsync(Mukadam, Content(Item("t1", "झालेलं", status: "done")));

        (await TasksOfLogAsync(plain)).Should().BeEmpty();
        (await TasksOfLogAsync(empty)).Should().BeEmpty();
        (await TasksOfLogAsync(done)).Should().BeEmpty("a finished item is not a reminder");
        (await TaskCountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task The_task_follows_the_normal_doors_afterwards_he_can_tick_it_done_with_no_log_and_cancel_it_himself()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await SaveLogAsync(Mukadam, Content(Item("t1", "पाईपलाईन दुरुस्त करायची"), Item("t2", "खत आणायचं")));

        var done = await PushAsync(Mukadam, "plannedwork.complete", $"l8c4-done-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = IdOf(log, "t1"),
            ["farmId"] = FarmA,
            ["plotIds"] = Array.Empty<Guid>(),
            ["dailyLogIds"] = Array.Empty<Guid>(),
            ["somethingLeft"] = false,
        });
        done.Status.Should().Be("applied", $"{done.ErrorCode}: {done.ErrorMessage}");
        (await StepAsync(Mukadam, "cancel", IdOf(log, "t2"))).Status.Should().Be("applied");

        var after = (await TasksOfLogAsync(log)).ToDictionary(t => t.Id, t => t.Status);
        after[IdOf(log, "t1")].Should().Be("Done");
        after[IdOf(log, "t2")].Should().Be("Cancelled");

        // After sync, the same on the owner's phone: one reminder done, the other gone.
        var owners = TasksOf((await PullAsync(Owner)).Root).ToDictionary(t => t.GetProperty("id").GetGuid(), t => t.GetProperty("status").GetString());
        owners[IdOf(log, "t1")].Should().Be("Done");
        owners[IdOf(log, "t2")].Should().Be("Cancelled");
    }
}
