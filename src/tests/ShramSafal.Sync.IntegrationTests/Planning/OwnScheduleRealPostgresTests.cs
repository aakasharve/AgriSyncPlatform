// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// The farmer's OWN schedule is built one work at a time (`ownschedule.item.save` / `.remove`), kept apart from the main schedule, and becomes main only on
// "हेच मुख्य करा" (`ownschedule.make_main`): freeze a version, write its day works for old phones, switch the plot's own place - one transaction.
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host and the real push handler; the switch row and the arrangement are written
// as superuser. Whole-second sync cursors (the phone's). Fake numbers only; no dose from any real schedule.
using System;
using System.Collections.Generic;
using System.Linq;
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
public sealed class OwnScheduleRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private const string Save = "ownschedule.item.save";
    private const string Remove = "ownschedule.item.remove";
    private const string MakeMain = "ownschedule.make_main";
    private const string OffCode = "ShramSafal.ScheduleMechanismOff";

    // ---- arrangement -----------------------------------------------------------------------------------------------

    private Task SwitchOnAsync(params Guid[] farms) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.feature_flags (id, flag_name, enabled, cohort_pattern, description, modified_at_utc, modified_by)
        VALUES (gen_random_uuid(), 'schedule_mechanism', TRUE, @cohort, 'slice-3 test row', NOW(), 'test')
        ON CONFLICT (flag_name) DO UPDATE SET enabled = TRUE, cohort_pattern = EXCLUDED.cohort_pattern, modified_at_utc = NOW();
        """, ("cohort", string.Join('|', farms.Select(f => f.ToString()))));

    /// <summary>A grape season on a new plot of farm A whose day 1 (stored 0) was <paramref name="daysAgo"/> days ago.</summary>
    private Task<(Guid Plot, Guid Cycle)> PlotOnDayAsync(int daysAgo = 15) => SeedSeasonStartingAsync("grape", TodayIst().AddDays(-daysAgo));

    private static Dictionary<string, object?> DayTiming(int from, int? to = null) => new() { ["timer"] = "day", ["fromDay"] = from, ["toDay"] = to };

    private static Dictionary<string, object?> SignTiming(string words, int? expectedFrom = null) =>
        new() { ["timer"] = "sign", ["signWords"] = words, ["expectedFromDay"] = expectedFrom };

    private static Dictionary<string, object?> AfterTiming(string key, int usual) => new() { ["timer"] = "after", ["afterTaskKey"] = key, ["usualDays"] = usual };

    private static Dictionary<string, object?> Task(
        string key, string name, Dictionary<string, object?> timing, string kind = "work", int stage = 0, int? reEntryHours = null, string? origin = null) => new()
        {
            ["taskKey"] = key,
            ["name"] = name,
            ["kind"] = kind,
            ["timing"] = timing,
            ["basis"] = "experience",
            ["stageIndex"] = stage,
            ["reEntryHours"] = reEntryHours,
            ["origin"] = origin,
        };

    private static Dictionary<string, object?> Stage(string name, int start, int end, string? endSign = null) => new()
    {
        ["name"] = name,
        ["startDay"] = start,
        ["endDay"] = end,
        ["endSign"] = endSign,
    };

    private Task<SyncMutationResultDto> SaveAsync(
        Guid actor, Guid plot, Guid cycle, Dictionary<string, object?> task, Guid? farm = null, string? requestId = null, bool secondPhone = false)
    {
        var payload = new Dictionary<string, object?> { ["farmId"] = farm ?? FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle, ["task"] = task };
        var id = requestId ?? $"own-save-{Guid.NewGuid():N}";
        return secondPhone ? PushAsync(actor, Save, id, payload) : PushAsAsync(actor, Save, id, payload, "1.0.18");
    }

    private Task<SyncMutationResultDto> RemoveAsync(Guid actor, Guid plot, Guid cycle, string key, Guid? farm = null) =>
        PushAsAsync(actor, Remove, $"own-remove-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = farm ?? FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle, ["taskKey"] = key }, "1.0.18");

    private Task<SyncMutationResultDto> MakeMainAsync(
        Guid actor, Guid plot, Guid cycle, IReadOnlyList<Dictionary<string, object?>>? stages = null, string? name = "माझे वेळापत्रक", Guid? farm = null)
    {
        var payload = new Dictionary<string, object?> { ["farmId"] = farm ?? FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle };
        if (name is not null)
        {
            payload["name"] = name;
        }

        if (stages is not null)
        {
            payload["stageLine"] = stages;
        }

        return PushAsAsync(actor, MakeMain, $"own-main-{Guid.NewGuid():N}", payload, "1.0.18");
    }

    private async Task<SyncMutationResultDto> OkAsync(Task<SyncMutationResultDto> push)
    {
        var result = await push;
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    private static readonly IReadOnlyList<Dictionary<string, object?>> TwoStages = [Stage("फुटवा", 0, 10, endSign: "फूट दिसली"), Stage("वाढ", 20, 40)];

    private Task<long> OwnVersionsAsync() => CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE owner_user_id = @o", ("o", Owner));

    /// <summary>The template id the plot's Active own place (0) follows, or null.</summary>
    private async Task<Guid?> OwnPlaceTemplateAsync(Guid plot)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT schedule_template_id FROM ssf.schedule_subscriptions WHERE plot_id = @p AND state = 0 AND slot = 0";
        cmd.Parameters.AddWithValue("p", plot);
        return await cmd.ExecuteScalarAsync() is Guid id ? id : null;
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

    private Task<string> SubscriptionsFingerprintAsync(Guid plot) => FingerprintAsync(
        "SELECT coalesce(string_agg(row_to_json(s)::text, '|' ORDER BY id), '') FROM ssf.schedule_subscriptions s WHERE plot_id = @p", ("p", plot));

    private async Task<(string Body, JsonElement Root)> NewPhonePullAsync(Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}&scheduleFormat=2", user);
        var body = await response.Content.ReadAsStringAsync();
        response.IsSuccessStatusCode.Should().BeTrue(body);
        return (body, JsonDocument.Parse(body).RootElement.Clone());
    }

    private static Guid? MainSubscriptionOf(JsonElement root, Guid plot) =>
        ArrayOf(root, "plotMainSchedules").Where(m => m.GetProperty("plotId").GetGuid() == plot).Select(m => (Guid?)m.GetProperty("subscriptionId").GetGuid()).FirstOrDefault();

    private async Task<string?> StageNameAsync(Guid plot, string? forDate = null)
    {
        var (status, body) = await StagePlanAsync(Owner, FarmA, plot, forDate);
        ((int)status).Should().Be(200, body);
        var root = Json(body);
        return root.TryGetProperty("stage", out var stage) && stage.ValueKind == JsonValueKind.Object ? stage.GetProperty("name").GetString() : null;
    }

    // ---- the switch --------------------------------------------------------------------------------------------------

    [Fact]
    public async Task SwitchOff_RefusesAllThreeNames_AndWritesNothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle) = await PlotOnDayAsync();

        (await SaveAsync(Owner, plot, cycle, Task("t1", "छाटणी", DayTiming(0)))).ErrorCode.Should().Be(OffCode);
        (await RemoveAsync(Owner, plot, cycle, "t1")).ErrorCode.Should().Be(OffCode);
        (await MakeMainAsync(Owner, plot, cycle, TwoStages)).ErrorCode.Should().Be(OffCode);

        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions")).Should().Be(0);
        (await OwnVersionsAsync()).Should().Be(0);
    }

    // ---- review focus 2: a first work changes nothing of the main schedule ---------------------------------------------

    [Fact]
    public async Task FirstWork_DoesNotBecomeMain()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var uni = await CheckedInstitutionAsync();
        var (plot, cycle) = await PlotOnDayAsync(15);
        var followed = await PushAdoptAsync(Owner, plot, cycle, uni.Id);
        var subsBefore = await SubscriptionsFingerprintAsync(plot);
        var stageBefore = await StageNameAsync(plot);
        MainSubscriptionOf((await PullAsync(Owner)).Root, plot).Should().Be(followed);

        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "पहिली खुरपणी", DayTiming(14), stage: 0)));

        (await SubscriptionsFingerprintAsync(plot)).Should().Be(subsBefore, "saving a work never takes a place on the plot");
        (await OwnVersionsAsync()).Should().Be(0, "a work is kept as an item; no version of a schedule is written until हेच मुख्य करा");
        MainSubscriptionOf((await PullAsync(Owner)).Root, plot).Should().Be(followed, "the main schedule is still the one he follows");
        (await StageNameAsync(plot)).Should().Be(stageBefore, "the stage line does not change");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE plot_id = @p AND main_version_id IS NULL", ("p", plot))).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE plot_id = @p", ("p", plot))).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE plot_id = @p AND owner_user_id = @o", ("p", plot), ("o", Owner)))
            .Should().Be(1, "the owner comes from the farm row");
    }

    [Fact]
    public async Task FirstWork_SatisfiesTrialGate()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        await CheckedInstitutionAsync();
        // After the trial: a plot that follows nothing while something can be followed must choose first (D-76).
        await SetStandingAsync(AccountA, Owner, Active, DateTime.UtcNow.AddDays(-30), DateTime.UtcNow.AddDays(30));
        var (plot, cycle) = await PlotOnDayAsync(15);
        StateOf((await PullAsync(Owner)).Root, plot)!.Value.GetProperty("needsSchedule").GetBoolean().Should().BeTrue();

        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "पहिली खुरपणी", SignTiming("तण दिसले"))));

        var state = StateOf((await PullAsync(Owner)).Root, plot)!.Value;
        state.GetProperty("needsSchedule").GetBoolean().Should().BeFalse("SM-7: a schedule still being built satisfies the gate from one work");
        state.GetProperty("followsAllowed").GetBoolean().Should().BeTrue();
        (await OwnVersionsAsync()).Should().Be(0, "and it is still not main");

        // Removing that one work: nothing of his own is left, so the gate asks again.
        await OkAsync(RemoveAsync(Owner, plot, cycle, "t1"));
        StateOf((await PullAsync(Owner)).Root, plot)!.Value.GetProperty("needsSchedule").GetBoolean().Should().BeTrue();
    }

    // ---- make main ---------------------------------------------------------------------------------------------------

    [Fact]
    public async Task MakeMain_WithSignEndedStages_KeepsStageLine()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle) = await PlotOnDayAsync(15); // today = stored day 15: after stage 1's expected end (10), before stage 2 (20)
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("feet", "फूट मोजणी", SignTiming("फूट दिसली", 5), kind: "observe", stage: 0)));
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("tie", "वेली बांधणी", AfterTiming("feet", 8), stage: 1)));

        var made = await OkAsync(MakeMainAsync(Owner, plot, cycle, TwoStages));

        var version = await OwnPlaceTemplateAsync(plot);
        version.Should().NotBeNull("make main switches the plot's own place to the frozen version");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_tasks WHERE schedule_template_id = @t", ("t", version!.Value))).Should().Be(2);
        (await CountAsync("SELECT count(*) FROM ssf.template_activities WHERE schedule_template_id = @t", ("t", version.Value)))
            .Should().Be(0, "an 'after' and a 'sign' work have no stored day: nothing is invented for old phones");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_template_stages WHERE schedule_template_id = @t AND end_sign = 'फूट दिसली' AND end_day = 10", ("t", version.Value)))
            .Should().Be(1, "a sign-ended stage keeps its expected end day (NOT NULL for the deployed binary) and its sign");

        var root = (await NewPhonePullAsync(Owner)).Root;
        var main = MainSubscriptionOf(root, plot);
        main.Should().NotBeNull("a schedule of only 'after' and 'sign' works is still main: the facts reader accepts the task format");
        (await StageNameAsync(plot)).Should().Be("फुटवा", "a stage with a sign end stays open until its sign, past its expected day");
        (await StageNameAsync(plot, TodayIst().AddDays(10).ToString("yyyy-MM-dd"))).Should().Be("वाढ");
        made.Data.Should().NotBeNull();
    }

    [Fact]
    public async Task MakeMain_IsAtomic()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle) = await PlotOnDayAsync(15);
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "छाटणी", DayTiming(0))));
        var itemsBefore = await FingerprintAsync("SELECT coalesce(string_agg(row_to_json(i)::text, '|' ORDER BY id), '') FROM ssf.own_schedule_items i");
        var revisionsBefore = await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions");
        var subsBefore = await SubscriptionsFingerprintAsync(plot);

        // The LAST write of make main (the plot's place) fails: nothing of it may stay - no version, no task, no activity, no mark on the works.
        await ExecOnSuperuserAsync($"""
            CREATE OR REPLACE FUNCTION ssf.test_refuse_place() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.plot_id = '{plot}'::uuid THEN RAISE EXCEPTION 'test: the place write fails' USING ERRCODE = '23514'; END IF;
              RETURN NEW;
            END $$;
            CREATE TRIGGER test_refuse_place BEFORE INSERT ON ssf.schedule_subscriptions FOR EACH ROW EXECUTE FUNCTION ssf.test_refuse_place();
            """);
        try
        {
            var refused = await MakeMainAsync(Owner, plot, cycle, TwoStages);
            refused.Status.Should().Be("failed");
        }
        finally
        {
            await ExecOnSuperuserAsync("DROP TRIGGER IF EXISTS test_refuse_place ON ssf.schedule_subscriptions; DROP FUNCTION IF EXISTS ssf.test_refuse_place();");
        }

        (await OwnVersionsAsync()).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_tasks WHERE owner_user_id = @o", ("o", Owner))).Should().Be(0);
        (await FingerprintAsync("SELECT coalesce(string_agg(row_to_json(i)::text, '|' ORDER BY id), '') FROM ssf.own_schedule_items i")).Should().Be(itemsBefore);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions")).Should().Be(revisionsBefore);
        (await SubscriptionsFingerprintAsync(plot)).Should().Be(subsBefore);

        // With the fault gone the same act goes through whole.
        await OkAsync(MakeMainAsync(Owner, plot, cycle, TwoStages));
        (await OwnVersionsAsync()).Should().Be(1);
        (await OwnPlaceTemplateAsync(plot)).Should().NotBeNull();
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE plot_id = @p AND main_version_id IS NOT NULL", ("p", plot))).Should().Be(1);
    }

    // ---- after main --------------------------------------------------------------------------------------------------

    [Fact]
    public async Task EditAfterMain_MovesOnlyThatPlot()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plotP, cycleP) = await PlotOnDayAsync(15);
        var (plotQ, cycleQ) = await PlotOnDayAsync(15);
        await OkAsync(SaveAsync(Owner, plotP, cycleP, Task("t1", "छाटणी", DayTiming(0))));
        await OkAsync(MakeMainAsync(Owner, plotP, cycleP, TwoStages));
        var v1 = (await OwnPlaceTemplateAsync(plotP))!.Value;

        // SM-9: once main, his other plot may follow it (the existing adopt door).
        await PushAdoptAsync(Owner, plotQ, cycleQ, v1);
        (await OwnPlaceTemplateAsync(plotQ)).Should().Be(v1);

        // SM-8: an edit after main moves THAT plot to the new version by itself; the other plot stays.
        await OkAsync(SaveAsync(Owner, plotP, cycleP, Task("t2", "पहिली फवारणी", DayTiming(12), kind: "spray", stage: 1)));

        var v2 = (await OwnPlaceTemplateAsync(plotP))!.Value;
        v2.Should().NotBe(v1);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @v2 AND previous_version_id = @v1 AND version = 2", ("v2", v2), ("v1", v1))).Should().Be(1);
        (await OwnPlaceTemplateAsync(plotQ)).Should().Be(v1, "the other plot keeps the version it follows");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_migration_events WHERE plot_id = @p AND new_schedule_id = @v2", ("p", plotP), ("v2", v2))).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_tasks WHERE schedule_template_id = @v1", ("v1", v1))).Should().Be(1, "the version before is never rewritten (P3)");
    }

    [Fact]
    public async Task EditKeepsStepIdentityAndReminderMoves()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle) = await PlotOnDayAsync(15);
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "छाटणी", DayTiming(3), reEntryHours: 24)));
        await OkAsync(MakeMainAsync(Owner, plot, cycle, TwoStages));
        var v1 = (await OwnPlaceTemplateAsync(plot))!.Value;
        var sub1 = Guid.Parse(await FingerprintAsync("SELECT id FROM ssf.schedule_subscriptions WHERE plot_id = @p AND state = 0 AND slot = 0", ("p", plot)));
        var activity1 = Guid.Parse(await FingerprintAsync("SELECT \"Id\" FROM ssf.template_activities WHERE schedule_template_id = @t", ("t", v1)));
        var original = TodayIst().AddDays(-15 + 3);
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.schedule_step_moves ("Id", farm_id, schedule_subscription_id, template_activity_id, original_date, new_date, moved_by_user_id, moved_at_utc)
            VALUES (gen_random_uuid(), @f, @s, @a, @o, @n, @u, NOW());
            """, ("f", FarmA), ("s", sub1), ("a", activity1), ("o", original), ("n", original.AddDays(5)), ("u", Owner));
        var hash1 = await FingerprintAsync("SELECT content_hash FROM ssf.schedule_tasks WHERE schedule_template_id = @t AND task_key = 't1'", ("t", v1));

        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t2", "पहिली फवारणी", DayTiming(25), kind: "spray", stage: 1)));

        var v2 = (await OwnPlaceTemplateAsync(plot))!.Value;
        v2.Should().NotBe(v1);
        var sub2 = Guid.Parse(await FingerprintAsync("SELECT id FROM ssf.schedule_subscriptions WHERE plot_id = @p AND state = 0 AND slot = 0", ("p", plot)));
        var activity2 = Guid.Parse(await FingerprintAsync(
            "SELECT \"Id\" FROM ssf.template_activities WHERE schedule_template_id = @t AND activity_name = 'छाटणी'", ("t", v2)));
        (await FingerprintAsync("SELECT content_hash FROM ssf.schedule_tasks WHERE schedule_template_id = @t AND task_key = 't1'", ("t", v2)))
            .Should().Be(hash1, "the work keeps its key and its content: the same step");
        (await CountAsync("""
            SELECT count(*) FROM ssf.schedule_step_moves WHERE schedule_subscription_id = @s AND template_activity_id = @a AND original_date = @o AND new_date = @n
            """, ("s", sub2), ("a", activity2), ("o", original), ("n", original.AddDays(5))))
            .Should().Be(1, "the reminder he moved travels to the new version (a version per change must not lose it)");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_step_moves WHERE schedule_subscription_id = @s", ("s", sub1))).Should().Be(1, "the old move row is history and stays");
    }

    // ---- review focus 1: two phones, one key -----------------------------------------------------------------------

    [Fact]
    public async Task TwoPhones_SameKey_OneItem()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle) = await PlotOnDayAsync(15);

        // Both phones were offline and each saved the work "t1"; the second edit was queued behind the first, never refused.
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "खुरपणी", DayTiming(14))));
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "खुरपणी (दुसरी)", DayTiming(16)), secondPhone: true));
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "खुरपणी (दुसरी)", DayTiming(16)), secondPhone: true));

        var id = OwnScheduleItem.IdFor(cycle, "t1");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE crop_cycle_id = @c", ("c", cycle))).Should().Be(1, "one key, one item");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE id = @i AND revision = 2 AND name = 'खुरपणी (दुसरी)'", ("i", id))).Should().Be(1, "the later save is an edit of it");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE item_id = @i", ("i", id)))
            .Should().Be(2, "every change is kept; a save that changes nothing writes nothing");
    }

    // ---- isolation, both directions, as the application role --------------------------------------------------------

    [Fact]
    public async Task ForeignFarm_BothDirections_Refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA, FarmB);
        var (plot, cycle) = await PlotOnDayAsync(15);
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "खुरपणी", DayTiming(14))));

        // Farm B's owner names farm A: refused, nothing written.
        var stranger = await SaveAsync(OwnerB, plot, cycle, Task("x1", "परकी", DayTiming(1)));
        stranger.Status.Should().Be("failed");
        stranger.ErrorCode.Should().Be(nameof(ShramSafal) + ".Forbidden");
        (await MakeMainAsync(OwnerB, plot, cycle, TwoStages)).Status.Should().Be("failed");
        (await RemoveAsync(OwnerB, plot, cycle, "t1")).Status.Should().Be("failed");

        // Farm A's owner names his own farm with farm B's plot: refused like an unknown plot (E4: the child is checked, not only the parent).
        var crossed = await SaveAsync(Owner, PlotB, CycleB, Task("x2", "परकी", DayTiming(1)));
        crossed.Status.Should().Be("failed");
        // ...and farm B with his own plot: he is no member of farm B.
        (await SaveAsync(Owner, plot, cycle, Task("x3", "परकी", DayTiming(1)), farm: FarmB)).Status.Should().Be("failed");

        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE id = @i AND revision = 1", ("i", OwnScheduleItem.IdFor(cycle, "t1")))).Should().Be(1);

        // Row security as agrisync_app: farm B's scope sees none of farm A's works and cannot write one naming farm A; farm A's scope sees its own.
        (await AppCountAsync(FarmB, OwnerB, "SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(0);
        (await AppCountAsync(FarmB, OwnerB, "SELECT count(*) FROM ssf.own_schedule_item_revisions")).Should().Be(0);
        (await AppCountAsync(FarmA, Owner, "SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(1);
        (await AppRowsAsync(FarmB, OwnerB, "UPDATE ssf.own_schedule_items SET name = 'बदल'")).Should().Be(0, "farm B's scope cannot change a work of farm A");
        (await AppTryAsync(FarmB, OwnerB, $"""
            INSERT INTO ssf.own_schedule_items (id, farm_id, plot_id, crop_cycle_id, owner_user_id, task_key, name, kind, timer_kind, stage_index, order_index, content, content_hash,
                                                state, revision, created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc)
            VALUES (gen_random_uuid(), '{FarmA}'::uuid, '{plot}'::uuid, '{cycle}'::uuid, '{OwnerB}'::uuid, 'x8', 'परकी', 'work', 'none', 0, 0, jsonb_build_object(),
                    repeat('a', 64), 0, 1, '{OwnerB}'::uuid, NOW(), '{OwnerB}'::uuid, NOW())
            """)).Should().Be("42501");
        // ...nor farm A's scope a row of farm B (the other direction), nor one whose owner is not the farm's owner.
        (await AppTryAsync(FarmA, Owner, $"""
            INSERT INTO ssf.own_schedule_items (id, farm_id, plot_id, crop_cycle_id, owner_user_id, task_key, name, kind, timer_kind, stage_index, order_index, content, content_hash,
                                                state, revision, created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc)
            VALUES (gen_random_uuid(), '{FarmB}'::uuid, '{PlotB}'::uuid, '{CycleB}'::uuid, '{OwnerB}'::uuid, 'x7', 'परकी', 'work', 'none', 0, 0, jsonb_build_object(),
                    repeat('a', 64), 0, 1, '{Owner}'::uuid, NOW(), '{Owner}'::uuid, NOW())
            """)).Should().Be("42501");
        (await AppTryAsync(FarmA, Owner, $"""
            INSERT INTO ssf.own_schedule_items (id, farm_id, plot_id, crop_cycle_id, owner_user_id, task_key, name, kind, timer_kind, stage_index, order_index, content, content_hash,
                                                state, revision, created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc)
            VALUES (gen_random_uuid(), '{FarmA}'::uuid, '{plot}'::uuid, '{cycle}'::uuid, '{Mukadam}'::uuid, 'x6', 'परकी', 'work', 'none', 0, 0, jsonb_build_object(),
                    repeat('a', 64), 0, 1, '{Owner}'::uuid, NOW(), '{Owner}'::uuid, NOW())
            """)).Should().Be("42501", "the owner column is the farm's owner, never what a writer says");
        // The positive control: the same statement, naming farm A's owner on farm A under farm A's scope, goes through (so each refusal above is the rule, not a typo).
        (await AppTryAsync(FarmA, Owner, $"""
            INSERT INTO ssf.own_schedule_items (id, farm_id, plot_id, crop_cycle_id, owner_user_id, task_key, name, kind, timer_kind, stage_index, order_index, content, content_hash,
                                                state, revision, created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc)
            VALUES (gen_random_uuid(), '{FarmA}'::uuid, '{plot}'::uuid, '{cycle}'::uuid, '{Owner}'::uuid, 'x5', 'स्वतःचे', 'work', 'none', 0, 0, jsonb_build_object(),
                    repeat('a', 64), 0, 1, '{Owner}'::uuid, NOW(), '{Owner}'::uuid, NOW())
            """)).Should().BeNull();
        // The history is append-only for the application role.
        (await AppTryAsync(FarmA, Owner, "UPDATE ssf.own_schedule_item_revisions SET name = 'बदल'")).Should().Be("42501");
        (await AppTryAsync(FarmA, Owner, "DELETE FROM ssf.own_schedule_item_revisions")).Should().Be("42501");
    }

    // ---- old phones --------------------------------------------------------------------------------------------------

    [Fact]
    public async Task OldPhone_PullHasNoNewKey_AndNewPhoneGetsTheWorks()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle) = await PlotOnDayAsync(15);
        await OkAsync(SaveAsync(Owner, plot, cycle, Task("t1", "खुरपणी", DayTiming(14))));

        var (oldBody, _) = await PullAsync(Owner);
        oldBody.Should().NotContain("ownScheduleItems", "a phone that does not ask for the new format is sent exactly what it was sent before");

        var (_, root) = await NewPhonePullAsync(Owner);
        var items = ArrayOf(root, "ownScheduleItems");
        items.Should().ContainSingle(i => i.GetProperty("taskKey").GetString() == "t1" && i.GetProperty("plotId").GetGuid() == plot);
        var item = items.Single(i => i.GetProperty("taskKey").GetString() == "t1");
        item.GetProperty("revision").GetInt32().Should().Be(1);
        item.GetProperty("state").GetString().Should().Be("active");
        item.GetProperty("task").GetProperty("name").GetString().Should().Be("खुरपणी");

        // A worker of the farm with no schedule authority still reads them (planning shows them); farm B's owner never does.
        var (otherBody, _) = await NewPhonePullAsync(OwnerB);
        otherBody.Should().NotContain(plot.ToString());
    }

    // ---- helpers as the application role --------------------------------------------------------------------------

    private async Task<long> AppCountAsync(Guid farm, Guid user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<int> AppRowsAsync(Guid farm, Guid user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>Runs <paramref name="sql"/> as agrisync_app under a farm scope; the SQLSTATE of a refusal, or null when it went through (rolled back either way).</summary>
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
