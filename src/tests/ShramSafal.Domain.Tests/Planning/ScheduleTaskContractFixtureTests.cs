// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers")
// The server half of the contract parity: sync-contract/tests/fixtures/schedule-task.contract.json is EXACTLY the text the server writes for these tasks and
// challenges (one key per field, null for an absent part, enums as snake_case words). The phone's own test (sync-contract/tests/scheduleTask.test.ts) parses the same
// file with its Zod schema, so a field added on one side and not the other fails one of the two tests.
// To rewrite the fixture after a deliberate format change: set UPDATE_SCHEDULE_TASK_FIXTURE=1 and run this class once.
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ScheduleTaskContractFixtureTests
{
    private static IReadOnlyList<ScheduleTaskContent> Tasks() =>
    [
        new("spray-one", "लांबट मण्यांचे वाण: फुलोऱ्यात GA३", ScheduleTaskKind.Spray,
            ScheduleTaskTiming.OnDays(35, 50, "फुलोरा (दिवस ३६–५०)").Repeating(ScheduleRepeatMode.EveryNDays, 7, endDay: 60),
            ScheduleBasis.OurChoice, StageIndex: 1, Order: 3,
            Why: "मणी लांबट होण्यासाठी.", Dose: "GA३ १५ ppm",
            Steps: ["सामू ५.५–६ ठेवा."],
            Products: [new ScheduleProduct("GA३", "१५", "ppm", "लिटर पाणी", "५०० लिटर")],
            ReEntryHours: 24, PreHarvestDays: 15, Warnings: ["पूर्ण फुलोऱ्यात फवारल्यास मणी गळतात."],
            Look: new ScheduleTaskLook("घड", "५ वेली", "मणी लांबट", "५०%", [new ScheduleIfThen("पाऊस", "फवारणी पुढे ढकला")], "P02"),
            Ask: new ScheduleTaskAsk("फुलोरा ५०% झाला का?", "सकाळी", [new ScheduleAnswer("yes", "आज फवारा"), new ScheduleAnswer("no", "उद्या पुन्हा पाहा")]),
            Sources: [new ScheduleSource("पुस्तक", "८२"), new ScheduleSource("NRC साप्ताहिक सल्ला, १८ मे २०२३")],
            Origin: "reader"),
        new("before-start", "माती तपासणी", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(-20, -18), ScheduleBasis.Stated, Order: 1),
        new("spray-two", "दुसरी फवारणी", ScheduleTaskKind.Spray,
            ScheduleTaskTiming.AfterTask("spray-one", usualDays: 4, earliestDays: 3, latestDays: 9, whenWords: "४–५ दिवसांनी")
                .Repeating(ScheduleRepeatMode.PerWeek, 2, endSign: "फळे पक्व झाल्यावर"),
            ScheduleBasis.Experience, StageIndex: 1, Order: 4),
        new("seen-one", "कूज", ScheduleTaskKind.Nutrition,
            ScheduleTaskTiming.WhenSeen("पाकळ्या फुगलेल्या दिसल्यावर", -5, 9, "फुलोऱ्याच्या अगदी आधी"), ScheduleBasis.Assumed, StageIndex: 1, Order: 5),
        new("water-one", "पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.None("मणी ३–४ मि.मी. झाल्यावर"), ScheduleBasis.Stated, Order: 6),
        new("open-end", "माइट", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(60), ScheduleBasis.Stated, Order: 7),
    ];

    private static IReadOnlyList<ScheduleChallengeContent> Challenges() =>
    [
        new("mildew", "केवडा घडांवर (फसवा काळ)", 1, 2, "दिवस ३५–५० (फुलोरा)", "फुलं गळतात", "५ दिवसांच्या अंतराने दोन फवारण्या",
            [new ScheduleIfThen("नोव्हेंबर-डिसेंबरमध्ये पाऊस झाला", "फवारण्या वाढवा")], [new ScheduleSource("GAP", "३५"), new ScheduleSource("पुस्तक", "८३")]),
        new("bare", "भुरी"),
    ];

    private static string FixturePath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "sync-contract")))
        {
            dir = dir.Parent;
        }

        dir.Should().NotBeNull("the repo root (the folder that holds sync-contract) is above the test binaries");
        return Path.Combine(dir!.FullName, "sync-contract", "tests", "fixtures", "schedule-task.contract.json");
    }

    private static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private static JsonObject Expected() => new()
    {
        ["tasks"] = new JsonArray(Tasks().Select(t => JsonNode.Parse(t.ToCanonicalJson())).ToArray()),
        ["challenges"] = new JsonArray(Challenges().Select(c => JsonNode.Parse(c.ToCanonicalJson())).ToArray()),
    };

    [Fact]
    public void Rewrites_the_fixture_only_when_asked()
    {
        if (Environment.GetEnvironmentVariable("UPDATE_SCHEDULE_TASK_FIXTURE") != "1")
        {
            return;
        }

        var path = FixturePath();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, Expected().ToJsonString(Pretty) + Environment.NewLine, new System.Text.UTF8Encoding(false));
    }

    [Fact]
    public void The_phone_fixture_is_exactly_what_the_server_writes()
    {
        var path = FixturePath();
        File.Exists(path).Should().BeTrue("run this class once with UPDATE_SCHEDULE_TASK_FIXTURE=1 to write it");

        var onDisk = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        JsonNode.DeepEquals(onDisk, Expected()).Should().BeTrue(
            "the fixture the phone's parser reads must be what the server writes today: every key, the nulls, the snake_case words");

        // And what the server writes reads back to the same content (the fixture is not only text that looks right).
        foreach (var (json, task) in onDisk["tasks"]!.AsArray().Zip(Tasks()))
        {
            ScheduleTaskContent.FromCanonicalJson(json!.ToJsonString())!.ContentHash().Should().Be(task.ContentHash());
        }

        foreach (var (json, challenge) in onDisk["challenges"]!.AsArray().Zip(Challenges()))
        {
            ScheduleChallengeContent.FromCanonicalJson(json!.ToJsonString())!.ContentHash().Should().Be(challenge.ContentHash());
        }
    }
}
