// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9, "One take with origin kept"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
//
// ONE tap (`schedule.take_task`) puts a work of a schedule the plot FOLLOWS into the farmer's OWN schedule, with where it came from. It writes the own work, its
// revision and its origin and NOTHING else: no plan, no move of the main schedule. "Plan", then who, is the farmer's second act (`ownschedule.item.plan`), and the
// server refuses it for a work that is not in the own schedule. The origin (owner, schedule, version, task, day) is written once and never changes.
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host and the real push handler; the switch row and the arrangement are written as
// superuser. Fake numbers only; no dose from any real schedule.
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
public sealed class ScheduleTakeRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private const string Take = "schedule.take_task";
    private const string Save = "ownschedule.item.save";
    private const string Remove = "ownschedule.item.remove";
    private const string MakeMain = "ownschedule.make_main";
    private const string Plan = "ownschedule.item.plan";
    private const string OffCode = "ShramSafal.ScheduleMechanismOff";
    private const string Invalid = "ShramSafal.OwnScheduleInvalid";
    private const string DoseA = "२ ग्रॅम प्रति लिटर";
    private const string DoseB = "३ ग्रॅम प्रति लिटर";

    // ---- the reference schedule the plot follows (format 2, checked) ---------------------------------------------------

    private static JsonElement Canonical(ScheduleTaskContent t) => JsonDocument.Parse(t.ToCanonicalJson()).RootElement.Clone();

    private static object StageBody(string name, int start, int end) => new { name, startDay = start, endDay = end, startSign = (string?)null, endSign = (string?)null };

    private static readonly object[] TwoStages = [StageBody("छाटणी आणि फूट", 0, 40), StageBody("मण्यांची वाढ", 41, 99)];

    /// <summary>A spray with TWO doses (its own and one more in its products), a day work and a work after it.</summary>
    private static IReadOnlyList<ScheduleTaskContent> SourceTasks() =>
    [
        new("t-prune", "फळछाटणी", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(0), ScheduleBasis.Stated, 0, 0),
        new("t-spray", "बुरशीनाशक फवारणी", ScheduleTaskKind.Spray, ScheduleTaskTiming.OnDays(10, 30), ScheduleBasis.Stated, 0, 1,
            Dose: DoseA, Products: [new ScheduleProduct("चाचणी औषध", DoseA, "ग्रॅम", "लिटर"), new ScheduleProduct("दुसरे चाचणी औषध", DoseB, "ग्रॅम", "लिटर")],
            ReEntryHours: 24, PreHarvestDays: 30),
        new("t-water", "पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.OnDays(5), ScheduleBasis.Stated, 0, 2),
    ];

    private bool _seatsSeededHere;

    private async Task<Guid> ImportAndCheckAsync(string name = "द्राक्ष: चाचणी संदर्भ", string pruneName = "फळछाटणी")
    {
        if (!_seatsSeededHere)
        {
            _seatsSeededHere = true;
            await SeedReviewSeatsAsync(); // a second seeding would collide on the same users
        }

        var body = new
        {
            format = 2,
            name,
            cropKey = "grape",
            ownerType = "INSTITUTION",
            sourceLabel = "चाचणी पुस्तिका",
            previousVersionId = (Guid?)null,
            stages = TwoStages,
            tasks = SourceTasks().Select(t => t.TaskKey == "t-prune" ? t with { Name = pruneName } : t).Select(Canonical).ToArray(),
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
        VALUES (gen_random_uuid(), 'schedule_mechanism', TRUE, @cohort, 'slice-9 test row', NOW(), 'test')
        ON CONFLICT (flag_name) DO UPDATE SET enabled = TRUE, cohort_pattern = EXCLUDED.cohort_pattern, modified_at_utc = NOW();
        """, ("cohort", string.Join('|', farms.Select(f => f.ToString()))));

    /// <summary>A grape season whose day 1 was 15 days ago, following the checked source.</summary>
    private async Task<(Guid Plot, Guid Cycle, Guid Source)> FollowingAsync(Guid? source = null)
    {
        var src = source ?? await ImportAndCheckAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("grape", TodayIst().AddDays(-15));
        await PushAdoptAsync(Owner, plot, cycle, src);
        return (plot, cycle, src);
    }

    private Task<SyncMutationResultDto> TakeAsync(
        Guid actor, Guid plot, Guid cycle, Guid source, string key, string? dose = null, Guid? farm = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["farmId"] = farm ?? FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["sourceVersionId"] = source,
            ["taskKey"] = key,
        };
        if (dose is not null)
        {
            payload["dose"] = dose;
        }

        return PushAsAsync(actor, Take, $"take-{Guid.NewGuid():N}", payload, "1.0.18");
    }

    private Task<SyncMutationResultDto> SaveAsync(Guid actor, Guid plot, Guid cycle, Dictionary<string, object?> task) =>
        PushAsAsync(actor, Save, $"own-save-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle, ["task"] = task }, "1.0.18");

    private Task<SyncMutationResultDto> RemoveAsync(Guid actor, Guid plot, Guid cycle, string key) =>
        PushAsAsync(actor, Remove, $"own-remove-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle, ["taskKey"] = key }, "1.0.18");

    private Task<SyncMutationResultDto> MakeMainAsync(Guid actor, Guid plot, Guid cycle) =>
        PushAsAsync(actor, MakeMain, $"own-main-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["name"] = "माझे वेळापत्रक",
            ["stageLine"] = new[]
            {
                new Dictionary<string, object?> { ["name"] = "फुटवा", ["startDay"] = 0, ["endDay"] = 10, ["endSign"] = "फूट दिसली" },
                new Dictionary<string, object?> { ["name"] = "वाढ", ["startDay"] = 20, ["endDay"] = 40 },
            },
        }, "1.0.18");

    private Task<SyncMutationResultDto> PlanAsync(Guid actor, Guid plot, Guid cycle, string key, Guid? assignee = null) =>
        PushAsAsync(actor, Plan, $"own-plan-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["plannedWorkId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["taskKey"] = key,
            ["assigneeUserId"] = assignee,
        }.Where(kv => kv.Value is not null).ToDictionary(kv => kv.Key, kv => kv.Value), "1.0.18");

    private static Dictionary<string, object?> ByHand(string key, string name, string? origin = null) => new()
    {
        ["taskKey"] = key,
        ["name"] = name,
        ["kind"] = "work",
        ["timing"] = new Dictionary<string, object?> { ["timer"] = "day", ["fromDay"] = 3, ["toDay"] = null },
        ["basis"] = "experience",
        ["stageIndex"] = 0,
        ["origin"] = origin,
    };

    private async Task<SyncMutationResultDto> OkAsync(Task<SyncMutationResultDto> push)
    {
        var result = await push;
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
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

    private Task<string> OriginRowAsync(Guid item) => FingerprintAsync(
        "SELECT coalesce((SELECT row_to_json(o)::text FROM ssf.own_schedule_item_origins o WHERE o.item_id = @i AND o.sequence = 1), '')", ("i", item));

    private Task<string> MainFingerprintAsync() => FingerprintAsync("""
        SELECT coalesce((SELECT string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text) FROM ssf.schedule_templates t), '')
            || '#' || coalesce((SELECT string_agg(row_to_json(s)::text, '|' ORDER BY row_to_json(s)::text) FROM ssf.schedule_subscriptions s), '')
        """);

    private Task<long> PlansAsync() => CountAsync("SELECT count(*) FROM ssf.planned_work");

    private async Task<(string Body, JsonElement Root)> NewPhonePullAsync(Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}&scheduleFormat=2", user);
        var body = await response.Content.ReadAsStringAsync();
        response.IsSuccessStatusCode.Should().BeTrue(body);
        return (body, JsonDocument.Parse(body).RootElement.Clone());
    }

    private async Task GrantAsync(Guid person, params FarmAuthority[] authorities) => await SetAuthoritiesAsync(FarmA, person, authorities);

    // ---- the switch -----------------------------------------------------------------------------------------------------

    [Fact]
    public async Task SwitchOff_RefusesTake_AndWritesNothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle, source) = await FollowingAsync();

        var result = await TakeAsync(Owner, plot, cycle, source, "t-spray");

        result.ErrorCode.Should().Be(OffCode);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins")).Should().Be(0);
    }

    // ---- take makes the item, never a plan ---------------------------------------------------------------------------------

    [Fact]
    public async Task Take_MakesItem_NoPlan()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();
        var plansBefore = await PlansAsync();

        var result = await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-prune"));

        var item = OwnScheduleItem.IdFor(cycle, "t-prune");
        JsonSerializer.SerializeToElement(result.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web)).GetProperty("itemId").GetGuid().Should().Be(item);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE id = @i AND state = 0 AND revision = 1 AND task_key = 't-prune' AND origin = @o",
            ("i", item), ("o", "take:" + source.ToString("N")))).Should().Be(1, "the work is in the own schedule with its origin text");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE item_id = @i", ("i", item))).Should().Be(1);
        (await CountAsync("""
            SELECT count(*) FROM ssf.own_schedule_item_origins
            WHERE item_id = @i AND sequence = 1 AND source_version_id = @s AND source_task_key = 't-prune' AND source_version_number = 1 AND source_name = 'द्राक्ष: चाचणी संदर्भ'
              AND taken_by_user_id = @u AND farm_id = @f AND chosen_dose IS NULL AND source_chain_id = @s AND taken_on = @d
            """, ("i", item), ("s", source), ("u", Owner), ("f", FarmA), ("d", TodayIst()))).Should().Be(1, "the origin: schedule, version, task, who and the farm-local day");
        (await PlansAsync()).Should().Be(plansBefore, "take makes no plan (approved spec guardrail)");
        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE own_item_id = @i", ("i", item))).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'ScheduleTaskTaken' AND entity_id = @i", ("i", item))).Should().Be(1);
    }

    [Fact]
    public async Task Plan_WithoutOwnItem_Refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();

        // The work is in the followed schedule, but not in the farmer's own: planning it is refused, nothing written.
        var refused = await PlanAsync(Owner, plot, cycle, "t-spray");
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be(Invalid);
        refused.ErrorMessage.Should().Contain("OwnScheduleItemUnknown");
        (await PlansAsync()).Should().Be(0);

        // Three taps: take, plan, who - the plan exists only after the second act.
        await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-spray"));
        (await PlansAsync()).Should().Be(0);
        await OkAsync(PlanAsync(Owner, plot, cycle, "t-spray", assignee: Owner));
        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE own_item_id = @i AND schedule_task_key = 't-spray'", ("i", OwnScheduleItem.IdFor(cycle, "t-spray")))).Should().Be(1);
    }

    [Fact]
    public async Task Take_SecondPerson_SameResult()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        await GrantAsync(CoOwner, FarmAuthority.ScheduleTemplates, FarmAuthority.PlanWork);
        var (plot, cycle, source) = await FollowingAsync();

        var first = await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-prune"));
        var item = OwnScheduleItem.IdFor(cycle, "t-prune");
        var row = await OriginRowAsync(item);

        var second = await OkAsync(TakeAsync(CoOwner, plot, cycle, source, "t-prune"));
        var again = await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-prune"));

        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        JsonSerializer.SerializeToElement(first.Data, web).GetProperty("taken").GetBoolean().Should().BeTrue();
        foreach (var later in new[] { second, again })
        {
            var data = JsonSerializer.SerializeToElement(later.Data, web);
            data.GetProperty("itemId").GetGuid().Should().Be(item, "one work, whoever taps");
            data.GetProperty("taken").GetBoolean().Should().BeFalse("it was already in the own schedule");
        }

        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions")).Should().Be(1);
        (await OriginRowAsync(item)).Should().Be(row, "the second person changes nothing, least of all the origin");
    }

    [Fact]
    public async Task Take_NeedsBothPermissions()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();

        await GrantAsync(Mukadam, FarmAuthority.PlanWork);
        (await TakeAsync(Mukadam, plot, cycle, source, "t-prune")).ErrorCode.Should().Be("ShramSafal.Forbidden", "planning permission alone plans only what is already there (SM-10)");
        await GrantAsync(Mukadam, FarmAuthority.ScheduleTemplates);
        (await TakeAsync(Mukadam, plot, cycle, source, "t-prune")).ErrorCode.Should().Be("ShramSafal.Forbidden", "the schedule permission alone does not plan");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(0);

        await GrantAsync(Mukadam, FarmAuthority.ScheduleTemplates, FarmAuthority.PlanWork);
        await OkAsync(TakeAsync(Mukadam, plot, cycle, source, "t-prune"));
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(1);
    }

    [Fact]
    public async Task Take_NeverChangesMain()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();

        // Not main yet: the source is the main schedule.
        var before = await MainFingerprintAsync();
        await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-prune"));
        (await MainFingerprintAsync()).Should().Be(before, "no version, no place of the plot changed");

        // Own schedule made main: a later take still leaves every version and every place exactly as they are (an own work SAVE would move the plot to a new version).
        await OkAsync(SaveAsync(Owner, plot, cycle, ByHand("mine-1", "माझी खुरपणी")));
        await OkAsync(MakeMainAsync(Owner, plot, cycle));
        var main = await MainFingerprintAsync();
        await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-water"));
        (await MainFingerprintAsync()).Should().Be(main, "taking never freezes a version and never moves the plot");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE crop_cycle_id = @c AND state = 0", ("c", cycle))).Should().Be(3);
    }

    // ---- the source ------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Take_WithdrawnSource_Refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();
        (await CheckAsync(PlatformOwner, source, "Withdrawn", note: "the source was revised")).Status.Should().Be(HttpStatusCode.OK);

        var refused = await TakeAsync(Owner, plot, cycle, source, "t-prune");

        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be(Invalid);
        refused.ErrorMessage.Should().Contain("TakeSourceWithdrawn");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins")).Should().Be(0);
    }

    [Fact]
    public async Task Take_NotFollowedUnknownTaskOrKeyInUse_Refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();
        var other = await ImportAndCheckAsync("द्राक्ष: दुसरे संदर्भ"); // checked, but this plot does not follow it

        (await TakeAsync(Owner, plot, cycle, other, "t-prune")).ErrorMessage.Should().Contain("TakeSourceNotFollowed");
        (await TakeAsync(Owner, plot, cycle, source, "no-such-key")).ErrorMessage.Should().Contain("TakeTaskUnknown");
        (await TakeAsync(Owner, plot, cycle, source, "t-spray", dose: "९ ग्रॅम")).ErrorMessage.Should().Contain("TakeDoseUnknown");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(0);

        // A work the farmer wrote by hand under the same key is never overwritten.
        await OkAsync(SaveAsync(Owner, plot, cycle, ByHand("t-prune", "माझी छाटणी")));
        var inUse = await TakeAsync(Owner, plot, cycle, source, "t-prune");
        inUse.Status.Should().Be("failed");
        inUse.ErrorMessage.Should().Contain("TakeKeyInUse");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE name = 'माझी छाटणी'")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins")).Should().Be(0);
    }

    [Fact]
    public async Task Take_PicksOneDose_AndKeepsIt()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();

        await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-spray", dose: DoseB));

        var item = OwnScheduleItem.IdFor(cycle, "t-spray");
        (await FingerprintAsync("SELECT content->>'dose' FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).Should().Be(DoseB);
        (await FingerprintAsync("SELECT chosen_dose FROM ssf.own_schedule_item_origins WHERE item_id = @i", ("i", item))).Should().Be(DoseB);
        (await FingerprintAsync("SELECT content->>'preHarvestDays' FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).Should().Be("30", "the safety gap is never shortened");
    }

    // ---- the origin never changes --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Origin_SurvivesEditMoveWithdrawalAndNextSeason()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();
        await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-prune"));
        var item = OwnScheduleItem.IdFor(cycle, "t-prune");
        var origin = await OriginRowAsync(item);
        origin.Should().NotBeEmpty();
        var originText = "take:" + source.ToString("N");

        // An edit (that even names another origin) keeps both the text and the row.
        await OkAsync(SaveAsync(Owner, plot, cycle, ByHand("t-prune", "माझी छाटणी, बदललेली", origin: "dusre:hack")));
        (await FingerprintAsync("SELECT origin FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).Should().Be(originText);
        (await OriginRowAsync(item)).Should().Be(origin);

        // A move: the plot's own schedule becomes main, then changes (a new version each time).
        await OkAsync(MakeMainAsync(Owner, plot, cycle));
        await OkAsync(SaveAsync(Owner, plot, cycle, ByHand("mine-2", "आणखी")));
        (await OriginRowAsync(item)).Should().Be(origin);
        (await FingerprintAsync("SELECT origin FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).Should().Be(originText);

        // The next season of the same farm takes the same work again: its own copy and its own origin; the first is untouched.
        var (plot2, cycle2) = await SeedSeasonStartingAsync("grape", TodayIst().AddDays(-2));
        await PushAdoptAsync(Owner, plot2, cycle2, source);
        await OkAsync(TakeAsync(Owner, plot2, cycle2, source, "t-prune"));
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins")).Should().Be(2);
        (await OriginRowAsync(item)).Should().Be(origin);

        // The source is withdrawn: nothing more is taken from it, and the copies and their origins stay.
        (await CheckAsync(PlatformOwner, source, "Withdrawn", note: "the source was revised")).Status.Should().Be(HttpStatusCode.OK);
        (await OriginRowAsync(item)).Should().Be(origin);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE origin = @o AND state = 0", ("o", originText))).Should().Be(2);
        (await TakeAsync(Owner, plot, cycle, source, "t-water")).ErrorMessage.Should().Contain("TakeSourceWithdrawn");
    }

    [Fact]
    public async Task Retake_FromNewerVersion_AppendsOrigin_CurrentIsNewest()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, v1) = await FollowingAsync();
        var v2 = await ImportAndCheckAsync("द्राक्ष: नवी आवृत्ती", pruneName: "फळछाटणी (नवी आवृत्ती)");
        await PushAdoptAsync(Owner, plot, cycle, v2);
        var item = OwnScheduleItem.IdFor(cycle, "t-prune");

        await OkAsync(TakeAsync(Owner, plot, cycle, v1, "t-prune"));
        var first = await OriginRowAsync(item);
        await OkAsync(RemoveAsync(Owner, plot, cycle, "t-prune"));
        await OkAsync(TakeAsync(Owner, plot, cycle, v2, "t-prune"));

        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins WHERE item_id = @i", ("i", item))).Should().Be(2, "one row per take act");
        (await OriginRowAsync(item)).Should().Be(first, "the first take's row never changes");
        (await FingerprintAsync("SELECT source_version_id FROM ssf.own_schedule_item_origins WHERE item_id = @i ORDER BY sequence DESC LIMIT 1", ("i", item))).Should().Be(v2.ToString(), "the current origin is the latest row");
        (await FingerprintAsync("SELECT source_version_id FROM ssf.own_schedule_item_origins WHERE item_id = @i AND sequence = 1", ("i", item))).Should().Be(v1.ToString());
        (await FingerprintAsync("SELECT name FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).Should().Be("फळछाटणी (नवी आवृत्ती)", "the copy holds version 2's words");
        (await FingerprintAsync("SELECT origin FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).Should().Be("take:" + v2.ToString("N"), "the origin text on the work names the origin it holds now");

        // A second tap while it is active appends nothing.
        await OkAsync(TakeAsync(Owner, plot, cycle, v2, "t-prune"));
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins WHERE item_id = @i", ("i", item))).Should().Be(2);
    }

    [Fact]
    public async Task Take_UncheckedReference_Refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();
        // The check was sent back after the plot followed it: neither Checked nor Withdrawn.
        (await CheckAsync(PlatformOwner, source, "Returned", note: "sent back")).Status.Should().Be(HttpStatusCode.OK);

        var refused = await TakeAsync(Owner, plot, cycle, source, "t-prune");

        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be(Invalid);
        refused.ErrorMessage.Should().Contain("TakeSourceNotChecked");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins")).Should().Be(0);
    }

    [Fact]
    public async Task TakeBack_RemovesItem_KeepsOriginHistory()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();
        await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-prune"));
        var item = OwnScheduleItem.IdFor(cycle, "t-prune");
        var origin = await OriginRowAsync(item);

        await OkAsync(RemoveAsync(Owner, plot, cycle, "t-prune"));

        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE id = @i AND state = 1", ("i", item))).Should().Be(1, "taking back removes the work from the own schedule");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE item_id = @i", ("i", item))).Should().Be(2, "the take and the removal are both history");
        (await OriginRowAsync(item)).Should().Be(origin, "the origin history stays");

        // Taking it again puts it back; the first origin row is the origin (one row, never replaced).
        var again = await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-prune"));
        JsonSerializer.SerializeToElement(again.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web)).GetProperty("taken").GetBoolean().Should().BeTrue();
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE id = @i AND state = 0 AND revision = 3", ("i", item))).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins")).Should().Be(2, "every take that puts the work back appends one origin row; the first never changes");
        (await OriginRowAsync(item)).Should().Be(origin);
    }

    [Fact]
    public async Task OwnershipTransfer_ThenWithdrawal_KeepCopyAndOrigin()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();
        await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-prune"));
        var item = OwnScheduleItem.IdFor(cycle, "t-prune");
        var origin = await OriginRowAsync(item);

        // No door transfers a farm today (F223): this simulates one as superuser (the new owner also gets his PrimaryOwner seat).
        await ExecOnSuperuserAsync("UPDATE ssf.farms SET owner_user_id = @ownerB WHERE \"Id\" = @farmA", ("ownerB", OwnerB), ("farmA", FarmA));
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farm, @user, 'PrimaryOwner', NOW() - INTERVAL '30 days', NOW(), @account, 3, NULL, FALSE)
            """, ("farm", FarmA), ("user", OwnerB), ("account", AccountA));
        (await CheckAsync(PlatformOwner, source, "Withdrawn", note: "the source was revised")).Status.Should().Be(HttpStatusCode.OK);

        (await OriginRowAsync(item)).Should().Be(origin, "a transfer and a withdrawal change no origin");
        var (_, root) = await NewPhonePullAsync(OwnerB);
        var carried = ArrayOf(root, "ownScheduleItems").Single(i => i.GetProperty("id").GetGuid() == item);
        carried.GetProperty("state").GetString().Should().Be("active", "the copy is the farmer's: it stays");
        carried.GetProperty("origin").GetString().Should().Be("take:" + source.ToString("N"));
    }

    // ---- foreign farm, row security, privileges ------------------------------------------------------------------------------

    [Fact]
    public async Task ForeignFarm_Refused_AndOriginsAreAppendOnlyAndFarmKeyed()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA, FarmB);
        var (plot, cycle, source) = await FollowingAsync();

        // Farm B's owner names farm A: refused. Farm A's owner names farm B with his own plot: refused (he is no member of farm B).
        (await TakeAsync(OwnerB, plot, cycle, source, "t-prune")).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await TakeAsync(Owner, plot, cycle, source, "t-prune", farm: FarmB)).Status.Should().Be("failed");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins")).Should().Be(0);

        await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-prune"));
        var item = OwnScheduleItem.IdFor(cycle, "t-prune");

        // Row security as agrisync_app: farm B's scope sees none, farm A's sees its own; neither can change or remove one; a foreign or wrong-owner row is refused.
        (await AppCountAsync(FarmB, OwnerB, "SELECT count(*) FROM ssf.own_schedule_item_origins")).Should().Be(0);
        (await AppCountAsync(FarmA, Owner, "SELECT count(*) FROM ssf.own_schedule_item_origins")).Should().Be(1);
        (await AppTryAsync(FarmA, Owner, "UPDATE ssf.own_schedule_item_origins SET source_name = 'बदल'")).Should().Be("42501", "append-only by privilege");
        (await AppTryAsync(FarmA, Owner, "DELETE FROM ssf.own_schedule_item_origins")).Should().Be("42501");
        (await AppTryAsync(FarmA, Owner, "TRUNCATE ssf.own_schedule_item_origins")).Should().Be("42501");
        (await AppTryAsync(FarmB, OwnerB, InsertOrigin(FarmA, plot, cycle, OwnerB, "x1", Guid.NewGuid(), source))).Should().Be("42501", "farm B's scope cannot write a row naming farm A");
        (await AppTryAsync(FarmA, Owner, InsertOrigin(FarmA, plot, cycle, Mukadam, "x2", Guid.NewGuid(), source))).Should().Be("42501", "the owner column is the farm's owner");
        // The positive control: the same statement for farm A's owner under farm A's scope goes through (so each refusal above is the rule, not a typo).
        (await AppTryAsync(FarmA, Owner, InsertOrigin(FarmA, plot, cycle, Owner, "x3", Guid.NewGuid(), source))).Should().BeNull();
        (await OriginRowAsync(item)).Should().NotBeEmpty();
    }

    private static string InsertOrigin(Guid farm, Guid plot, Guid cycle, Guid owner, string key, Guid id, Guid source) => $"""
        INSERT INTO ssf.own_schedule_item_origins (id, item_id, sequence, farm_id, plot_id, crop_cycle_id, owner_user_id, task_key, source_version_id, source_name, source_version_number,
                                                   source_task_key, taken_by_user_id, taken_on, taken_at_utc)
        VALUES ('{id}'::uuid, '{Guid.NewGuid()}'::uuid, 1, '{farm}'::uuid, '{plot}'::uuid, '{cycle}'::uuid, '{owner}'::uuid, '{key}', '{source}'::uuid, 'चाचणी', 1, '{key}', '{owner}'::uuid, CURRENT_DATE, NOW())
        """;

    // ---- old phones --------------------------------------------------------------------------------------------------

    [Fact]
    public async Task OldPhone_PullHasNoNewKey_AndNewPhoneGetsTheTakenWork()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SwitchOnAsync(FarmA);
        var (plot, cycle, source) = await FollowingAsync();
        await OkAsync(TakeAsync(Owner, plot, cycle, source, "t-prune"));

        var (oldBody, _) = await PullAsync(Owner);
        oldBody.Should().NotContain("ownScheduleItem", "a phone that does not ask for the new format is sent exactly what it was sent before");
        oldBody.Should().NotContain("own_schedule_item_origins");

        var (_, root) = await NewPhonePullAsync(Owner);
        var item = ArrayOf(root, "ownScheduleItems").Single(i => i.GetProperty("taskKey").GetString() == "t-prune");
        item.GetProperty("origin").GetString().Should().Be("take:" + source.ToString("N"));
        item.GetProperty("task").GetProperty("name").GetString().Should().Be("फळछाटणी");
    }

    // ---- as the application role -------------------------------------------------------------------------------------------

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
