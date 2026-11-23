// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6, "नोंद and तुलना close the loop"; approved spec plr-d10-schedule-approved-spec-2026-11-23, SM-12)
//
// The loop closes: a work of his own schedule, planned ("plan", then who), completed WITH a record, counts against exactly that work in तुलना (words do not
// matter: the plan names the record), the own schedule still being built is its OWN row and the मुख्य stage line does not change; once made main it counts
// like any main schedule, and on लक्ष द्या the plan's work and its step are one line that the record clears.
//
// Real Postgres as agrisync_app, through the real host, the real push handler and the real compare / attention routes. Fake numbers only.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleLoopRealPostgresTests(ITestOutputHelper output) : FarmCompareLane(output)
{
    private Task SwitchOnAsync(params Guid[] farms) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.feature_flags (id, flag_name, enabled, cohort_pattern, description, modified_at_utc, modified_by)
        VALUES (gen_random_uuid(), 'schedule_mechanism', TRUE, @cohort, 'slice-6 test row', NOW(), 'test')
        ON CONFLICT (flag_name) DO UPDATE SET enabled = TRUE, cohort_pattern = EXCLUDED.cohort_pattern, modified_at_utc = NOW();
        """, ("cohort", string.Join('|', farms.Select(f => f.ToString()))));

    private static Dictionary<string, object?> DayTiming(int from) => new() { ["timer"] = "day", ["fromDay"] = from };

    private static Dictionary<string, object?> Work(string key, string name, Dictionary<string, object?> timing, int stage, string kind = "work") => new()
    {
        ["taskKey"] = key,
        ["name"] = name,
        ["kind"] = kind,
        ["timing"] = timing,
        ["basis"] = "experience",
        ["stageIndex"] = stage,
    };

    private async Task<SyncMutationResultDto> OkAsync(Task<SyncMutationResultDto> push)
    {
        var result = await push;
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    private Task<SyncMutationResultDto> SaveAsync(Guid plot, Guid cycle, Dictionary<string, object?> task) =>
        PushAsAsync(Owner, "ownschedule.item.save", $"own-save-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle, ["task"] = task }, "1.0.18");

    private async Task<Guid> PlanAsync(Guid plot, Guid cycle, string key)
    {
        var planned = await OkAsync(PushAsAsync(Owner, "ownschedule.item.plan", $"own-plan-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["taskKey"] = key,
        }, "1.0.18"));
        return JsonSerializer.SerializeToElement(planned.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web)).GetProperty("id").GetGuid();
    }

    private Task<SyncMutationResultDto> CompleteAsync(Guid plan, Guid plot, params Guid[] logs) =>
        OkAsync(PushAsAsync(Owner, "plannedwork.complete", $"done-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = plan,
            ["farmId"] = FarmA,
            ["plotIds"] = new[] { plot },
            ["dailyLogIds"] = logs,
        }, "1.0.18"));

    private Task<SyncMutationResultDto> MakeMainAsync(Guid plot, Guid cycle) =>
        OkAsync(PushAsAsync(Owner, "ownschedule.make_main", $"own-main-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["name"] = "माझे वेळापत्रक",
            ["stageLine"] = new[]
            {
                new Dictionary<string, object?> { ["name"] = "आधी", ["startDay"] = 0, ["endDay"] = 12 },
                new Dictionary<string, object?> { ["name"] = "वाढ", ["startDay"] = 13, ["endDay"] = 40 },
            },
        }, "1.0.18"));

    private static int N(JsonElement e, string name) => e.GetProperty(name).ValueKind == JsonValueKind.Number ? e.GetProperty(name).GetInt32() : 0;

    private static JsonElement? OwnRowOf(JsonElement plot) =>
        plot.TryGetProperty("ownBuilding", out var row) && row.ValueKind == JsonValueKind.Object ? row : null;

    private async Task<List<JsonElement>> BoardWorkAsync(Guid plot)
    {
        var (status, body) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/attention", Owner, null);
        status.Should().Be(HttpStatusCode.OK, body);
        return ArrayOf(Json(body), "scheduledWork").Where(w => w.GetProperty("plotId").GetGuid() == plot).ToList();
    }

    [Fact]
    public async Task OwnBuildingRow_ShownInCompare_MainStageLineUnchanged()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        await SwitchOnAsync(FarmA);
        var uni = await CheckedInstitutionAsync(); // stages 0-12, 13-40, 41-99
        var (plot, cycle, _) = await FollowingAsync(uni.Id, dayToday: 20);
        var start = TodayIst().AddDays(-20);

        var before = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        var stagesBefore = before.GetProperty("stages").GetRawText();
        var mainBefore = SchedulesOf(before)[0].GetProperty("stages").GetRawText();
        OwnRowOf(before).Should().BeNull("no own schedule is being built: the answer is the one an old phone always read");

        // One work of his own, in the main schedule's second stage (index 1 = 13-40), on day 18.
        await OkAsync(SaveAsync(plot, cycle, Work("tie", "वेली बांधणी", DayTiming(18), stage: 1)));

        var saved = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        saved.GetProperty("stages").GetRawText().Should().Be(stagesBefore, "SM-12: the main schedule's stage line does not change");
        var row = OwnRowOf(saved);
        row.Should().NotBeNull("the schedule still being built is its OWN row");
        row!.Value.GetProperty("works").GetInt32().Should().Be(1);
        var stage2 = row.Value.GetProperty("stages")[1];
        stage2.GetProperty("asked").GetInt32().Should().Be(1);
        stage2.GetProperty("done").GetInt32().Should().Be(0, "taken / saved is never done");

        // Planned (the second act), then completed WITH a record whose words name no tying at all: the link counts it for exactly that work.
        var plan = await PlanAsync(plot, cycle, "tie");
        var log = await RecordAsync(Owner, plot, cycle, start.AddDays(19), "मजूर आले");
        await CompleteAsync(plan, plot, log);

        var done = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        done.GetProperty("stages").GetRawText().Should().Be(stagesBefore);
        var doneStage = OwnRowOf(done)!.Value.GetProperty("stages")[1];
        doneStage.GetProperty("asked").GetInt32().Should().Be(1);
        doneStage.GetProperty("done").GetInt32().Should().Be(1, "1 of 1: the plan names its record");
        SchedulesOf(done)[0].GetProperty("stages").GetRawText().Should().Be(mainBefore, "the main schedule's counts are its own: the record names no work of it");
        done.GetProperty("notRecognised").EnumerateArray().Should().NotContain(n => n.GetProperty("dailyLogId").GetGuid() == log,
            "a record of a work of his own schedule is never 'not recognised'");

        // Made main: no longer a row being built; it is a followed schedule, and the record still counts for its work.
        await MakeMainAsync(plot, cycle);
        var main = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        OwnRowOf(main).Should().BeNull("once made main it is a schedule like any other");
        var own = SchedulesOf(main).Single(s => s.GetProperty("origin").GetString() == "Own");
        var counted = own.GetProperty("stages").EnumerateArray().Where(s => s.ValueKind == JsonValueKind.Object).ToList();
        counted.Sum(s => N(s, "done")).Should().Be(1);
        counted.Sum(s => N(s, "asked")).Should().Be(1, "its one work asks once; a stage with no stored work asks no number");
    }

    [Fact]
    public async Task OwnBuildingRow_OfOnlyAfterAndSignWorks_IsStillARow()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        await SwitchOnAsync(FarmA);
        var uni = await CheckedInstitutionAsync();
        var (plot, cycle, _) = await FollowingAsync(uni.Id, dayToday: 20);

        await OkAsync(SaveAsync(plot, cycle, Work("first", "पाणी", new() { ["timer"] = "sign", ["signWords"] = "माती कोरडी" }, stage: 0, kind: "irrigation")));
        await OkAsync(SaveAsync(plot, cycle, Work("tie", "वेली बांधणी", new() { ["timer"] = "after", ["afterTaskKey"] = "first", ["usualDays"] = 4 }, stage: 1)));

        var row = OwnRowOf(PlotOf(await CompareOkAsync(Owner, FarmA), plot));
        row.Should().NotBeNull("a schedule of only 'after' and 'sign' works still gives तुलना a row");
        row!.Value.GetProperty("works").GetInt32().Should().Be(2);
        var stage2 = row.Value.GetProperty("stages")[1];
        stage2.ValueKind.Should().Be(JsonValueKind.Object, "the current stage is counted");
        stage2.GetProperty("asked").ValueKind.Should().Be(JsonValueKind.Null, "no date is known: no number asked (P4)");
        var unknown = row.Value.GetProperty("stageUnknown");
        unknown.ValueKind.Should().Be(JsonValueKind.Object, "stage 0 of an own work may be a stage left open: 'stage unknown'");
        unknown.GetProperty("asked").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task PlanAndStep_OneAttentionItem()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        var start = TodayIst().AddDays(-20);

        await OkAsync(SaveAsync(plot, cycle, Work("tie", "वेली बांधणी", DayTiming(10), stage: 0)));
        await MakeMainAsync(plot, cycle);
        var plan = await PlanAsync(plot, cycle, "tie");

        var open = await BoardWorkAsync(plot);
        open.Count(w => w.GetProperty("activityName").GetString() == "वेली बांधणी")
            .Should().Be(1, "the plan of the work and the schedule's step are one line in लक्ष द्या");

        // Completed with a record in other words: the step is done (the plan names the record); nothing is left to remind.
        var log = await RecordAsync(Owner, plot, cycle, start.AddDays(11), "मजूर आले");
        await CompleteAsync(plan, plot, log);
        (await BoardWorkAsync(plot)).Should().NotContain(w => w.GetProperty("activityName").GetString() == "वेली बांधणी",
            "the record the plan was completed with clears exactly its step");
    }
}
