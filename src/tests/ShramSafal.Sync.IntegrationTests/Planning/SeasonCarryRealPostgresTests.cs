// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 3 "At season end ask once")
//
// At the end of a season (a crop cycle) the farmer's own schedule becomes next season's own schedule, asking once where the season's practice differed
// (`ownschedule.carry_forward`). It copies TIMERS (the dates follow the new pruning), keeps the origin exactly, never invents a value, never plans, never touches the main schedule,
// a plan or a log, and is idempotent per (plot, season that ended, next season).
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host and the real push handler; the switch row and the arrangement are written as superuser.
// Fake numbers only; no dose from any real schedule.
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
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class SeasonCarryRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private const string Carry = "ownschedule.carry_forward";
    private const string OffCode = "ShramSafal.ScheduleMechanismOff";
    private const string Invalid = "ShramSafal.OwnScheduleInvalid";
    private const string DoseA = "२ ग्रॅम प्रति लिटर";

    private static JsonElement Canonical(ScheduleTaskContent t) => JsonDocument.Parse(t.ToCanonicalJson()).RootElement.Clone();

    private static object StageBody(string name, int start, int end) => new { name, startDay = start, endDay = end, startSign = (string?)null, endSign = (string?)null };

    private static readonly object[] TwoStages = [StageBody("छाटणी आणि फूट", 0, 40), StageBody("मण्यांची वाढ", 41, 99)];

    private static IReadOnlyList<ScheduleTaskContent> SourceTasks() =>
    [
        new("t-prune", "फळछाटणी", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(0), ScheduleBasis.Stated, 0, 0),
        new("t-spray", "बुरशीनाशक फवारणी", ScheduleTaskKind.Spray, ScheduleTaskTiming.OnDays(10, 30), ScheduleBasis.Stated, 0, 1,
            Dose: DoseA, Products: [new ScheduleProduct("चाचणी औषध", DoseA, "ग्रॅम", "लिटर")], ReEntryHours: 24, PreHarvestDays: 30),
        new("t-water", "पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.OnDays(5), ScheduleBasis.Stated, 0, 2),
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
            stages = TwoStages,
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

    private Task SwitchOnAsync(params Guid[] farms) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.feature_flags (id, flag_name, enabled, cohort_pattern, description, modified_at_utc, modified_by)
        VALUES (gen_random_uuid(), 'schedule_mechanism', TRUE, @cohort, 'slice-11 test row', NOW(), 'test')
        ON CONFLICT (flag_name) DO UPDATE SET enabled = TRUE, cohort_pattern = EXCLUDED.cohort_pattern, modified_at_utc = NOW();
        """, ("cohort", string.Join('|', farms.Select(f => f.ToString()))));

    private Task GrantAsync(Guid person, params FarmAuthority[] authorities) => SetAuthoritiesAsync(FarmA, person, authorities);

    private async Task<SyncMutationResultDto> OkAsync(Task<SyncMutationResultDto> push)
    {
        var result = await push;
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    private Task<SyncMutationResultDto> TakeAsync(Guid actor, Guid plot, Guid cycle, Guid source, string key) =>
        PushAsAsync(actor, "schedule.take_task", $"take-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["sourceVersionId"] = source,
            ["taskKey"] = key,
        }, "1.0.18");

    private Task<SyncMutationResultDto> SaveByHandAsync(Guid actor, Guid plot, Guid cycle, string key, string name, int day) =>
        PushAsAsync(actor, "ownschedule.item.save", $"own-save-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["task"] = new Dictionary<string, object?>
            {
                ["taskKey"] = key,
                ["name"] = name,
                ["kind"] = "work",
                ["basis"] = "experience",
                ["stageIndex"] = 0,
                ["order"] = 5,
                ["timing"] = new Dictionary<string, object?> { ["timer"] = "day", ["fromDay"] = day, ["toDay"] = null },
            },
        }, "1.0.18");

    private Task<SyncMutationResultDto> PlanAsync(Guid actor, Guid plot, Guid cycle, string key) =>
        PushAsAsync(actor, "ownschedule.item.plan", $"own-plan-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["taskKey"] = key,
        }, "1.0.18");

    private Task<SyncMutationResultDto> CarryAsync(
        Guid actor, Guid plot, Guid from, Guid to, IEnumerable<(string Key, string Choice)>? answers = null, IEnumerable<string>? planOnly = null, Guid? farm = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["farmId"] = farm ?? FarmA,
            ["plotId"] = plot,
            ["fromCropCycleId"] = from,
            ["toCropCycleId"] = to,
            ["answers"] = (answers ?? []).Select(a => new Dictionary<string, object?> { ["taskKey"] = a.Key, ["choice"] = a.Choice }).ToArray(),
        };
        if (planOnly is not null)
        {
            payload["planOnly"] = planOnly.Select(p => new Dictionary<string, object?> { ["taskKey"] = p }).ToArray();
        }

        return PushAsAsync(actor, Carry, $"carry-{Guid.NewGuid():N}", payload, "1.0.18");
    }

    /// <summary>
    /// A grape plot: the season that ended (day 0 = 300 days ago, ended 100 days ago) following the checked source; in the own schedule TAKEN t-prune and t-spray and made by hand t-hand (day 3).
    /// t-spray was RECORDED on shown day 13 (the plan completed with a log). The NEXT season starts 2 days ago.
    /// </summary>
    private async Task<(Guid Plot, Guid Old, Guid Next, Guid Source, DateOnly OldStart, DateOnly NextStart)> SeasonEndedAsync(bool record = true)
    {
        await SwitchOnAsync(FarmA);
        var source = await ImportAndCheckAsync();
        var oldStart = TodayIst().AddDays(-300);
        var (plot, old) = await SeedSeasonStartingAsync("grape", oldStart);
        await PushAdoptAsync(Owner, plot, old, source);
        await OkAsync(TakeAsync(Owner, plot, old, source, "t-prune"));
        await OkAsync(TakeAsync(Owner, plot, old, source, "t-spray"));
        await OkAsync(SaveByHandAsync(Owner, plot, old, "t-hand", "माझे काम", 3));
        if (record)
        {
            await OkAsync(PlanAsync(Owner, plot, old, "t-spray"));
            var planId = Guid.Parse(await FingerprintAsync("SELECT id::text FROM ssf.planned_work WHERE own_item_id = @i", ("i", OwnScheduleItem.IdFor(old, "t-spray"))));
            var log = Guid.NewGuid();
            await OkAsync(PushAsAsync(Owner, "create_daily_log", $"log-{Guid.NewGuid():N}", new Dictionary<string, object?>
            {
                ["dailyLogId"] = log,
                ["farmId"] = FarmA,
                ["plotId"] = plot,
                ["cropCycleId"] = old,
                ["operatorUserId"] = Owner,
                ["logDate"] = oldStart.AddDays(12).ToString("yyyy-MM-dd"),
                ["content"] = new { schema = 1 },
            }, "1.0.18"));
            await OkAsync(PushAsAsync(Owner, "plannedwork.complete", $"done-{Guid.NewGuid():N}", new Dictionary<string, object?>
            {
                ["plannedWorkId"] = planId,
                ["farmId"] = FarmA,
                ["plotIds"] = new[] { plot },
                ["dailyLogIds"] = new[] { log },
            }, "1.0.18"));
        }

        await ExecOnSuperuserAsync("UPDATE ssf.crop_cycles SET end_date = @e WHERE \"Id\" = @c", ("e", TodayIst().AddDays(-100)), ("c", old));
        var nextStart = TodayIst().AddDays(-2);
        var next = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@c, @f, @p, 'grape', 'Vegetative', @s, NOW(), NOW())
            """, ("c", next), ("f", FarmA), ("p", plot), ("s", nextStart));
        return (plot, old, next, source, oldStart, nextStart);
    }

    private async Task<JsonElement> ContentOfAsync(Guid cycle, string key)
    {
        var json = await FingerprintAsync("SELECT content::text FROM ssf.own_schedule_items WHERE crop_cycle_id = @c AND task_key = @k", ("c", cycle), ("k", key));
        json.Should().NotBeEmpty($"the work {key} is in the season {cycle}");
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    private async Task<string> FingerprintAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in args)
        {
            cmd.Parameters.AddWithValue(n, v);
        }

        return (await cmd.ExecuteScalarAsync())?.ToString() ?? string.Empty;
    }

    private static JsonElement Data(SyncMutationResultDto result) => JsonSerializer.SerializeToElement(result.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web));

    // ---- the switch -----------------------------------------------------------------------------------------------------

    [Fact]
    public async Task SwitchOff_RefusesCarry_AndWritesNothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, _, _, _) = await SeasonEndedAsync(record: false);
        await ExecOnSuperuserAsync("UPDATE ssf.feature_flags SET enabled = FALSE WHERE flag_name = 'schedule_mechanism'");

        var result = await CarryAsync(Owner, plot, old, next);

        result.ErrorCode.Should().Be(OffCode);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_season_carries")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE crop_cycle_id = @c", ("c", next))).Should().Be(0);
    }

    // ---- the dates follow the new pruning ------------------------------------------------------------------------------------

    [Fact]
    public async Task Carry_UsesNewPruningDate()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, _, oldStart, nextStart) = await SeasonEndedAsync();
        const string Untouched = "SELECT (SELECT count(*) FROM ssf.schedule_templates) || '/' || (SELECT count(*) FROM ssf.schedule_subscriptions) || '/' || (SELECT count(*) FROM ssf.daily_logs) || '/' || (SELECT count(*) FROM ssf.planned_work)";
        var before = (await FingerprintAsync(Untouched)).Split('/');

        var result = await OkAsync(CarryAsync(Owner, plot, old, next));
        Data(result).GetProperty("carried").GetInt32().Should().Be(3);

        // The copy holds the TIMER of the old work (a day from pruning), never a date.
        var hand = await ContentOfAsync(next, "t-hand");
        hand.GetProperty("timing").GetProperty("fromDay").GetInt32().Should().Be(3);
        hand.GetRawText().Should().NotContain(oldStart.ToString("yyyy-MM-dd"), "a copy never carries a literal date");

        // Planned in the new season, the work falls on the NEW pruning day + 3 (the new season's day 0 is its start): the dates follow.
        await OkAsync(PlanAsync(Owner, plot, next, "t-hand"));
        var planned = await FingerprintAsync("SELECT planned_date::text FROM ssf.planned_work WHERE own_item_id = @i", ("i", OwnScheduleItem.IdFor(next, "t-hand")));
        planned.Should().Be(nextStart.AddDays(3).ToString("yyyy-MM-dd"));

        // The copy is a plain own work: planned by nobody, recorded by nobody (taken is never done), and the old season, main schedule, plans and logs are as they were.
        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE own_item_id IN (SELECT id FROM ssf.own_schedule_items WHERE crop_cycle_id = @c) AND status <> 'Open'", ("c", next))).Should().Be(0);
        var after = (await FingerprintAsync(Untouched)).Split('/');
        after[..3].Should().Equal(before[..3], "no template, subscription or log changed: the main schedule and the records are as they were");
        int.Parse(after[3]).Should().Be(int.Parse(before[3]) + 1, "only the one plan made above is new: the carry planned nothing");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE crop_cycle_id = @c AND state = 0", ("c", old))).Should().Be(3, "the season that ended keeps every work");
    }

    // ---- once only -------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Carry_Twice_OneCopy()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        await GrantAsync(CoOwner, FarmAuthority.ScheduleTemplates, FarmAuthority.PlanWork);
        var (plot, old, next, _, _, _) = await SeasonEndedAsync(record: false);

        var first = await OkAsync(CarryAsync(Owner, plot, old, next, [("t-spray", "skip")]));
        var second = await OkAsync(CarryAsync(CoOwner, plot, old, next, [("t-spray", "schedule")]));
        var replay = await OkAsync(CarryAsync(Owner, plot, old, next));

        Data(first).GetProperty("replayed").GetBoolean().Should().BeFalse();
        foreach (var later in new[] { second, replay })
        {
            Data(later).GetProperty("replayed").GetBoolean().Should().BeTrue("a second phone finds the answers already there");
            Data(later).GetProperty("skipped").GetInt32().Should().Be(1, "the second answer changes nothing: the first one stands");
        }

        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE crop_cycle_id = @c", ("c", next))).Should().Be(2, "t-spray was skipped and the others carried once");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE crop_cycle_id = @c", ("c", next))).Should().Be(2);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins WHERE crop_cycle_id = @c", ("c", next))).Should().Be(1, "only the taken t-prune has an origin; t-hand was made by hand");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_season_carries WHERE plot_id = @p", ("p", plot))).Should().Be(3);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'OwnScheduleSeasonCarried'")).Should().Be(1);
    }

    [Fact]
    public async Task Unanswered_IsCarriedAsWritten_AndTheAnswerRowSaysSo()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, _, _, _) = await SeasonEndedAsync();

        var result = await OkAsync(CarryAsync(Owner, plot, old, next, [("t-hand", "schedule")]));

        var data = Data(result);
        data.GetProperty("carried").GetInt32().Should().Be(3, "an unanswered question never refuses the save (P8)");
        data.GetProperty("keptAsWritten").EnumerateArray().Select(e => e.GetString()).Should().BeEquivalentTo(["t-prune", "t-spray"]);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_season_carries WHERE plot_id = @p AND answered = false AND choice = 0", ("p", plot))).Should().Be(2);
        (await ContentOfAsync(next, "t-spray")).GetProperty("timing").GetProperty("fromDay").GetInt32().Should().Be(10, "carried as written, not as recorded");
    }

    // ---- plan-only work: asked, never copied by itself -----------------------------------------------------------------------

    [Fact]
    public async Task PlanOnlyWork_AskedNotCopied()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // A work he planned and then took out of the own schedule: plan-only. Not picked, it is not copied.
        var (plot, old, next, _, _, _) = await SeasonEndedAsync(record: false);
        await OkAsync(PlanAsync(Owner, plot, old, "t-hand"));
        await OkAsync(PushAsAsync(Owner, "ownschedule.item.remove", $"own-remove-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["plotId"] = plot, ["cropCycleId"] = old, ["taskKey"] = "t-hand" }, "1.0.18"));
        var none = await OkAsync(CarryAsync(Owner, plot, old, next));
        Data(none).GetProperty("planOnlyCarried").GetArrayLength().Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE crop_cycle_id = @c AND task_key = 't-hand'", ("c", next))).Should().Be(0, "plan-only work is not copied unless picked");

        // The same, and the farmer picks it: it comes in as it was written, with no plan and no record, and nothing else changes.
        var (plot2, old2, next2, _, _, _) = await SeasonEndedAsync(record: false);
        await OkAsync(PlanAsync(Owner, plot2, old2, "t-hand"));
        await OkAsync(PushAsAsync(Owner, "ownschedule.item.remove", $"own-remove-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["plotId"] = plot2, ["cropCycleId"] = old2, ["taskKey"] = "t-hand" }, "1.0.18"));
        var picked = await OkAsync(CarryAsync(Owner, plot2, old2, next2, planOnly: ["t-hand", "t-never-existed"]));
        Data(picked).GetProperty("planOnlyCarried").EnumerateArray().Select(e => e.GetString()).Should().BeEquivalentTo(["t-hand"]);
        Data(picked).GetProperty("planOnlyNotCarried").EnumerateArray().Select(e => e.GetString()).Should().BeEquivalentTo(["t-never-existed"], "a pick that names no such work is said, never invented");
        (await ContentOfAsync(next2, "t-hand")).GetProperty("timing").GetProperty("fromDay").GetInt32().Should().Be(3);
        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE own_item_id = @i", ("i", OwnScheduleItem.IdFor(next2, "t-hand")))).Should().Be(0, "a copy is never planned and never done");
    }

    [Fact]
    public async Task PlanOnlyPick_OfAWorkStillInTheSchedule_IsIgnored_AndTheCarryApplies()
    {
        // A phone that has not pulled since the work came back still lists it as plan-only. Its pick must not fail the carry (a failing mutation is replayed for ever):
        // the work is carried once, by its answer, and no second row of that key is written.
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, _, _, _) = await SeasonEndedAsync(record: false);

        var result = await OkAsync(CarryAsync(Owner, plot, old, next, [("t-hand", "skip")], planOnly: ["t-hand"]));

        Data(result).GetProperty("skipped").GetInt32().Should().Be(1, "the answer stands");
        Data(result).GetProperty("planOnlyCarried").GetArrayLength().Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE crop_cycle_id = @c AND task_key = 't-hand'", ("c", next))).Should().Be(0, "skipped, and the stale pick copies nothing");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_season_carries WHERE plot_id = @p AND task_key = 't-hand'", ("p", plot))).Should().Be(1);
    }

    // ---- origin ----------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Origin_OfTheCopy_IsThePreviousCurrentOrigin_EvenWhenTheSourceIsWithdrawn()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, source, _, _) = await SeasonEndedAsync();
        (await CheckAsync(PlatformOwner, source, "Withdrawn", note: "the source was revised")).Status.Should().Be(HttpStatusCode.OK);

        await OkAsync(CarryAsync(Owner, plot, old, next, [("t-prune", "schedule"), ("t-spray", "mine")]));

        const string Shape = "source_version_id, source_chain_id, source_name, source_version_number, source_owner_user_id, source_task_key, chosen_dose, taken_by_user_id, taken_on, taken_at_utc, owner_user_id, farm_id, plot_id";
        foreach (var key in new[] { "t-prune", "t-spray" })
        {
            var before = await FingerprintAsync($"SELECT row_to_json(x)::text FROM (SELECT {Shape} FROM ssf.own_schedule_item_origins WHERE item_id = @i ORDER BY sequence DESC LIMIT 1) x", ("i", OwnScheduleItem.IdFor(old, key)));
            var copy = await FingerprintAsync($"SELECT row_to_json(x)::text FROM (SELECT {Shape} FROM ssf.own_schedule_item_origins WHERE item_id = @i ORDER BY sequence DESC LIMIT 1) x", ("i", OwnScheduleItem.IdFor(next, key)));
            before.Should().NotBeEmpty();
            copy.Should().Be(before, $"the origin of the copy of {key} is exactly the previous work's current origin, withdrawn source and all");
            (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE id = @i AND origin = @o", ("i", OwnScheduleItem.IdFor(next, key)), ("o", "take:" + source.ToString("N")))).Should().Be(1);
        }

        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins WHERE item_id = @i", ("i", OwnScheduleItem.IdFor(next, "t-hand")))).Should().Be(0, "a work made by hand has no origin to repeat");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_season_carries WHERE previous_item_id = @p AND new_item_id = @n",
            ("p", OwnScheduleItem.IdFor(old, "t-spray")), ("n", OwnScheduleItem.IdFor(next, "t-spray")))).Should().Be(1, "the previous-item link reads the chain back");
    }

    // ---- "मी केलं तसं" -----------------------------------------------------------------------------------------------------

    [Fact]
    public async Task IDid_TakesTheRecordedDay_AndKeepsTheQuantityAndGaps_WhenTheRecordStatesNone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, _, _, _) = await SeasonEndedAsync();

        await OkAsync(CarryAsync(Owner, plot, old, next, [("t-spray", "mine"), ("t-hand", "mine")]));

        var spray = await ContentOfAsync(next, "t-spray");
        spray.GetProperty("timing").GetProperty("fromDay").GetInt32().Should().Be(12, "recorded on shown day 13 = stored day 12; the window keeps its width");
        spray.GetProperty("timing").GetProperty("toDay").GetInt32().Should().Be(32);
        spray.GetProperty("dose").GetString().Should().Be(DoseA, "a log task states no quantity, so the work keeps its own (nothing invented, P4)");
        spray.GetProperty("products")[0].GetProperty("doseAsWritten").GetString().Should().Be(DoseA);
        spray.GetProperty("reEntryHours").GetInt32().Should().Be(24);
        spray.GetProperty("preHarvestDays").GetInt32().Should().Be(30, "a safety gap never shrinks");
        (await ContentOfAsync(next, "t-hand")).GetProperty("timing").GetProperty("fromDay").GetInt32().Should().Be(3, "no record: the work keeps its own day");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_season_carries WHERE task_key = 't-spray' AND choice = 1 AND recorded_stored_day = 12 AND answered")).Should().Be(1);
    }

    [Fact]
    public async Task Skip_IsNotCarried_AndTheSeasonThatEndedIsUntouched()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, _, _, _) = await SeasonEndedAsync();
        var oldRows = await FingerprintAsync("SELECT string_agg(row_to_json(i)::text, '|' ORDER BY id) FROM ssf.own_schedule_items i WHERE crop_cycle_id = @c", ("c", old));

        var result = await OkAsync(CarryAsync(Owner, plot, old, next, [("t-hand", "skip")]));

        Data(result).GetProperty("skipped").GetInt32().Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE crop_cycle_id = @c AND task_key = 't-hand'", ("c", next))).Should().Be(0);
        (await FingerprintAsync("SELECT string_agg(row_to_json(i)::text, '|' ORDER BY id) FROM ssf.own_schedule_items i WHERE crop_cycle_id = @c", ("c", old))).Should().Be(oldRows);
    }

    // ---- who may -------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Worker_IsRefused_AndSoIsPlanningPermissionAlone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, _, _, _) = await SeasonEndedAsync(record: false);

        (await CarryAsync(Worker, plot, old, next)).ErrorCode.Should().Be("ShramSafal.Forbidden");

        await GrantAsync(Mukadam, FarmAuthority.PlanWork);
        (await CarryAsync(Mukadam, plot, old, next)).ErrorCode.Should().Be("ShramSafal.Forbidden", "planning permission alone does not write the own schedule (SM-10)");
        await GrantAsync(Mukadam, FarmAuthority.ScheduleTemplates);
        (await CarryAsync(Mukadam, plot, old, next)).ErrorCode.Should().Be("ShramSafal.Forbidden", "the schedule permission alone does not plan");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_season_carries")).Should().Be(0);

        await GrantAsync(Mukadam, FarmAuthority.ScheduleTemplates, FarmAuthority.PlanWork);
        await OkAsync(CarryAsync(Mukadam, plot, old, next));
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE crop_cycle_id = @c", ("c", next))).Should().Be(3);
    }

    [Fact]
    public async Task NotTheNextSeason_IsRefused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, _, _, _) = await SeasonEndedAsync(record: false);

        var backwards = await CarryAsync(Owner, plot, next, old);
        backwards.Status.Should().Be("failed");
        backwards.ErrorCode.Should().Be(Invalid);
        backwards.ErrorMessage.Should().Contain("CarryNotNextSeason");
        (await CarryAsync(Owner, plot, old, old)).ErrorCode.Should().Be(Invalid);
        (await CarryAsync(Owner, plot, old, Guid.NewGuid())).Status.Should().Be("failed");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_season_carries")).Should().Be(0);
    }

    // ---- the pull ----------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task NewPhonePull_CarriesTheAnswers_AndAnOldPhoneNeverSeesTheKey()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, _, _, _) = await SeasonEndedAsync();
        await OkAsync(CarryAsync(Owner, plot, old, next, [("t-spray", "mine"), ("t-hand", "skip")]));

        using var fresh = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}&scheduleFormat=2", Owner);
        var body = await fresh.Content.ReadAsStringAsync();
        fresh.IsSuccessStatusCode.Should().BeTrue(body);
        var rows = JsonDocument.Parse(body).RootElement.GetProperty("ownScheduleCarries").EnumerateArray().ToList();
        rows.Should().HaveCount(3);
        rows.Single(r => r.GetProperty("taskKey").GetString() == "t-spray").GetProperty("choice").GetString().Should().Be("mine");
        rows.Single(r => r.GetProperty("taskKey").GetString() == "t-hand").GetProperty("choice").GetString().Should().Be("skip");
        rows.Single(r => r.GetProperty("taskKey").GetString() == "t-prune").GetProperty("answered").GetBoolean().Should().BeFalse();

        using var oldPhone = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}", Owner);
        (await oldPhone.Content.ReadAsStringAsync()).Should().NotContain("ownScheduleCarries", "an old phone's pull is byte for byte what it was (P11)");
    }

    // ---- row security, both directions, as the real application role -----------------------------------------------------------

    [Fact]
    public async Task Rls_BothDirections_AsTheAppRole()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, old, next, _, _, _) = await SeasonEndedAsync(record: false);
        await OkAsync(CarryAsync(Owner, plot, old, next));

        (await CountAsync("SELECT count(*) FROM pg_class WHERE oid = 'ssf.own_schedule_season_carries'::regclass AND relrowsecurity AND relforcerowsecurity")).Should().Be(1);

        // Reading: the farm's own scope sees its rows, another farm's scope sees none.
        (await AppRowsAsync(FarmA, Owner, "SELECT 1 FROM ssf.own_schedule_season_carries")).Should().Be(3);
        (await AppRowsAsync(FarmB, OwnerB, "SELECT 1 FROM ssf.own_schedule_season_carries")).Should().Be(0);

        // Writing: a row for farm A under farm B's scope, or naming another owner or a season that is not that plot's, is refused; append-only: no update, no delete.
        string Insert(Guid farm, Guid owner, Guid cycle) => $"""
            INSERT INTO ssf.own_schedule_season_carries (id, farm_id, plot_id, from_crop_cycle_id, crop_cycle_id, owner_user_id, task_key, previous_item_id, new_item_id, choice, answered, recorded_stored_day, decided_by_user_id, decided_at_utc)
            VALUES (gen_random_uuid(), '{farm}'::uuid, '{plot}'::uuid, '{old}'::uuid, '{cycle}'::uuid, '{owner}'::uuid, 'x-probe', NULL, NULL, 2, true, NULL, '{owner}'::uuid, NOW())
            """;
        (await AppTryAsync(FarmB, OwnerB, Insert(FarmA, Owner, next))).Should().Be("42501", "farm B's scope cannot write a row of farm A");
        (await AppTryAsync(FarmA, Owner, Insert(FarmB, OwnerB, next))).Should().Be("42501", "nor farm A's scope one of farm B");
        (await AppTryAsync(FarmA, Owner, Insert(FarmA, OwnerB, next))).Should().Be("42501", "the owner is the farm's, never a writer's");
        (await AppTryAsync(FarmA, Owner, Insert(FarmA, Owner, PlotBCycle()))).Should().Be("42501", "the season must be that plot's");
        (await AppTryAsync(FarmA, Owner, Insert(FarmA, Owner, next))).Should().BeNull("the positive control: the farm's own row goes through");
        (await AppTryAsync(FarmA, Owner, "UPDATE ssf.own_schedule_season_carries SET choice = 0")).Should().Be("42501");
        (await AppTryAsync(FarmA, Owner, "DELETE FROM ssf.own_schedule_season_carries")).Should().Be("42501");
    }

    private static Guid PlotBCycle() => CycleB;

    private async Task<int> AppRowsAsync(Guid farm, Guid user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        var n = 0;
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            n++;
        }

        return n;
    }

    private async Task<string?> AppTryAsync(Guid farm, Guid user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        try
        {
            await cmd.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException ex)
        {
            return ex.SqlState;
        }
    }

    private static async Task ScopeAsync(NpgsqlConnection db, Guid farm, Guid user)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.farm_id', @f, true), set_config('agrisync.user_id', @u, true)";
        cmd.Parameters.AddWithValue("f", farm.ToString());
        cmd.Parameters.AddWithValue("u", user.ToString());
        await cmd.ExecuteNonQueryAsync();
    }
}
