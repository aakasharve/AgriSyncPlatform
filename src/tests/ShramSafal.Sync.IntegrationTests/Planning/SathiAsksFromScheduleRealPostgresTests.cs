// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12, "ShramSathi asks from the schedule"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// The stage questions ShramSathi asks come from the task a plot FOLLOWS (its main schedule version in the task format) or OWNS (its own works), not from the embedded
// schedule. A question that states agronomy is recorded only when the line it names (`task:{key}:look` or `:ask`) resolves to a real source on the server: the phone names
// the task, never a document. A reference task that names no source is never asked (askOnlyWithSource); the hand-made work of the farmer may be, labelled as his own
// experience (ownExperienceIsLabelled); a taken work keeps the source of its origin. The embedded schedule answers only for a plot with no task-format schedule and no
// own work. An "unsure" answer is kept and changes nothing else (unsureChangesNothing).
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host (HTTP for the question, the real push handler for the answer); the switch row and the
// arrangement are written as superuser. Fake numbers only; no dose from any real schedule.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class SathiAsksFromScheduleRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private const string Save = "ownschedule.item.save";
    private const string Take = "schedule.take_task";
    private const string TaskEvent = "schedule.task_event";
    private const string Book = "gap-table-grapes-2013";
    private const string EmbeddedLine = "grapes-table-oct-fruit-pruning/sprout.0";

    // ---- the reference schedule the plot follows (format 2, checked) -----------------------------------------------------

    private static JsonElement Canonical(ScheduleTaskContent t) => JsonDocument.Parse(t.ToCanonicalJson()).RootElement.Clone();

    private static object StageBody(string name, int start, int end) => new { name, startDay = start, endDay = end, startSign = (string?)null, endSign = (string?)null };

    private static readonly ScheduleTaskLook ABud = new(Where: "द्राक्षवेल", Sign: "कळ्या फुटलेल्या दिसतात");

    /// <summary>One task with a source, one with none, one our own choice, one with an ask (a source with no page) - all stored at day 40.</summary>
    private static IReadOnlyList<ScheduleTaskContent> SourceTasks() =>
    [
        new("t-look", "कळी तपासणी", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(40), ScheduleBasis.Stated, 0, 0,
            Look: ABud, Sources: [new ScheduleSource(Book, "19")]),
        new("t-nosrc", "कळी तपासणी २", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(40), ScheduleBasis.Stated, 0, 1, Look: ABud),
        new("t-ours", "कळी तपासणी ३", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(40), ScheduleBasis.OurChoice, 0, 2,
            Look: ABud, Sources: [new ScheduleSource(Book, "20")]),
        new("t-ask", "प्रश्न", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(40), ScheduleBasis.Stated, 0, 3,
            Ask: new ScheduleTaskAsk("फुटवा किती दिसतो?"), Sources: [new ScheduleSource(Book, null)]),
    ];

    private bool _seatsSeededHere;

    private async Task<Guid> ImportAndCheckAsync()
    {
        if (!_seatsSeededHere)
        {
            _seatsSeededHere = true;
            await SeedReviewSeatsAsync();
        }

        var body = new
        {
            format = 2,
            name = "द्राक्ष: चाचणी संदर्भ",
            cropKey = "grape",
            ownerType = "INSTITUTION",
            sourceLabel = "चाचणी पुस्तिका",
            previousVersionId = (Guid?)null,
            stages = new[] { StageBody("छाटणी आणि फूट", 0, 40), StageBody("मण्यांची वाढ", 41, 99) },
            tasks = SourceTasks().Select(Canonical).ToArray(),
            challenges = Array.Empty<object>(),
        };
        var (status, text) = await SendJsonAsync(HttpMethod.Post, "/shramsafal/schedule-templates/import/format-2", PlatformOwner, body);
        status.Should().Be(HttpStatusCode.Created, text);
        var id = Json(text).GetProperty("templateId").GetGuid();

        var (vs, vt) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{id}/check-view", PlatformEmployee, null);
        vs.Should().Be(HttpStatusCode.OK, vt);
        var view = Json(vt);
        var (ok, okText) = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{id}/check", PlatformEmployee, new
        {
            decision = "Approved",
            checkedActivityIds = Array.Empty<Guid>(),
            checkerDisplayName = DisplayName,
            checkedTaskKeys = view.GetProperty("tasks").EnumerateArray().Select(e => e.GetProperty("taskKey").GetString()!).ToArray(),
            checkedChallengeKeys = Array.Empty<string>(),
            contentHash = view.GetProperty("contentHash").GetString(),
        });
        ok.Should().Be(HttpStatusCode.OK, okText);
        return id;
    }

    // ---- arrangement -----------------------------------------------------------------------------------------------

    private Task SwitchOnAsync(params Guid[] farms) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.feature_flags (id, flag_name, enabled, cohort_pattern, description, modified_at_utc, modified_by)
        VALUES (gen_random_uuid(), 'schedule_mechanism', TRUE, @cohort, 'slice-12 test row', NOW(), 'test')
        ON CONFLICT (flag_name) DO UPDATE SET enabled = TRUE, cohort_pattern = EXCLUDED.cohort_pattern, modified_at_utc = NOW();
        """, ("cohort", string.Join('|', farms.Select(f => f.ToString()))));

    /// <summary>A grape season whose day 1 was 41 days ago (shown day 42 today), following the checked reference.</summary>
    private async Task<(Guid Plot, Guid Cycle, Guid Source)> FollowingAsync()
    {
        var src = await ImportAndCheckAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("grape", TodayIst().AddDays(-41));
        await PushAdoptAsync(Owner, plot, cycle, src);
        return (plot, cycle, src);
    }

    private async Task<SyncMutationResultDto> OkAsync(Task<SyncMutationResultDto> push)
    {
        var result = await push;
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    private Task<SyncMutationResultDto> SaveOwnAsync(Guid plot, Guid cycle, ScheduleTaskContent task) =>
        PushAsAsync(Owner, Save, $"own-save-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle, ["task"] = Canonical(task) }, "1.0.18");

    private Task<SyncMutationResultDto> TakeAsync(Guid plot, Guid cycle, Guid source, string key) =>
        PushAsAsync(Owner, Take, $"take-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle, ["sourceVersionId"] = source, ["taskKey"] = key }, "1.0.18");

    private Task<SyncMutationResultDto> AnswerSignAsync(Guid plot, Guid cycle, string key, string answer) =>
        PushAsAsync(Owner, TaskEvent, $"sign-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["eventId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["taskKey"] = key,
            ["answer"] = answer,
        }, "1.0.18");

    /// <summary>The own work the farmer made by hand: written as his own experience, no document.</summary>
    private static ScheduleTaskContent ByHand(string key, ScheduleTaskTiming? timing = null) =>
        new(key, "माझी कळी तपासणी", ScheduleTaskKind.Observe, timing ?? ScheduleTaskTiming.OnDays(40), ScheduleBasis.Experience, 0, 0, Look: ABud);

    /// <summary>POST /shramsafal/question-events as a phone sends a stage question that names these lines.</summary>
    private Task<(HttpStatusCode Status, string Body)> AskAsync(Guid plot, string answer, params string[] lines) =>
        SendJsonAsync(HttpMethod.Post, "/shramsafal/question-events", Owner, new
        {
            farmId = FarmA,
            plotId = plot,
            dailyLogId = (Guid?)null,
            questionKey = "stage.look",
            crop = "grape",
            expectedStage = (string?)null,
            actualStageApplicability = "current_stage",
            anchorDateType = "stage_start",
            triggerType = "StageWindow",
            questionType = "observation",
            lens = "Insight",
            depthLevel = 2,
            priority = 3,
            cooldown = 2,
            answerModes = "voice",
            safetyClass = "informational",
            agronomistApproved = false,
            marathiApproved = true,
            bankVersion = "test",
            questionEngineVersion = "test",
            shownAtUtc = DateTime.UtcNow,
            response = answer,
            promptText = "कळ्या फुटलेल्या दिसतात का?",
            promptOrigin = "pattern",
            lookLineIds = lines,
        });

    private async Task<string> SourceRefsAsync(Guid plot)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT coalesce(string_agg(source_refs::text, '|' ORDER BY created_at_utc), '') FROM ssf.question_events WHERE plot_id = @p";
        cmd.Parameters.AddWithValue("p", plot);
        return (await cmd.ExecuteScalarAsync())?.ToString() ?? string.Empty;
    }

    private Task<long> QuestionRowsAsync(Guid plot) => CountAsync("SELECT count(*) FROM ssf.question_events WHERE plot_id = @p", ("p", plot));

    private async Task<string> FingerprintAsync(string sql)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return (await cmd.ExecuteScalarAsync())?.ToString() ?? string.Empty;
    }

    // ---- askOnlyWithSource -------------------------------------------------------------------------------------------

    [Fact]
    public async Task askOnlyWithSource_ReferenceTaskWithSource_IsAsked_AndTheServerStoresThatSource()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _) = await FollowingAsync();

        var (status, body) = await AskAsync(plot, "दिसलं", "task:t-look:look");

        status.Should().Be(HttpStatusCode.OK, body);
        var refs = await SourceRefsAsync(plot);
        refs.Should().Contain($"\"docId\": \"{Book}\"").And.Contain("\"page\": \"19\"").And.Contain("\"lineId\": \"task:t-look:look\"");
        refs.Should().NotContain("own-experience");
    }

    [Fact]
    public async Task askOnlyWithSource_ReferenceTaskWithNoSource_OrOurOwnChoice_IsNeverAsked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _) = await FollowingAsync();

        (await AskAsync(plot, "दिसलं", "task:t-nosrc:look")).Status.Should().Be(HttpStatusCode.BadRequest, "a reference task that names no source document is never asked");
        (await AskAsync(plot, "दिसलं", "task:t-ours:look")).Status.Should().Be(HttpStatusCode.BadRequest, "our own choice is not a source, even with a document beside it");
        (await AskAsync(plot, "दिसलं", "task:t-look:ask")).Status.Should().Be(HttpStatusCode.BadRequest, "a task with no question has nothing to ask");
        (await AskAsync(plot, "दिसलं", "task:t-nobody:look")).Status.Should().Be(HttpStatusCode.BadRequest, "a task that is not in the schedule");
        (await AskAsync(plot, "दिसलं", "task:t-look:look", "task:t-nosrc:look")).Status.Should().Be(HttpStatusCode.BadRequest, "one line without a source refuses the whole question");
        (await QuestionRowsAsync(plot)).Should().Be(0, "a refused question writes nothing");
    }

    [Fact]
    public async Task askOnlyWithSource_ASourceWithNoPage_StillStandsOnItsDocument()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _) = await FollowingAsync();

        var (status, body) = await AskAsync(plot, "थोडा", "task:t-ask:ask");

        status.Should().Be(HttpStatusCode.OK, body);
        (await SourceRefsAsync(plot)).Should().Contain($"\"docId\": \"{Book}\"");
    }

    // ---- ownExperienceIsLabelled ---------------------------------------------------------------------------------------

    [Fact]
    public async Task ownExperienceIsLabelled_AHandMadeWork_IsAsked_AndItsSourceIsHisOwnExperience_NeverABookOrShramSafal()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, _) = await FollowingAsync();
        await OkAsync(SaveOwnAsync(plot, cycle, ByHand("my-look")));

        var (status, body) = await AskAsync(plot, "दिसलं", "task:my-look:look");

        status.Should().Be(HttpStatusCode.OK, body);
        var refs = await SourceRefsAsync(plot);
        refs.Should().Contain("\"docId\": \"own-experience\"");
        refs.Should().NotContain(Book).And.NotContain("shramsafal", "the work of the farmer is never labelled as a book or as ShramSafal");
    }

    [Fact]
    public async Task ownExperienceIsLabelled_ATakenWork_KeepsItsOriginsSource_NotTheLabelOfHisOwnExperience()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();
        await OkAsync(TakeAsync(plot, cycle, source, "t-look"));

        var (status, body) = await AskAsync(plot, "दिसलं", "task:t-look:look");

        status.Should().Be(HttpStatusCode.OK, body);
        var refs = await SourceRefsAsync(plot);
        refs.Should().Contain($"\"docId\": \"{Book}\"").And.Contain("\"page\": \"19\"");
        refs.Should().NotContain("own-experience");
    }

    // ---- the embedded schedule is the fallback ONLY ----------------------------------------------------------------------

    [Fact]
    public async Task Fallback_APlotWithNoTaskFormatSchedule_AndNoOwnWork_StillUsesTheEmbeddedSchedule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _) = await SeedSeasonStartingAsync("grape", TodayIst().AddDays(-41));

        var (status, body) = await AskAsync(plot, "दिसलं", EmbeddedLine);
        var (taskStatus, _) = await AskAsync(plot, "दिसलं", "task:t-look:look");

        status.Should().Be(HttpStatusCode.OK, body);
        (await SourceRefsAsync(plot)).Should().Contain("\"lineId\": \"" + EmbeddedLine + "\"");
        taskStatus.Should().Be(HttpStatusCode.BadRequest, "a plot with no task-format schedule has no task to ask about");
    }

    [Fact]
    public async Task Fallback_APlotThatFollowsATaskFormatSchedule_NoLongerAcceptsTheEmbeddedLines()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _) = await FollowingAsync();

        (await AskAsync(plot, "दिसलं", EmbeddedLine)).Status.Should().Be(HttpStatusCode.BadRequest);
        (await AskAsync(plot, "दिसलं", "task:t-look:look", EmbeddedLine)).Status.Should().Be(HttpStatusCode.BadRequest, "a mix of task lines and embedded lines is refused whole");
    }

    // ---- unsureChangesNothing --------------------------------------------------------------------------------------------

    private const string OwnFingerprint =
        "SELECT coalesce(string_agg(id::text || ':' || revision || ':' || content_hash || ':' || state, '|' ORDER BY id), '') FROM ssf.own_schedule_items";

    private const string PlanFingerprint =
        "SELECT coalesce(string_agg(id::text || ':' || status || ':' || coalesce(planned_date::text, '') || ':' || coalesce(schedule_due_on::text, ''), '|' ORDER BY id), '') FROM ssf.planned_work";

    [Fact]
    public async Task unsureChangesNothing_AnUnsureAnswer_IsKept_AndNoPlanOwnWorkOrLogMoves()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle) = await SeedSeasonStartingAsync("grape", TodayIst().AddDays(-41));
        await OkAsync(SaveOwnAsync(plot, cycle, ByHand("flower-sign", ScheduleTaskTiming.WhenSeen("फुलोरा सुरू", 38, 44))));

        var ownBefore = await FingerprintAsync(OwnFingerprint);
        var plansBefore = await FingerprintAsync(PlanFingerprint);
        var logsBefore = await CountAsync("SELECT count(*) FROM ssf.daily_logs");
        var revisionsBefore = await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions");
        var templatesBefore = await CountAsync("SELECT count(*) FROM ssf.schedule_templates");

        var (status, body) = await AskAsync(plot, "खात्री नाही", "task:flower-sign:look");
        status.Should().Be(HttpStatusCode.OK, body);
        await OkAsync(AnswerSignAsync(plot, cycle, "flower-sign", "unsure"));

        (await CountAsync("SELECT count(*) FROM ssf.schedule_task_events WHERE plot_id = @p AND task_key = 'flower-sign' AND answer = 'unsure'", ("p", plot)))
            .Should().Be(1, "the answer is kept");
        (await QuestionRowsAsync(plot)).Should().Be(1);
        (await FingerprintAsync(OwnFingerprint)).Should().Be(ownBefore, "unsure changes no own work");
        (await FingerprintAsync(PlanFingerprint)).Should().Be(plansBefore, "unsure makes and moves no plan");
        (await CountAsync("SELECT count(*) FROM ssf.daily_logs")).Should().Be(logsBefore, "unsure writes no log");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions")).Should().Be(revisionsBefore);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(templatesBefore, "unsure changes no schedule");
    }

    [Fact]
    public async Task AnAnswerOfSeen_WritesTheTaskEvent_ForThatTask()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle) = await SeedSeasonStartingAsync("grape", TodayIst().AddDays(-41));
        await OkAsync(SaveOwnAsync(plot, cycle, ByHand("flower-sign", ScheduleTaskTiming.WhenSeen("फुलोरा सुरू", 38, 44))));

        (await AskAsync(plot, "दिसलं", "task:flower-sign:look")).Status.Should().Be(HttpStatusCode.OK);
        await OkAsync(AnswerSignAsync(plot, cycle, "flower-sign", "seen"));

        (await CountAsync("SELECT count(*) FROM ssf.schedule_task_events WHERE plot_id = @p AND task_key = 'flower-sign' AND answer = 'seen'", ("p", plot))).Should().Be(1);
    }
}
