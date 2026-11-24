// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8, "Rich day cards, one renderer")
//
// The detail read behind the day cards (GET /shramsafal/reference/schedule-templates/{id}/day-cards?scheduleFormat=2), through the real host and a real Postgres as
// the application role:
//   * Detail_CarriesVersionHash            - the version's hash, chain, version, every task's own hash and shown days (stored + 1);
//   * UncheckedReference_ReadableAndMarked - a farm caller reads a reference nobody has checked, and it says so (no checker, no doseChecked);
//   * Detail_OnlyCallersSchedules          - a foreign farm's copy is answered as unknown; his own copy is readable and is not called a reference;
//   * the route is offered only to a caller that declares scheduleFormat=2;
//   * the grape YEAR file (AGRISYNC_YEAR_GRAPES_JSON; never committed) goes in and every one of its days opens in the detail with a hash.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleDayCardsRealPostgresTests(ITestOutputHelper output) : OwnScheduleLane(output)
{
    private static JsonElement Canonical(ScheduleTaskContent t) => JsonDocument.Parse(t.ToCanonicalJson()).RootElement.Clone();

    private static JsonElement Canonical(ScheduleChallengeContent c) => JsonDocument.Parse(c.ToCanonicalJson()).RootElement.Clone();

    private static readonly IReadOnlyList<ScheduleTaskContent> Tasks =
    [
        new("t-prune", "फळछाटणी", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(0), ScheduleBasis.Stated, 0, 0,
            Steps: ["काड्या ५-६ डोळ्यांवर छाटा"], Sources: [new ScheduleSource("चाचणी पुस्तिका", "३")]),
        new("t-spray", "बुरशीनाशक फवारणी", ScheduleTaskKind.Spray, ScheduleTaskTiming.OnDays(10, 30).Repeating(ScheduleRepeatMode.EveryNDays, 7), ScheduleBasis.Stated, 0, 1,
            Dose: "२ ग्रॅम प्रति लिटर", Products: [new ScheduleProduct("चाचणी औषध", "२", "ग्रॅम", "लिटर")], ReEntryHours: 24, PreHarvestDays: 30,
            Sources: [new ScheduleSource("चाचणी पुस्तिका", "५")]),
        new("t-pre", "छाटणीपूर्व पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.OnDays(-5), ScheduleBasis.Stated, 0, 2),
        new("t-dayless", "गरजेनुसार खत", ScheduleTaskKind.Nutrition, ScheduleTaskTiming.None("पानांचा रंग पाहून"), ScheduleBasis.Stated, 0, 3),
        new("t-look", "मणी पाहणी", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(60, 62), ScheduleBasis.Stated, 1, 0,
            Look: new ScheduleTaskLook(Sign: "मण्यांचा आकार", IfThen: [new ScheduleIfThen("मणी लहान", "पाणी वाढवा")]),
            Ask: new ScheduleTaskAsk("मणी पाहिले का?", Answers: [new ScheduleAnswer("yes", "ठीक"), new ScheduleAnswer("no", "आज पाहा")])),
    ];

    private static object Body() => new
    {
        format = 2,
        name = "द्राक्ष: दिवस कार्ड संदर्भ",
        cropKey = "grape",
        ownerType = "INSTITUTION",
        sourceLabel = "चाचणी पुस्तिका",
        previousVersionId = (Guid?)null,
        stages = new object[]
        {
            new { name = "छाटणी आणि फूट", startDay = 0, endDay = 40, startSign = (string?)null, endSign = (string?)null },
            new { name = "मण्यांची वाढ", startDay = 41, endDay = 99, startSign = (string?)null, endSign = "काढणी" },
        },
        tasks = Tasks.Select(Canonical).ToArray(),
        challenges = new[]
        {
            Canonical(new ScheduleChallengeContent("c-1", "डाऊनी", 0, 0, WhenWords: "पावसानंतर", Signs: "पानांवर डाग", Action: "चाचणी कृती",
                Sources: [new ScheduleSource("चाचणी पुस्तिका", "९")])),
        },
    };

    private async Task<Guid> ImportBodyAsync(object body)
    {
        var (status, text) = await SendJsonAsync(HttpMethod.Post, "/shramsafal/schedule-templates/import/format-2", PlatformOwner, body);
        status.Should().Be(HttpStatusCode.Created, text);
        return Json(text).GetProperty("templateId").GetGuid();
    }

    private Task<Guid> ImportAsync() => ImportBodyAsync(Body());

    private async Task ApproveAllAsync(Guid id)
    {
        var (s1, t1) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{id}/check-view", PlatformEmployee, null);
        s1.Should().Be(HttpStatusCode.OK, t1);
        var view = Json(t1);
        var (s2, t2) = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{id}/check", PlatformEmployee, new
        {
            decision = "Approved",
            checkedActivityIds = Array.Empty<Guid>(),
            checkerDisplayName = DisplayName,
            checkedTaskKeys = view.GetProperty("tasks").EnumerateArray().Select(e => e.GetProperty("taskKey").GetString()).ToArray(),
            checkedChallengeKeys = view.GetProperty("challenges").EnumerateArray().Select(e => e.GetProperty("challengeKey").GetString()).ToArray(),
            contentHash = view.GetProperty("contentHash").GetString(),
        });
        s2.Should().Be(HttpStatusCode.OK, t2);
    }

    private Task<(HttpStatusCode Status, string Body)> DayCardsAsync(Guid caller, Guid id, bool declare = true) =>
        SendJsonAsync(HttpMethod.Get, $"/shramsafal/reference/schedule-templates/{id}/day-cards" + (declare ? "?scheduleFormat=2" : ""), caller, null);

    [Fact]
    public async Task Detail_CarriesVersionHash()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var id = await ImportAsync();
        await ApproveAllAsync(id);
        var view = Json((await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{id}/check-view", PlatformEmployee, null)).Body);

        var (status, text) = await DayCardsAsync(Owner, id);
        status.Should().Be(HttpStatusCode.OK, text);
        var d = Json(text);
        d.GetProperty("contentHash").GetString().Should().Be(view.GetProperty("contentHash").GetString());
        d.GetProperty("version").GetInt32().Should().Be(1);
        d.GetProperty("chainId").GetGuid().Should().Be(id);
        d.GetProperty("kind").GetString().Should().Be("reference");
        d.GetProperty("check").GetProperty("isChecked").GetBoolean().Should().BeTrue();
        d.GetProperty("check").GetProperty("checkedBy").GetString().Should().Be(DisplayName);
        d.GetProperty("madeBy").GetProperty("ownerType").GetString().Should().Be("INSTITUTION");
        d.GetProperty("tasks").GetArrayLength().Should().Be(5);
        d.GetProperty("challenges").GetArrayLength().Should().Be(1);
        d.GetProperty("stages").GetArrayLength().Should().Be(2);
        foreach (var t in d.GetProperty("tasks").EnumerateArray())
        {
            t.GetProperty("contentHash").GetString().Should().HaveLength(64);
            t.GetProperty("doseChecked").GetBoolean().Should().BeTrue();
        }

        var prune = d.GetProperty("tasks").EnumerateArray().Single(t => t.GetProperty("taskKey").GetString() == "t-prune");
        prune.GetProperty("shown").GetProperty("from").GetProperty("shown").GetInt32().Should().Be(1, "stored 0 is shown as day 1");
        var pre = d.GetProperty("tasks").EnumerateArray().Single(t => t.GetProperty("taskKey").GetString() == "t-pre");
        pre.GetProperty("shown").GetProperty("from").GetProperty("daysBeforeStart").GetInt32().Should().Be(5);
    }

    [Fact]
    public async Task UncheckedReference_ReadableAndMarked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var id = await ImportAsync();

        var (status, text) = await DayCardsAsync(Owner, id);
        status.Should().Be(HttpStatusCode.OK, text);
        var d = Json(text);
        d.GetProperty("kind").GetString().Should().Be("reference");
        d.GetProperty("check").GetProperty("state").GetString().Should().Be("NotChecked");
        d.GetProperty("check").GetProperty("isChecked").GetBoolean().Should().BeFalse();
        d.GetProperty("check").GetProperty("checkedBy").ValueKind.Should().Be(JsonValueKind.Null);
        d.GetProperty("tasks").EnumerateArray().Should().OnlyContain(t => !t.GetProperty("doseChecked").GetBoolean(),
            "a dose of an unchecked version is never presented as checked");
        d.GetProperty("tasks").GetArrayLength().Should().Be(5, "the content is readable");
    }

    [Fact]
    public async Task Detail_OnlyCallersSchedules()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var reference = await ImportAsync();
        await ApproveAllAsync(reference);
        var copy = Guid.NewGuid();
        var cloned = await CloneIntoOwnAsync(Owner, reference, FarmA, copy);
        cloned.Status.Should().Be(HttpStatusCode.Created, cloned.Body);

        var mine = await DayCardsAsync(Owner, copy);
        mine.Status.Should().Be(HttpStatusCode.OK, mine.Body);
        Json(mine.Body).GetProperty("kind").GetString().Should().Be("own", "his own copy is not called a reference");
        Json(mine.Body).GetProperty("tasks").GetArrayLength().Should().Be(5);

        // Another farm's owner: the copy is answered exactly like an unknown id (E4).
        (await DayCardsAsync(OwnerB, copy)).Status.Should().Be(HttpStatusCode.NotFound);
        (await DayCardsAsync(OwnerB, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.NotFound);

        // The format is offered only to a caller that declares scheduleFormat=2.
        (await DayCardsAsync(Owner, copy, declare: false)).Status.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>The names a phone of release 1.0.17 reads on a listed schedule: the day cards add NONE of their own (a new route carries them).</summary>
    private static readonly string[] OldListingKeys =
    [
        "id", "name", "cropType", "totalDays", "stages", "activities", "versionHash", "ownerType", "sourceLabel", "check", "rowVersionTag", "hasStoredDays", "scope",
        "ownerUserId", "madeByUserId", "madeAtUtc", "previousVersionId", "variety", "soilType", "region", "climate", "draftStages", "pictureId", "pictureSha256",
        "pictureKind", "hasTaskFormat",
    ];

    [Fact]
    public async Task OldClientPayload_Unchanged_NoDayCardKeyInTheListing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var id = await ImportAsync();
        await ApproveAllAsync(id);
        var (status, text) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/reference/schedule-templates", Owner, null);
        status.Should().Be(HttpStatusCode.OK, text);
        var row = Json(text).EnumerateArray().Single(e => e.GetProperty("id").GetGuid() == id);
        row.EnumerateObject().Select(p => p.Name).Should().BeSubsetOf(OldListingKeys, "no key is added to the payload release 1.0.17 reads");
        text.Should().NotContain("t-spray").And.NotContain("doseChecked").And.NotContain("dayCards");
    }

    [SkippableFact]
    public async Task YearGrapes_EveryDayOpensInTheDetail()
    {
        var path = Environment.GetEnvironmentVariable("AGRISYNC_YEAR_GRAPES_JSON");
        Skip.If(string.IsNullOrWhiteSpace(path) || !File.Exists(path),
            "AGRISYNC_YEAR_GRAPES_JSON is not set (or the file is missing): the grape year file is deliberately not committed (unchecked doses, public repository).");
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        using var file = JsonDocument.Parse(File.ReadAllText(path!));
        var mapped = YearGrapesMapper.Map(file.RootElement);
        var signs = mapped.StageSigns.ToDictionary(s => s.StageIndex);
        var stages = mapped.Stages.Select((s, i) => new
        {
            name = s.Name,
            startDay = s.StartDay,
            endDay = s.EndDay,
            startSign = signs.TryGetValue(i, out var sg) ? sg.StartSign : null,
            endSign = signs.TryGetValue(i, out var se) ? se.EndSign : null,
        }).ToArray();
        var id = await ImportBodyAsync(new
        {
            format = 2,
            name = "द्राक्ष: वर्षभराचे संदर्भ वेळापत्रक",
            cropKey = "grape",
            ownerType = "INSTITUTION",
            sourceLabel = "संस्थापकाचे वेळापत्रक (तपासणी बाकी)",
            previousVersionId = (Guid?)null,
            stages,
            tasks = mapped.Tasks.Select(Canonical).ToArray(),
            challenges = mapped.Challenges.Select(Canonical).ToArray(),
        });

        var (status, text) = await DayCardsAsync(Owner, id);
        status.Should().Be(HttpStatusCode.OK);
        var d = Json(text);
        d.GetProperty("check").GetProperty("isChecked").GetBoolean().Should().BeFalse("the year file is unchecked: readable and marked");
        d.GetProperty("tasks").GetArrayLength().Should().Be(mapped.Tasks.Count);
        d.GetProperty("tasks").EnumerateArray().Should().OnlyContain(t => !t.GetProperty("doseChecked").GetBoolean());
        Output.WriteLine($"[YEAR] day-cards detail read: {mapped.Tasks.Count} tasks, {mapped.Challenges.Count} challenges, unchecked and marked");
    }
}
