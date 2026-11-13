// spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D2 Cross-cutting; Review Focus 11; R28, R33; P11) - C# <-> TS SCHEDULE-DAYS PARITY, the server half.
//
// The शेड्यूल page's tabs (झालं / आज / पुढे) still count with the phone's ClientPlanEngine, while the stage panel and तुलना count with the
// server's ScheduleFollowEngine. They must put a routine on the SAME days. ONE shared fixture pins both:
// `sync-contract/tests/fixtures/schedule-engine-parity.json` holds, for the four built-in schedules (ReferenceDataCatalog, as the phone gets
// them) and one schedule that stores its days (start, end, repeat), the library JSON and the day numbers each activity falls on in each stage.
//   - this file proves the server's engine produces exactly those days (and that the fixture still holds today's four built-ins);
//   - `scheduleEngine.parity.test.ts` (phone) proves ClientPlanEngine produces exactly those days.
// Change either engine and one of them goes red. Regenerate the fixture with AGRISYNC_WRITE_PARITY_FIXTURE=1 (then re-run plain).
using System.Text.Json;
using System.Text.Json.Nodes;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Compare;

public sealed class ScheduleEngineParityTests
{
    private static readonly DateOnly Zero = new(2026, 1, 1);

    /// <summary>One schedule that stores its days: a routine with its own start and end, a per-week routine, a once-only work.</summary>
    private static ScheduleTemplateDto StoredDaysSchedule() => new(
        Guid.Parse("f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77399"),
        "Grapes - parity schedule that stores its days",
        "Grapes",
        90,
        [new StageDefinitionDto("A", 0, 30), new StageDefinitionDto("B", 31, 60), new StageDefinitionDto("C", 61, 90)],
        [
            new TemplateActivityDto("Fungicide spray", "Spraying", "A", 18, 28, "every_n_days", 5),
            new TemplateActivityDto("Drip irrigation", "Irrigation", "B", 31, 56, "every_n_days", 5),
            new TemplateActivityDto("Fertigation", "Fertigation", "B", 40, 60, "per_week", 2),
            new TemplateActivityDto("Bunch thinning", "Pruning", "B", 38, 38, "one_time", 1),
            new TemplateActivityDto("Weeding", "Weeding", "C", 61, 90, "every_n_days", 10),
        ],
        "parity");

    private static IReadOnlyList<ScheduleTemplateDto> Schedules() =>
        [.. ReferenceDataCatalog.ScheduleTemplates, StoredDaysSchedule()];

    /// <summary>The schedule as if it STORED these days (the built-ins do not): every activity expands from its start to its end.</summary>
    private static ScheduleDefinition StoredFormOf(ScheduleTemplateDto t)
    {
        var activities = t.Activities
            .Select((a, i) => a with
            {
                Id = new Guid(i + 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
                Part = "work",
                StoredFrequencyMode = a.FrequencyMode switch
                {
                    "one_time" => nameof(FrequencyMode.OneTime),
                    "every_n_days" => nameof(FrequencyMode.EveryNDays),
                    _ => nameof(FrequencyMode.PerWeek),
                },
            })
            .ToList();
        return ScheduleDefinitionMapper.From(t with { HasStoredDays = true, Activities = activities });
    }

    private static JsonObject Expected()
    {
        var schedules = new JsonArray();
        foreach (var t in Schedules())
        {
            var def = StoredFormOf(t);
            var windows = ScheduleFollowEngine.StageWindows(def, Zero);
            var stages = new JsonArray();
            foreach (var w in windows)
            {
                var plan = ScheduleFollowEngine.StagePlan(def, Zero, w);
                var activities = new JsonArray();
                for (var i = 0; i < def.Activities.Count; i++)
                {
                    var line = plan.FirstOrDefault(p => p.ActivityId == def.Activities[i].ActivityId);
                    var days = new JsonArray();
                    foreach (var d in line?.Dates ?? [])
                    {
                        days.Add(d.DayNumber - Zero.DayNumber);
                    }

                    activities.Add(new JsonObject { ["index"] = i, ["days"] = days });
                }

                stages.Add(new JsonObject { ["stage"] = w.Name, ["activities"] = activities });
            }

            schedules.Add(new JsonObject
            {
                ["key"] = t.Name,
                ["reference"] = JsonSerializer.SerializeToNode(new
                {
                    id = t.Id,
                    name = t.Name,
                    cropType = t.CropType,
                    totalDays = t.TotalDays,
                    stages = t.Stages.Select(s => new { name = s.Name, startDay = s.StartDay, endDay = s.EndDay }),
                    activities = t.Activities.Select(a => new
                    {
                        name = a.Name,
                        category = a.Category,
                        stageName = a.StageName,
                        startDay = a.StartDay,
                        endDay = a.EndDay,
                        frequencyMode = a.FrequencyMode,
                        intervalDays = a.IntervalDays,
                    }),
                    versionHash = t.VersionHash,
                }),
                ["dates"] = stages,
            });
        }

        var overrun = OverrunSchedule();
        return new JsonObject
        {
            ["note"] = "Day numbers from the schedule's day 0. reference = the library JSON as the phone gets it. Regenerate with AGRISYNC_WRITE_PARITY_FIXTURE=1.",
            ["schedules"] = schedules,
            ["knownDivergences"] = new JsonArray(new JsonObject
            {
                ["label"] = DivergenceLabel,
                ["reference"] = JsonSerializer.SerializeToNode(new
                {
                    id = overrun.Id,
                    name = overrun.Name,
                    cropType = overrun.CropType,
                    totalDays = overrun.TotalDays,
                    stages = overrun.Stages.Select(s => new { name = s.Name, startDay = s.StartDay, endDay = s.EndDay }),
                    activities = overrun.Activities.Select(a => new
                    {
                        name = a.Name,
                        category = a.Category,
                        stageName = a.StageName,
                        startDay = a.StartDay,
                        endDay = a.EndDay,
                        frequencyMode = a.FrequencyMode,
                        intervalDays = a.IntervalDays,
                    }),
                    versionHash = overrun.VersionHash,
                }),
                // what the SERVER's engine says today: the routine's days 25 30 35 40 fall in the window each date lies in
                ["server"] = ServerDaysOf(overrun),
                // what the PHONE's ClientPlanEngine says today: the routine stays inside the stage it is written under (it stops at that stage's end)
                ["phone"] = new JsonArray(
                    new JsonObject { ["stage"] = "A", ["days"] = new JsonArray(25, 30) },
                    new JsonObject { ["stage"] = "B", ["days"] = new JsonArray() }),
            }),
        };
    }

    private static string FixturePath()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var folder = Path.Combine(current.FullName, "sync-contract", "tests", "fixtures");
            if (Directory.Exists(folder))
            {
                return Path.Combine(folder, "schedule-engine-parity.json");
            }

            current = current.Parent;
        }

        throw new DirectoryNotFoundException("sync-contract/tests/fixtures was not found above the test output.");
    }

    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    [Fact]
    public void The_server_engine_puts_every_routine_on_the_days_the_shared_fixture_says_for_the_four_built_ins_and_a_stored_days_schedule()
    {
        var expected = Expected();
        if (Environment.GetEnvironmentVariable("AGRISYNC_WRITE_PARITY_FIXTURE") == "1")
        {
            File.WriteAllText(FixturePath(), expected.ToJsonString(Indented).Replace("\r\n", "\n").Replace("\n", "\r\n") + "\r\n");
        }

        var fixture = JsonNode.Parse(File.ReadAllText(FixturePath()))!.AsObject();
        Assert.Equal(
            expected.ToJsonString(new JsonSerializerOptions { Encoder = Indented.Encoder }),
            fixture.ToJsonString(new JsonSerializerOptions { Encoder = Indented.Encoder }));
    }

    [Fact]
    public void The_fixture_still_holds_the_four_built_in_schedules_the_server_sends_and_every_routine_lands_on_a_day()
    {
        var schedules = Schedules();
        Assert.Equal(5, schedules.Count);
        Assert.Equal(4, ReferenceDataCatalog.ScheduleTemplates.Count);
        foreach (var t in schedules)
        {
            var def = StoredFormOf(t);
            var all = ScheduleFollowEngine.Expand(def, Zero);
            Assert.NotEmpty(all);
            foreach (var a in def.Activities)
            {
                Assert.Contains(all, s => s.ActivityId == a.ActivityId);
            }
        }
    }

    public const string DivergenceLabel =
        "KNOWN DIVERGENCE (server counts overrun in the later stage, phone clips to its own stage): CTO call pending";

    [Fact]
    public void KNOWN_DIVERGENCE_a_routine_that_overruns_its_stage_is_pinned_in_the_shared_fixture_server_half()
    {
        // P002 (review CMPD2-REVIEW-1): the one case the plan said the fixture must cover. BOTH halves assert what each engine does TODAY,
        // from the same fixture entry, so a fix or a regression on either side turns one of them red. Neither engine is changed here.
        var fixture = JsonNode.Parse(File.ReadAllText(FixturePath()))!.AsObject();
        var entry = fixture["knownDivergences"]!.AsArray().Single()!.AsObject();

        Assert.Equal(DivergenceLabel, entry["label"]!.GetValue<string>());
        Assert.Equal(
            ServerDaysOf(OverrunSchedule()).ToJsonString(),
            entry["server"]!.ToJsonString());
        Assert.NotEqual(entry["server"]!.ToJsonString(), entry["phone"]!.ToJsonString());
    }

    /// <summary>Stages A 0-30 and B 31-60; a spray every 5 days from day 25 to day 40 written under stage A.</summary>
    private static ScheduleTemplateDto OverrunSchedule() => new(
        Guid.Parse("f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77398"),
        "Grapes - parity schedule with a routine that overruns its stage",
        "Grapes",
        60,
        [new StageDefinitionDto("A", 0, 30), new StageDefinitionDto("B", 31, 60)],
        [new TemplateActivityDto("Fungicide spray", "Spraying", "A", 25, 40, "every_n_days", 5)],
        "parity-overrun");

    private static JsonArray ServerDaysOf(ScheduleTemplateDto t)
    {
        var def = StoredFormOf(t);
        var stages = new JsonArray();
        foreach (var w in ScheduleFollowEngine.StageWindows(def, Zero))
        {
            var days = new JsonArray();
            foreach (var d in ScheduleFollowEngine.StagePlan(def, Zero, w).SelectMany(p => p.Dates ?? []))
            {
                days.Add(d.DayNumber - Zero.DayNumber);
            }

            stages.Add(new JsonObject { ["stage"] = w.Name, ["days"] = days });
        }

        return stages;
    }

    [Fact]
    public void A_routine_that_runs_past_its_stage_is_counted_by_the_server_in_the_next_stage_the_phone_clips_it_to_its_own()
    {
        // KNOWN DIFFERENCE, stated so nobody is surprised (CMP-D2 result, concern): ScheduleFollowEngine puts a routine on the days it STORES, whichever
        // stage window they fall in (the stage panel and तुलना count by date); the phone's ClientPlanEngine keeps a routine inside the stage it is
        // written under. A stored-days row whose routine ends after its stage ends is therefore counted differently by the शेड्यूल page's tabs.
        var crossing = StoredFormOf(new ScheduleTemplateDto(
            Guid.NewGuid(), "crossing", "Grapes", 90,
            [new StageDefinitionDto("A", 0, 30), new StageDefinitionDto("B", 31, 60)],
            [new TemplateActivityDto("Spray", "Spraying", "A", 25, 40, "every_n_days", 5)],
            "x"));

        var windows = ScheduleFollowEngine.StageWindows(crossing, Zero);
        var inA = ScheduleFollowEngine.StagePlan(crossing, Zero, windows[0]).Single().Dates!.Select(d => d.DayNumber - Zero.DayNumber);
        var inB = ScheduleFollowEngine.StagePlan(crossing, Zero, windows[1]).Single().Dates!.Select(d => d.DayNumber - Zero.DayNumber);

        Assert.Equal([25, 30], inA);
        Assert.Equal([35, 40], inB);
    }
}
