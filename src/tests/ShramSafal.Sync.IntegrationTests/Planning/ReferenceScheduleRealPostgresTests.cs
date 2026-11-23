// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7, "Reference schedules in the format: import, check, approve")
//
// A reference schedule in FORMAT 2 (the task format) through the real host and a real Postgres as the application role (agrisync_app, E3 first):
//   * Approve_NeedsEveryTask_AndSameHash   - an approval needs every task and challenge key ticked on the content hash the checker saw; the check row keeps them;
//   * Maker_CannotApproveOwn               - the person who loaded a version never approves it; another platform checker does;
//   * NewVersion_StartsUnchecked           - a next version is a new row of the same chain, unchecked, while the checked version stays listed;
//   * DaylessTask_NeverMakesAnAdoptableSample - a reference whose tasks store no day is never offered (or adoptable) as a sample, and an old phone never sees it;
//   * OldEditOfNewRow_RefusedVisibly       - an old whole edit of a copy in the task format is refused with its Marathi words, nothing written;
//   * the platform seat only for import / check / check view, a foreign farm never reads an unchecked reference, and the task format is offered only to a caller
//     that declares scheduleFormat=2;
//   * the listing an old phone reads is captured (SCHED7_LISTING_SAMPLE_PATH) for release 1.0.17's own parser (mobile-web vitest Release1017Parser_ReadsTheNewListing);
//   * the grape YEAR file (AGRISYNC_YEAR_GRAPES_JSON; never committed) goes in through the import door and comes back out of the check view with no field lost.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ReferenceScheduleRealPostgresTests(ITestOutputHelper output) : OwnScheduleLane(output)
{
    private const string YearEnvVar = "AGRISYNC_YEAR_GRAPES_JSON";

    // ── the format-2 body ────────────────────────────────────────────────────────────────────────────────────────────

    private static JsonElement Canonical(ScheduleTaskContent t) => JsonDocument.Parse(t.ToCanonicalJson()).RootElement.Clone();

    private static JsonElement Canonical(ScheduleChallengeContent c) => JsonDocument.Parse(c.ToCanonicalJson()).RootElement.Clone();

    private static object StageBody(string name, int start, int end, string? startSign = null, string? endSign = null) =>
        new { name, startDay = start, endDay = end, startSign, endSign };

    private static readonly object[] TwoStages = [StageBody("छाटणी आणि फूट", 0, 40), StageBody("मण्यांची वाढ", 41, 99, endSign: "काढणी")];

    /// <summary>Seven tasks of every kind (day once, day every N, a day before pruning, dayless, after, sign, observe) and one challenge.</summary>
    private static IReadOnlyList<ScheduleTaskContent> SevenTasks(string dose = "२ ग्रॅम प्रति लिटर") =>
    [
        new("t-prune", "फळछाटणी", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(0), ScheduleBasis.Stated, 0, 0,
            Steps: ["काड्या ५-६ डोळ्यांवर छाटा"], Sources: [new ScheduleSource("चाचणी पुस्तिका", "३")]),
        new("t-spray", "बुरशीनाशक फवारणी", ScheduleTaskKind.Spray, ScheduleTaskTiming.OnDays(10, 30).Repeating(ScheduleRepeatMode.EveryNDays, 7), ScheduleBasis.Stated, 0, 1,
            Dose: dose, Products: [new ScheduleProduct("चाचणी औषध", dose, "ग्रॅम", "लिटर")], ReEntryHours: 24, PreHarvestDays: 30),
        new("t-pre", "छाटणीपूर्व पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.OnDays(-5), ScheduleBasis.Stated, 0, 2),
        new("t-dayless", "गरजेनुसार खत", ScheduleTaskKind.Nutrition, ScheduleTaskTiming.None("पानांचा रंग पाहून"), ScheduleBasis.Stated, 0, 3),
        new("t-after", "पेस्ट लावणे", ScheduleTaskKind.Work, ScheduleTaskTiming.AfterTask("t-prune", 1, 0, 2), ScheduleBasis.Stated, 0, 4),
        new("t-sign", "फुलोऱ्यात पाणी कमी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.WhenSeen("फुलोरा दिसला", 36, 50), ScheduleBasis.Stated, 1, 0),
        new("t-look", "मणी पाहणी", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(60, 62), ScheduleBasis.Stated, 1, 1,
            Look: new ScheduleTaskLook(Sign: "मण्यांचा आकार", IfThen: [new ScheduleIfThen("मणी लहान", "पाणी वाढवा")])),
    ];

    private static readonly ScheduleChallengeContent OneChallenge =
        new("c-1", "डाऊनी", 0, 0, WhenWords: "पावसानंतर", Signs: "पानांवर पिवळे डाग", Action: "चाचणी कृती", Sources: [new ScheduleSource("चाचणी पुस्तिका", "९")]);

    private static object Format2Body(
        IReadOnlyList<ScheduleTaskContent>? tasks = null, object[]? stages = null, Guid? previous = null, string name = "द्राक्ष: चाचणी संदर्भ",
        IReadOnlyList<ScheduleChallengeContent>? challenges = null) => new
        {
            format = 2,
            name,
            cropKey = "grape",
            ownerType = "INSTITUTION",
            sourceLabel = "चाचणी पुस्तिका",
            previousVersionId = previous,
            stages = stages ?? TwoStages,
            tasks = (tasks ?? SevenTasks()).Select(Canonical).ToArray(),
            challenges = (challenges ?? [OneChallenge]).Select(Canonical).ToArray(),
        };

    private async Task<JsonElement> ImportAsync(Guid user, object body)
    {
        var (status, text) = await SendJsonAsync(HttpMethod.Post, "/shramsafal/schedule-templates/import/format-2", user, body);
        status.Should().Be(HttpStatusCode.Created, text);
        return Json(text);
    }

    private async Task<JsonElement> CheckViewAsync(Guid user, Guid template)
    {
        var (status, text) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{template}/check-view", user, null);
        status.Should().Be(HttpStatusCode.OK, text);
        return Json(text);
    }

    private static List<string> Keys(JsonElement view, string list, string key) =>
        view.GetProperty(list).EnumerateArray().Select(e => e.GetProperty(key).GetString()!).ToList();

    private Task<(HttpStatusCode Status, string Body)> ApproveAsync(
        Guid user, Guid template, IEnumerable<string> taskKeys, IEnumerable<string> challengeKeys, string? hash) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{template}/check", user, new
        {
            decision = "Approved",
            checkedActivityIds = Array.Empty<Guid>(),
            checkerDisplayName = DisplayName,
            checkedTaskKeys = taskKeys.ToArray(),
            checkedChallengeKeys = challengeKeys.ToArray(),
            contentHash = hash,
        });

    /// <summary>Opens the check view as <paramref name="checker"/> and approves with every key on the hash shown.</summary>
    private async Task ApproveAllAsync(Guid checker, Guid template)
    {
        var view = await CheckViewAsync(checker, template);
        var (status, text) = await ApproveAsync(checker, template, Keys(view, "tasks", "taskKey"), Keys(view, "challenges", "challengeKey"),
            view.GetProperty("contentHash").GetString());
        status.Should().Be(HttpStatusCode.OK, text);
    }

    private sealed record CheckRow7(Guid Template, string Decision, string[]? TaskKeys, string[]? ChallengeKeys, string? Hash, Guid Checker);

    private async Task<List<CheckRow7>> Checks7Async(Guid template)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT schedule_template_id, decision, checked_task_keys, checked_challenge_keys, content_hash, checker_user_id
            FROM ssf.schedule_checks WHERE schedule_template_id = @t ORDER BY checked_at_utc, id
            """;
        cmd.Parameters.AddWithValue("t", template);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<CheckRow7>();
        while (await reader.ReadAsync())
        {
            rows.Add(new CheckRow7(
                reader.GetGuid(0), reader.GetString(1),
                reader.IsDBNull(2) ? null : (string[])reader.GetValue(2), reader.IsDBNull(3) ? null : (string[])reader.GetValue(3),
                reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetGuid(5)));
        }

        return rows;
    }

    // ── the proofs ───────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Approve_NeedsEveryTask_AndSameHash()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var imported = await ImportAsync(PlatformOwner, Format2Body());
        var id = imported.GetProperty("templateId").GetGuid();
        imported.GetProperty("version").GetInt32().Should().Be(1);
        imported.GetProperty("chainId").GetGuid().Should().Be(id, "version 1 names its own chain");
        imported.GetProperty("taskCount").GetInt32().Should().Be(7);
        imported.GetProperty("challengeCount").GetInt32().Should().Be(1);
        imported.GetProperty("projectedActivityCount").GetInt32().Should().Be(2, "only the day tasks the old rules can hold reach an old phone");

        var view = await CheckViewAsync(PlatformEmployee, id);
        var hash = view.GetProperty("contentHash").GetString()!;
        hash.Should().Be(imported.GetProperty("contentHash").GetString());
        var tasks = Keys(view, "tasks", "taskKey");
        var challenges = Keys(view, "challenges", "challengeKey");
        tasks.Should().HaveCount(7);

        // One task short: refused, nothing written.
        var short1 = await ApproveAsync(PlatformEmployee, id, tasks.Skip(1), challenges, hash);
        short1.Status.Should().Be(HttpStatusCode.BadRequest);
        ErrorCode(short1.Body).Should().Be("ShramSafal.ScheduleCheckNotAllTasks");
        // Every task, no challenge: refused.
        ErrorCode((await ApproveAsync(PlatformEmployee, id, tasks, [], hash)).Body).Should().Be("ShramSafal.ScheduleCheckNotAllTasks");
        // Every key on another hash, or on none: refused.
        ErrorCode((await ApproveAsync(PlatformEmployee, id, tasks, challenges, new string('0', 64))).Body).Should().Be("ShramSafal.ScheduleCheckHashChanged");
        ErrorCode((await ApproveAsync(PlatformEmployee, id, tasks, challenges, null)).Body).Should().Be("ShramSafal.ScheduleCheckHashChanged");
        // The old form (activity ids only) never approves a version in the task format.
        var oldForm = await CheckAsync(PlatformEmployee, id, "Approved", Array.Empty<Guid>());
        ErrorCode(oldForm.Body).Should().Be("ShramSafal.ScheduleCheckHashChanged");
        (await Checks7Async(id)).Should().BeEmpty("no refused approval writes a check");
        (await LibraryAsync(Owner)).Should().NotContain(e => e.GetProperty("id").GetGuid() == id, "unchecked: a farm caller is not offered it");

        // Every task and challenge on the hash shown: Checked; the row keeps every key and the hash.
        var ok = await ApproveAsync(PlatformEmployee, id, tasks, challenges, hash);
        ok.Status.Should().Be(HttpStatusCode.OK, ok.Body);
        var row = (await Checks7Async(id)).Should().ContainSingle().Subject;
        row.Decision.Should().Be("Approved");
        row.Checker.Should().Be(PlatformEmployee);
        row.TaskKeys.Should().BeEquivalentTo(tasks);
        row.ChallengeKeys.Should().BeEquivalentTo(challenges);
        row.Hash.Should().Be(hash);

        var listed = RowOf(await LibraryAsync(Owner), id);
        listed.Should().NotBeNull("checked: the farm caller's library lists it");
        listed!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("Checked");
        listed.Value.GetProperty("hasTaskFormat").GetBoolean().Should().BeTrue();
        (await CheckViewAsync(PlatformAnalyst, id)).GetProperty("checkedTaskKeys").EnumerateArray().Should().HaveCount(7);
    }

    [Fact]
    public async Task Maker_CannotApproveOwn()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var id = (await ImportAsync(PlatformOwner, Format2Body())).GetProperty("templateId").GetGuid();

        var view = await CheckViewAsync(PlatformOwner, id);
        view.GetProperty("madeByCaller").GetBoolean().Should().BeTrue("the check view tells the maker he may not approve");
        var own = await ApproveAsync(PlatformOwner, id, Keys(view, "tasks", "taskKey"), Keys(view, "challenges", "challengeKey"),
            view.GetProperty("contentHash").GetString());
        own.Status.Should().Be(HttpStatusCode.BadRequest);
        ErrorCode(own.Body).Should().Be("ShramSafal.ScheduleCheckOwnSchedule");
        (await Checks7Async(id)).Should().BeEmpty();

        // Another platform checker approves it.
        (await CheckViewAsync(PlatformEmployee, id)).GetProperty("madeByCaller").GetBoolean().Should().BeFalse();
        await ApproveAllAsync(PlatformEmployee, id);
        (await Checks7Async(id)).Should().ContainSingle(c => c.Decision == "Approved" && c.Checker == PlatformEmployee);
    }

    [Fact]
    public async Task NewVersion_StartsUnchecked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var v1 = (await ImportAsync(PlatformOwner, Format2Body())).GetProperty("templateId").GetGuid();
        await ApproveAllAsync(PlatformEmployee, v1);

        var v2Result = await ImportAsync(PlatformOwner, Format2Body(tasks: SevenTasks("३ ग्रॅम प्रति लिटर"), previous: v1));
        var v2 = v2Result.GetProperty("templateId").GetGuid();
        v2Result.GetProperty("version").GetInt32().Should().Be(2);
        v2Result.GetProperty("chainId").GetGuid().Should().Be(v1, "the next version names the same chain");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE chain_id = @c", ("c", v1))).Should().Be(2);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @v AND previous_version_id = @p", ("v", v2), ("p", v1))).Should().Be(1);

        // v2 has no check of its own; v1 keeps its approval and stays the farm caller's choice.
        (await Checks7Async(v2)).Should().BeEmpty();
        var farm = await LibraryAsync(Owner);
        RowOf(farm, v1)!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("Checked");
        RowOf(farm, v2).Should().BeNull("a new version waits for its own check");
        RowOf(await ReviewLibraryAsync(), v2)!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("NotChecked");
        var waiting = await SendJsonAsync(HttpMethod.Get, "/shramsafal/schedule-templates/checks/waiting", PlatformEmployee, null);
        Json(waiting.Body).EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).Should().Contain(v2).And.NotContain(v1);

        // v1's ticks (its hash) do not approve v2; a safety gap may not shrink in a next version.
        var v1View = await CheckViewAsync(PlatformEmployee, v1);
        var stale = await ApproveAsync(PlatformEmployee, v2, Keys(v1View, "tasks", "taskKey"), Keys(v1View, "challenges", "challengeKey"),
            v1View.GetProperty("contentHash").GetString());
        ErrorCode(stale.Body).Should().Be("ShramSafal.ScheduleCheckHashChanged");
        var shrunk = SevenTasks().Select(t => t.TaskKey == "t-spray" ? t with { PreHarvestDays = 10 } : t).ToList();
        var refused = await SendJsonAsync(HttpMethod.Post, "/shramsafal/schedule-templates/import/format-2", PlatformOwner, Format2Body(tasks: shrunk, previous: v1));
        refused.Status.Should().Be(HttpStatusCode.BadRequest);
        ErrorCode(refused.Body).Should().Contain("Gap");
    }

    [Fact]
    public async Task DaylessTask_NeverMakesAnAdoptableSample()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        IReadOnlyList<ScheduleTaskContent> dayless =
        [
            new("d-1", "गरजेनुसार खत", ScheduleTaskKind.Nutrition, ScheduleTaskTiming.None("पानांचा रंग पाहून"), ScheduleBasis.Stated),
            new("d-2", "फुलोऱ्यात पाणी कमी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.WhenSeen("फुलोरा दिसला"), ScheduleBasis.Stated),
        ];
        var imported = await ImportAsync(PlatformOwner, Format2Body(tasks: dayless));
        var id = imported.GetProperty("templateId").GetGuid();
        imported.GetProperty("projectedActivityCount").GetInt32().Should().Be(0);
        imported.GetProperty("hasStoredDays").GetBoolean().Should().BeFalse();

        // Unchecked: not offered to the farm caller, not his crop's default, and adopting it is refused with nothing written.
        var library = await LibraryAsync(Owner);
        RowOf(library, id).Should().BeNull();
        RowOf(library, BuiltInGrapes).Should().NotBeNull("the built-in grape sample stays offered: this row did not take its place");
        var subscriptionsBefore = (await SubscriptionsAsync()).Count;
        var adopt = await AdoptAsync(Owner, FarmA, PlotA, CycleA, id);
        adopt.Status.Should().NotBe(HttpStatusCode.OK, adopt.Body);
        adopt.Status.Should().NotBe(HttpStatusCode.Created, adopt.Body);
        (await SubscriptionsAsync()).Should().HaveCount(subscriptionsBefore, "nothing was adopted");

        // It waits for a check like any reference; once checked (by another person) an old phone still never sees it: no stage, no activity, no invented day.
        var waiting = await SendJsonAsync(HttpMethod.Get, "/shramsafal/schedule-templates/checks/waiting", PlatformEmployee, null);
        Json(waiting.Body).EnumerateArray().Should().Contain(e => e.GetProperty("id").GetGuid() == id && e.GetProperty("hasTaskFormat").GetBoolean());
        await ApproveAllAsync(PlatformEmployee, id);
        var listed = RowOf(await LibraryAsync(Owner), id)!.Value;
        listed.GetProperty("check").GetProperty("state").GetString().Should().Be("Checked");
        listed.GetProperty("stages").GetArrayLength().Should().Be(0, "release 1.0.17 drops a template with no stage");
        listed.GetProperty("activities").GetArrayLength().Should().Be(0);
        listed.GetProperty("draftStages").GetArrayLength().Should().Be(2, "a new phone reads the stage line from DraftStages");
    }

    [Fact]
    public async Task OldEditOfNewRow_RefusedVisibly()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var reference = (await ImportAsync(PlatformOwner, Format2Body())).GetProperty("templateId").GetGuid();
        await ApproveAllAsync(PlatformEmployee, reference);

        // The farm's owner copies the checked reference into his own schedule: the copy carries the task format.
        var copy = Guid.NewGuid();
        var cloned = await CloneIntoOwnAsync(Owner, reference, FarmA, copy);
        cloned.Status.Should().Be(HttpStatusCode.Created, cloned.Body);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_tasks WHERE schedule_template_id = @t", ("t", copy))).Should().Be(7);

        // An OLD whole edit (stages + activities, the pre-format maker) would drop every task: refused with its words, nothing written.
        var templatesBefore = await CountAsync("SELECT count(*) FROM ssf.schedule_templates");
        var newId = Guid.NewGuid();
        var edit = await EditAsync(Owner, copy, FarmA, newId, stages: SomeStages(), activities: SomeWorks());
        edit.Status.Should().Be(HttpStatusCode.BadRequest, edit.Body);
        var body = Json(edit.Body);
        body.GetProperty("error").GetString().Should().Be("ShramSafal.ScheduleTaskFormatEdit");
        body.GetProperty("messageMr").GetString().Should().Be("हे शेड्यूल नव्या पद्धतीत आहे; हा बदल जतन झाला नाही.");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(templatesBefore);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @n", ("n", newId))).Should().Be(0);

        // A plain rename keeps every task (it drops nothing), so it is not refused.
        var renamed = await EditAsync(Owner, copy, FarmA, Guid.NewGuid(), name: "माझं द्राक्ष शेड्यूल");
        renamed.Status.Should().Be(HttpStatusCode.Created, renamed.Body);
    }

    [Fact]
    public async Task ForeignFarmAndRole_AreRefused_AndTheFormatIsOfferedOnlyWhenDeclared()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        // A farm's owner, a farm seat with AppRole.Agronomist and an FPO owner hold no platform seat: import, check view and check are refused.
        foreach (var notPlatform in new[] { Owner, AgronomistSeat, FpoOwner })
        {
            (await SendJsonAsync(HttpMethod.Post, "/shramsafal/schedule-templates/import/format-2", notPlatform, Format2Body())).Status
                .Should().Be(HttpStatusCode.Forbidden);
        }

        var id = (await ImportAsync(PlatformOwner, Format2Body())).GetProperty("templateId").GetGuid();
        foreach (var notPlatform in new[] { Owner, OwnerB, AgronomistSeat, FpoOwner })
        {
            (await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{id}/check-view", notPlatform, null)).Status.Should().Be(HttpStatusCode.Forbidden);
            (await ApproveAsync(notPlatform, id, ["t-prune"], [], "x")).Status.Should().Be(HttpStatusCode.Forbidden);
        }

        // The Analyst reads the check view (read seat) but may not approve.
        (await CheckViewAsync(PlatformAnalyst, id)).GetProperty("tasks").GetArrayLength().Should().Be(7);
        (await ApproveAsync(PlatformAnalyst, id, ["t-prune"], [], "x")).Status.Should().Be(HttpStatusCode.Forbidden);

        // Unchecked: no farm (his own or a foreign one) reads its tasks; the answer is "unknown", never "exists but hidden" (E4).
        (await SendJsonAsync(HttpMethod.Get, $"/shramsafal/reference/schedule-templates/{id}/tasks?scheduleFormat=2", Owner, null)).Status.Should().Be(HttpStatusCode.NotFound);
        (await SendJsonAsync(HttpMethod.Get, $"/shramsafal/reference/schedule-templates/{id}/tasks?scheduleFormat=2", OwnerB, null)).Status.Should().Be(HttpStatusCode.NotFound);

        await ApproveAllAsync(PlatformEmployee, id);

        // Checked: the format is offered ONLY to a caller that declares scheduleFormat=2; without it, a refusal with words.
        var undeclared = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/reference/schedule-templates/{id}/tasks", Owner, null);
        undeclared.Status.Should().Be(HttpStatusCode.BadRequest);
        ErrorCode(undeclared.Body).Should().Be("ShramSafal.ScheduleFormatNotDeclared");
        var declared = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/reference/schedule-templates/{id}/tasks?scheduleFormat=2", OwnerB, null);
        declared.Status.Should().Be(HttpStatusCode.OK, declared.Body);
        var format = Json(declared.Body);
        format.GetProperty("checkState").GetString().Should().Be("Checked");
        format.GetProperty("chainId").GetGuid().Should().Be(id);
        format.GetProperty("tasks").GetArrayLength().Should().Be(7);
        format.GetProperty("challenges").GetArrayLength().Should().Be(1);
        format.GetProperty("stages")[1].GetProperty("endSign").GetString().Should().Be("काढणी");

        // The listing an old phone reads carries no task: only the stored activities of the day tasks.
        var listed = RowOf(await LibraryAsync(OwnerB), id)!.Value;
        listed.ToString().Should().NotContain("t-dayless").And.NotContain("\"tasks\"");
    }

    [Fact]
    public async Task Release1017Listing_IsCapturedFromTheRealServer()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var id = (await ImportAsync(PlatformOwner, Format2Body())).GetProperty("templateId").GetGuid();
        var dayless = (await ImportAsync(PlatformOwner, Format2Body(name: "द्राक्ष: फक्त खुणा", tasks:
        [
            new("d-1", "गरजेनुसार खत", ScheduleTaskKind.Nutrition, ScheduleTaskTiming.None("पानांचा रंग पाहून"), ScheduleBasis.Stated),
        ]))).GetProperty("templateId").GetGuid();
        await ApproveAllAsync(PlatformEmployee, id);
        await ApproveAllAsync(PlatformEmployee, dayless);

        var (status, body) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/reference/schedule-templates", Owner, null);
        status.Should().Be(HttpStatusCode.OK);
        var listing = Json(body).EnumerateArray().ToList();
        var reference = RowOf(listing, id)!.Value;
        reference.GetProperty("stages").GetArrayLength().Should().Be(2);
        reference.GetProperty("activities").EnumerateArray().Select(a => a.GetProperty("name").GetString())
            .Should().BeEquivalentTo(["फळछाटणी", "बुरशीनाशक फवारणी"], "only the day tasks the old rules can hold");
        reference.GetProperty("activities").EnumerateArray().Should().OnlyContain(a => a.GetProperty("startDay").GetInt32() >= 0);
        RowOf(listing, dayless)!.Value.GetProperty("stages").GetArrayLength().Should().Be(0);

        var path = Environment.GetEnvironmentVariable("SCHED7_LISTING_SAMPLE_PATH");
        if (!string.IsNullOrWhiteSpace(path))
        {
            // The two references only (test ids, test names, test words): the input of the mobile-web vitest that runs release 1.0.17's own parser.
            var kept = listing.Where(e => e.GetProperty("id").GetGuid() == id || e.GetProperty("id").GetGuid() == dayless).ToList();
            File.WriteAllText(path, JsonSerializer.Serialize(kept, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
            Output.WriteLine($"[SCHED7] listing sample written to {path}");
        }
    }

    [SkippableFact]
    public async Task YearGrapes_ImportedInFormat2_ReadBack_LosesNoField()
    {
        var path = Environment.GetEnvironmentVariable(YearEnvVar);
        Skip.If(string.IsNullOrWhiteSpace(path) || !File.Exists(path),
            $"{YearEnvVar} is not set (or the file is missing): the grape year file is deliberately not committed (unchecked doses, public repository).");
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        using var file = JsonDocument.Parse(File.ReadAllText(path!));
        var mapped = YearGrapesMapper.Map(file.RootElement);
        var signs = mapped.StageSigns.ToDictionary(s => s.StageIndex);
        var stages = mapped.Stages.Select((s, i) => StageBody(s.Name, s.StartDay, s.EndDay,
            signs.TryGetValue(i, out var sg) ? sg.StartSign : null, signs.TryGetValue(i, out var se) ? se.EndSign : null)).ToArray();
        var body = new
        {
            format = 2,
            name = "द्राक्ष: वर्षभराचे संदर्भ वेळापत्रक",
            cropKey = "grape",
            ownerType = "INSTITUTION",
            sourceLabel = "संस्थापकाचे वर्षभराचे वेळापत्रक (तपासणी बाकी)",
            previousVersionId = (Guid?)null,
            stages,
            tasks = mapped.Tasks.Select(Canonical).ToArray(),
            challenges = mapped.Challenges.Select(Canonical).ToArray(),
        };

        // For the live run on the builder's own stack: the same body, written OUTSIDE the repository (never committed).
        if (Environment.GetEnvironmentVariable("SCHED7_YEAR_BODY_PATH") is { Length: > 0 } bodyPath)
        {
            File.WriteAllText(bodyPath, JsonSerializer.Serialize(body, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        }

        var imported = await ImportAsync(PlatformOwner, body);
        var id = imported.GetProperty("templateId").GetGuid();
        imported.GetProperty("taskCount").GetInt32().Should().Be(160);
        imported.GetProperty("challengeCount").GetInt32().Should().Be(84);
        imported.GetProperty("stageCount").GetInt32().Should().Be(9);

        var view = await CheckViewAsync(PlatformEmployee, id);
        var byKey = view.GetProperty("tasks").EnumerateArray().ToDictionary(t => t.GetProperty("taskKey").GetString()!);
        byKey.Should().HaveCount(160);
        foreach (var expected in mapped.Tasks)
        {
            var row = byKey[expected.TaskKey];
            var back = ScheduleTaskContent.FromCanonicalJson(row.GetProperty("task").GetRawText())!;
            back.Should().BeEquivalentTo(expected.Normalized(), expected.TaskKey + ": every field comes back");
            row.GetProperty("contentHash").GetString().Should().Be(expected.ContentHash(), expected.TaskKey);
            YearGrapesMapper.ExportEvent(back, mapped.BaseByTaskKey[expected.TaskKey])
                .Should().BeEquivalentTo(YearGrapesMapper.ExportEvent(expected, mapped.BaseByTaskKey[expected.TaskKey]));
        }

        var challenges = view.GetProperty("challenges").EnumerateArray().ToDictionary(c => c.GetProperty("challengeKey").GetString()!);
        foreach (var expected in mapped.Challenges)
        {
            ScheduleChallengeContent.FromCanonicalJson(challenges[expected.ChallengeKey].GetProperty("challenge").GetRawText())
                .Should().BeEquivalentTo(expected.Normalized(), expected.ChallengeKey);
        }

        view.GetProperty("stages").EnumerateArray().Select(s => (s.GetProperty("name").GetString(), s.GetProperty("from").GetProperty("stored").GetInt32(),
                s.GetProperty("to").GetProperty("stored").GetInt32()))
            .Should().Equal(mapped.Stages.Select(s => ((string?)s.Name, s.StartDay, s.EndDay)));

        // The shown days come from the one day helper: stored + 1, and a day before pruning as "N days before" (never day 0 or a negative day).
        byKey["kit-prune"].GetProperty("shown").GetProperty("from").GetProperty("shown").GetInt32().Should().Be(1);
        var pre = byKey["kit-pre-irr"].GetProperty("shown").GetProperty("from");
        pre.GetProperty("stored").GetInt32().Should().Be(-20);
        pre.GetProperty("shown").ValueKind.Should().Be(JsonValueKind.Null);
        pre.GetProperty("daysBeforeStart").GetInt32().Should().Be(20);
        byKey["f-s1-ga3-pre2"].GetProperty("shown").GetProperty("from").ValueKind.Should().Be(JsonValueKind.Null, "a dayless work is never given a day");

        // Approval demands every one of the 160 tasks and 84 challenges: one short is refused; all on the hash shown is Checked, by another person than the maker.
        var hash = view.GetProperty("contentHash").GetString();
        var allTasks = byKey.Keys.ToList();
        var allChallenges = challenges.Keys.ToList();
        ErrorCode((await ApproveAsync(PlatformEmployee, id, allTasks.Skip(1), allChallenges, hash)).Body).Should().Be("ShramSafal.ScheduleCheckNotAllTasks");
        ErrorCode((await ApproveAsync(PlatformOwner, id, allTasks, allChallenges, hash)).Body).Should().Be("ShramSafal.ScheduleCheckOwnSchedule");
        (await ApproveAsync(PlatformEmployee, id, allTasks, allChallenges, hash)).Status.Should().Be(HttpStatusCode.OK);

        var listed = RowOf(await LibraryAsync(Owner), id)!.Value;
        listed.GetProperty("cropType").GetString().Should().Be("Grapes");
        listed.GetProperty("check").GetProperty("state").GetString().Should().Be("Checked");
        listed.GetProperty("activities").EnumerateArray().Should().OnlyContain(a => a.GetProperty("startDay").GetInt32() >= 0);
        Output.WriteLine($"[YEAR] listed with {listed.GetProperty("activities").GetArrayLength()} stored activities for old phones; 160 tasks in the format");
    }

    [Fact]
    public async Task The_migration_is_additive_the_old_binary_writes_and_Down_refuses_while_a_chain_exists()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        // The deployed binary's writes name no new column: an old-shape check and an old-shape template row still go in as the application role.
        await using (var app = new NpgsqlConnection(AppConn))
        {
            await app.OpenAsync();
            await using var tx = await app.BeginTransactionAsync();
            await using (var cmd = app.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = """
                    SELECT set_config('agrisync.user_id', @u, true);
                    INSERT INTO ssf.schedule_checks (id, schedule_template_id, template_version, decision, checked_activity_ids, note, checker_user_id, checker_display_name, checked_at_utc)
                    VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'Returned', '{}', 'old binary', @u::uuid, 'old', NOW());
                    """;
                cmd.Parameters.AddWithValue("u", PlatformOwner.ToString());
                await cmd.ExecuteNonQueryAsync();
            }

            await tx.CommitAsync();
        }

        (await CountAsync("SELECT count(*) FROM ssf.schedule_checks WHERE note = 'old binary' AND content_hash IS NULL AND checked_task_keys IS NULL")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE chain_id IS NOT NULL")).Should().Be(0, "no row before the slice names a chain");

        // Down refuses while a chain exists (and changes nothing).
        await ImportAsync(PlatformOwner, Format2Body());
        await using var raw = new NpgsqlConnection(SuperuserConn);
        await raw.OpenAsync();
        await using var down = raw.CreateCommand();
        down.CommandText = ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleReferenceFormat.DownRefusalSql;
        var refused = async () => await down.ExecuteNonQueryAsync();
        (await refused.Should().ThrowAsync<PostgresException>()).Which.MessageText.Should().Contain("Down refused");
        (await CountAsync("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'schedule_templates' AND column_name = 'chain_id'"))
            .Should().Be(1);
    }
}
