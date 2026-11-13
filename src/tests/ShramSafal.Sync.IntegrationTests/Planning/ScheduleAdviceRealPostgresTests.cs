// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-ADV Task 1, server half ("what each followed schedule asks for THIS work in
// THIS stage", read while he plans; founder D-74 note, D-87 = 1, D-83 = 1, D-24d; R10, R12, R28; P4, E4, MU-4).
//
// GET /shramsafal/farms/{farmId}/plots/{plotId}/schedule-advice?words=<his words>&date=<yyyy-MM-dd> | loose=<Week|Month|Anytime>
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host and route. The numbers are the stage panel's: each
// fact that names a count compares it with the stage-plan route's answer for the same plot and stage (DRY), and with the engine's
// own arithmetic on the days the schedule stores. Fake phone numbers only.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleAdviceRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private const string SprayWords = "फवारणी";

    private static string Day(DateOnly d) => d.ToString("yyyy-MM-dd");

    private Task PaidAsync() =>
        SetStandingAsync(AccountA, Owner, Active, DateTime.UtcNow.AddDays(-100), DateTime.UtcNow.AddDays(200));

    private Task<(HttpStatusCode Status, string Body)> AdviceAsync(
        Guid user, Guid farm, Guid plot, string? words, string? date = null, string? loose = null)
    {
        var query = new List<string>();
        if (words is not null)
        {
            query.Add("words=" + Uri.EscapeDataString(words));
        }

        if (date is not null)
        {
            query.Add("date=" + date);
        }

        if (loose is not null)
        {
            query.Add("loose=" + loose);
        }

        return SendJsonAsync(HttpMethod.Get,
            $"/shramsafal/farms/{farm}/plots/{plot}/schedule-advice" + (query.Count == 0 ? string.Empty : "?" + string.Join('&', query)),
            user, null);
    }

    private async Task<JsonElement> AdviceOkAsync(Guid user, Guid plot, string? words, string? date = null, string? loose = null)
    {
        var (status, body) = await AdviceAsync(user, FarmA, plot, words, date, loose);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body);
    }

    private static IReadOnlyList<JsonElement> Lines(JsonElement root) => root.GetProperty("lines").EnumerateArray().ToList();

    private static IReadOnlyList<JsonElement> Items(JsonElement line) => line.GetProperty("items").EnumerateArray().ToList();

    private async Task<JsonElement> StagePlanOkAsync(Guid user, Guid plot, string? forDate = null)
    {
        var (status, body) = await StagePlanAsync(user, FarmA, plot, forDate);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body);
    }

    private async Task<ScheduleTemplate> CheckedAsync(string name, IReadOnlyList<ImportedActivity> activities)
    {
        var row = await SeedStoredRowWithStagesAsync(name, UnequalStages, activities);
        (await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row))).Status.Should().Be(HttpStatusCode.OK);
        return row;
    }

    private static readonly ImportedActivity[] SprayEveryFiveDays =
    [
        new("pr", "Pruning", 0, 1, FrequencyMode.OneTime, 1),
        new("sp", "बुरशीनाशक फवारणी", 13, 40, FrequencyMode.EveryNDays, 5),   // days 13, 18, 23, 28, 33, 38 = 6 inside "Canopy Build"
        new("fs", "Foliar Spray", 41, 99, FrequencyMode.EveryNDays, 10),      // days 41, 51, ... , 91 = 6 inside "Berry Development"
        new("dr", "Drip Irrigation", 41, 99, FrequencyMode.PerWeek, 2),
    ];

    private static readonly ImportedActivity[] NoSprayInCanopy =
    [
        new("dr", "Drip Irrigation", 0, 99, FrequencyMode.EveryNDays, 2),
        new("sp", "Spray Late", 60, 99, FrequencyMode.EveryNDays, 10),         // a spray, but not in this stage
    ];

    /// <summary>The plan's plot: day 20, two followed schedules - the first asks the spray every 5 days, the second none in this stage.</summary>
    private async Task<(Guid Plot, Guid Cycle, ScheduleTemplate First, ScheduleTemplate Second)> TwoSchedulesAsync()
    {
        await PaidAsync();
        await SeedReviewSeatsAsync();
        var first = await CheckedAsync("Grapes - First Checked", SprayEveryFiveDays);
        var second = await CheckedAsync("Grapes - Second Checked", NoSprayInCanopy);
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        await PushAdoptAsync(Owner, plot, cycle, first.Id);
        await PushAdoptAsync(Owner, plot, cycle, second.Id);
        return (plot, cycle, first, second);
    }

    private async Task GrantAsync(Guid user, params FarmAuthority[] authorities) => await SetAuthoritiesAsync(FarmA, user, authorities);

    // ---- the plan's facts ---------------------------------------------------------------------------------------

    [Fact]
    public async Task Two_followed_schedules_one_asks_the_spray_every_5_days_the_other_has_none_in_the_stage()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, first, second) = await TwoSchedulesAsync();

        var advice = await AdviceOkAsync(Owner, plot, SprayWords);
        advice.GetProperty("needsSchedule").GetBoolean().Should().BeFalse();
        advice.GetProperty("notRecognised").GetBoolean().Should().BeFalse();
        advice.GetProperty("part").GetString().Should().Be("spray");
        advice.GetProperty("stage").GetProperty("name").GetString().Should().Be("Canopy Build");
        var lines = Lines(advice);
        lines.Should().HaveCount(2);

        lines[0].GetProperty("scheduleName").GetString().Should().Be("Grapes - First Checked");
        lines[0].GetProperty("slot").GetInt16().Should().Be(1);
        lines[0].GetProperty("origin").GetString().Should().Be("Outside");
        lines[0].GetProperty("nothingInStage").GetBoolean().Should().BeFalse();
        var spray = Items(lines[0]).Single();
        spray.GetProperty("title").GetString().Should().Be("बुरशीनाशक फवारणी");
        spray.GetProperty("frequencyMode").GetString().Should().Be("EveryNDays");
        spray.GetProperty("intervalDays").GetInt32().Should().Be(5);
        spray.GetProperty("timesInStage").GetInt32().Should().Be(6);

        lines[1].GetProperty("scheduleName").GetString().Should().Be("Grapes - Second Checked");
        lines[1].GetProperty("slot").GetInt16().Should().Be(2);
        lines[1].GetProperty("nothingInStage").GetBoolean().Should().BeTrue("it asks no spray in this stage (its spray is in a later one)");
        Items(lines[1]).Should().BeEmpty();
        _ = (first, second);
    }

    [Fact]
    public async Task Times_equal_the_stage_plan_for_the_same_plot_and_stage()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, cycle, _, _) = await TwoSchedulesAsync();
        // a third, in his own place last, so the order is the panel's too
        var own = await SeedStoredRowWithStagesAsync("Grapes - Mine", UnequalStages,
            [new ImportedActivity("m1", "बुरशीनाशक फवारणी", 18, 40, FrequencyMode.EveryNDays, 5)], TenantScope.Team, Owner);
        await SeedFollowedRowAsync(plot, cycle, own.Id, "Own", 0);

        var advice = await AdviceOkAsync(Owner, plot, SprayWords);
        var panel = await StagePlanOkAsync(Owner, plot);

        advice.GetProperty("stage").GetRawText().Should().Be(panel.GetProperty("stage").GetRawText(), "the same stage window as the panel");
        var panelSchedules = panel.GetProperty("schedules").EnumerateArray().ToList();
        var lines = Lines(advice);
        lines.Select(l => l.GetProperty("subscriptionId").GetGuid())
            .Should().Equal(panelSchedules.Select(s => s.GetProperty("subscriptionId").GetGuid()), "the panel's order: slots, his own last");
        lines.Select(l => l.GetProperty("scheduleName").GetString())
            .Should().Equal(panelSchedules.Select(s => s.GetProperty("name").GetString()));
        for (var i = 0; i < lines.Count; i++)
        {
            var panelSprays = panelSchedules[i].GetProperty("items").EnumerateArray()
                .Where(it => it.GetProperty("part").GetString() == "spray").ToList();
            Items(lines[i]).Select(it => it.GetRawText()).Should().Equal(
                panelSprays.Select(it => it.GetRawText()), "each item is the panel's item, byte for byte (the same count, the same days)");
        }

        Items(lines[0]).Single().GetProperty("timesInStage").GetInt32().Should().Be(6);
        lines[^1].GetProperty("origin").GetString().Should().Be("Own", "his own is last");
        lines[^1].GetProperty("check").ValueKind.Should().Be(JsonValueKind.Null, "D-82 = 3: his own has no check");
    }

    [Fact]
    public async Task A_planned_date_in_the_next_stage_gives_that_stages_items()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();
        var inBerry = Day(TodayIst().AddDays(25)); // day 45 of the main schedule: "Berry Development" (41-99)

        var advice = await AdviceOkAsync(Owner, plot, SprayWords, date: inBerry);
        advice.GetProperty("stage").GetProperty("name").GetString().Should().Be("Berry Development");
        var first = Lines(advice)[0];
        var spray = Items(first).Single();
        spray.GetProperty("title").GetString().Should().Be("Foliar Spray", "that stage's spray, not the Canopy Build one");
        var panel = await StagePlanOkAsync(Owner, plot, inBerry);
        spray.GetProperty("timesInStage").GetInt32().Should().Be(
            panel.GetProperty("schedules").EnumerateArray().First().GetProperty("items").EnumerateArray()
                .Single(i => i.GetProperty("title").GetString() == "Foliar Spray").GetProperty("timesInStage").GetInt32());
        // the second schedule's spray starts on its day 60, which is inside this stage too
        var second = Lines(advice)[1];
        second.GetProperty("nothingInStage").GetBoolean().Should().BeFalse();
        Items(second).Single().GetProperty("title").GetString().Should().Be("Spray Late");
    }

    [Theory]
    [InlineData("Week")]
    [InlineData("Month")]
    [InlineData("Anytime")]
    public async Task A_loose_when_means_todays_stage(string loose)
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();

        var advice = await AdviceOkAsync(Owner, plot, SprayWords, loose: loose);
        advice.GetProperty("stage").GetProperty("name").GetString().Should().Be("Canopy Build", "a loose when is today's stage (R28)");
        advice.GetProperty("stage").GetProperty("dayToday").GetInt32().Should().Be(20);
        Items(Lines(advice)[0]).Single().GetProperty("timesInStage").GetInt32().Should().Be(6);
    }

    [Fact]
    public async Task The_words_medicine_spraying_in_marathi_find_the_spray_items()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();

        var advice = await AdviceOkAsync(Owner, plot, "औषध मारायचं");
        advice.GetProperty("notRecognised").GetBoolean().Should().BeFalse();
        advice.GetProperty("part").GetString().Should().Be("spray");
        advice.GetProperty("operationKey").GetString().Should().NotBeNullOrEmpty();
        Items(Lines(advice)[0]).Select(i => i.GetProperty("title").GetString()).Should().Equal("बुरशीनाशक फवारणी");
    }

    [Fact]
    public async Task Words_that_are_not_recognised_say_so_and_carry_no_lines()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();

        foreach (var words in new[] { "xyzzy qwerty", "   ", "ळळळ" })
        {
            var advice = await AdviceOkAsync(Owner, plot, words);
            advice.GetProperty("notRecognised").GetBoolean().Should().BeTrue($"'{words}' names no work (R12)");
            Lines(advice).Should().BeEmpty("no guess is made");
            advice.GetProperty("part").ValueKind.Should().Be(JsonValueKind.Null);
            advice.GetProperty("operationKey").ValueKind.Should().Be(JsonValueKind.Null);
        }

        var none = await AdviceAsync(Owner, FarmA, plot, words: null);
        none.Status.Should().Be(HttpStatusCode.OK);
        Json(none.Body).GetProperty("notRecognised").GetBoolean().Should().BeTrue("no words at all is also not recognised, never a refusal");
    }

    [Fact]
    public async Task A_thin_samples_item_has_null_TimesInStage()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        var sample = await SeedThinRowAsync("Grapes - SCH-ADV sample", ("Foliar Spray", 15));
        await PushAdoptAsync(Owner, plot, cycle, sample);
        var uni = await CheckedInstitutionAsync();
        await PushAdoptAsync(Owner, plot, cycle, uni.Id);

        var advice = await AdviceOkAsync(Owner, plot, "Foliar spray");
        var lines = Lines(advice);
        var kept = lines.Single(l => l.GetProperty("scheduleName").GetString() == "Grapes - SCH-ADV sample");
        var item = Items(kept).Single();
        item.GetProperty("title").GetString().Should().Be("Foliar Spray");
        item.GetProperty("timesInStage").ValueKind.Should().Be(JsonValueKind.Null, "its days are not stored: words only, no number (P4)");
        item.GetProperty("frequencyMode").ValueKind.Should().Be(JsonValueKind.Null);
        kept.GetProperty("nothingInStage").GetBoolean().Should().BeFalse();
        Items(lines.Single(l => l.GetProperty("scheduleName").GetString() == "Grapes - University Schedule"))
            .Single().GetProperty("timesInStage").ValueKind.Should().Be(JsonValueKind.Number);
    }

    [Fact]
    public async Task In_the_trial_only_todays_stage_whatever_the_date()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetStandingAsync(AccountA, Owner, Trialing, DateTime.UtcNow.AddDays(10), DateTime.UtcNow.AddDays(10));
        await SeedReviewSeatsAsync();
        var first = await CheckedAsync("Grapes - First Checked", SprayEveryFiveDays);
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        await PushAdoptAsync(Owner, plot, cycle, first.Id);
        var inBerry = Day(TodayIst().AddDays(25));

        var trial = await AdviceOkAsync(Owner, plot, SprayWords, date: inBerry);
        trial.GetProperty("stage").GetProperty("name").GetString().Should().Be("Canopy Build", "in the trial the stage is today's whatever the date (R10)");

        await PaidAsync();
        var paid = await AdviceOkAsync(Owner, plot, SprayWords, date: inBerry);
        paid.GetProperty("stage").GetProperty("name").GetString().Should().Be("Berry Development", "control: after the trial the date is honoured");
    }

    [Fact]
    public async Task NeedsSchedule_says_so_and_returns_no_lines()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        await CheckedInstitutionAsync();
        var (plot, _) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));

        var advice = await AdviceOkAsync(Owner, plot, SprayWords);
        advice.GetProperty("needsSchedule").GetBoolean().Should().BeTrue("D-83 = 1: he must choose first; the read itself never refuses");
        Lines(advice).Should().BeEmpty();
        advice.GetProperty("stage").ValueKind.Should().Be(JsonValueKind.Null);
        advice.GetProperty("notRecognised").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task A_date_that_is_not_a_date_or_a_loose_that_is_not_known_is_refused_with_400()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();

        (await AdviceAsync(Owner, FarmA, plot, SprayWords, date: "2026-02-30")).Status.Should().Be(HttpStatusCode.BadRequest);
        (await AdviceAsync(Owner, FarmA, plot, SprayWords, date: "tomorrow")).Status.Should().Be(HttpStatusCode.BadRequest);
        (await AdviceAsync(Owner, FarmA, plot, SprayWords, loose: "Someday")).Status.Should().Be(HttpStatusCode.BadRequest);
        (await AdviceAsync(Owner, FarmA, plot, SprayWords, date: Day(TodayIst()))).Status.Should().Be(HttpStatusCode.OK, "a real date is accepted");
        (await AdviceAsync(Owner, FarmA, plot, SprayWords, loose: "week")).Status.Should().Be(HttpStatusCode.OK, "the name is read in any case, as the planned-work enum is");
    }

    // ---- who may read ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task A_worker_without_plan_rights_gets_403_and_learns_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();

        (await AdviceAsync(Owner, FarmA, plot, SprayWords)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: the owner reads it");
        var worker = await AdviceAsync(Worker, FarmA, plot, SprayWords);
        worker.Status.Should().Be(HttpStatusCode.Forbidden);
        worker.Body.Should().BeEmpty("a refusal carries no body at all: nothing of the schedules, the stage or the plot leaks");
    }

    [Fact]
    public async Task A_worker_holding_plan_work_is_still_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();
        await GrantAsync(Worker, FarmAuthority.PlanWork, FarmAuthority.AssignWork);

        var worker = await AdviceAsync(Worker, FarmA, plot, SprayWords);
        worker.Status.Should().Be(HttpStatusCode.Forbidden, "a कामगार reads his own records only: no overview, so no advice, whatever is stored on his seat");
        worker.Body.Should().BeEmpty();
    }

    [Fact]
    public async Task A_mukadam_or_co_owner_without_PlanWork_or_AssignWork_gets_403_a_holder_gets_200()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();

        // the precondition: both read the farm's overview (the stage panel answers them) - so only the authority can refuse the advice
        (await StagePlanAsync(Mukadam, FarmA, plot)).Status.Should().Be(HttpStatusCode.OK);
        (await StagePlanAsync(CoOwner, FarmA, plot)).Status.Should().Be(HttpStatusCode.OK);

        var mukadam = await AdviceAsync(Mukadam, FarmA, plot, SprayWords);
        var coOwner = await AdviceAsync(CoOwner, FarmA, plot, SprayWords);
        mukadam.Status.Should().Be(HttpStatusCode.Forbidden);
        coOwner.Status.Should().Be(HttpStatusCode.Forbidden);
        mukadam.Body.Should().BeEmpty();
        coOwner.Body.Should().BeEmpty();

        await GrantAsync(Mukadam, FarmAuthority.PlanWork);
        await GrantAsync(CoOwner, FarmAuthority.AssignWork);
        (await AdviceAsync(Mukadam, FarmA, plot, SprayWords)).Status.Should().Be(HttpStatusCode.OK, "a PlanWork holder");
        (await AdviceAsync(CoOwner, FarmA, plot, SprayWords)).Status.Should().Be(HttpStatusCode.OK, "an AssignWork holder");

        // an authority that is not one of the two opens nothing
        await GrantAsync(Mukadam, FarmAuthority.SeeMoney, FarmAuthority.SeeAllTasks, FarmAuthority.ScheduleTemplates, FarmAuthority.SeeCompare);
        (await AdviceAsync(Mukadam, FarmA, plot, SprayWords)).Status.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_paused_seat_is_refused_even_with_the_authority_stored()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();
        await GrantAsync(Paused, FarmAuthority.PlanWork, FarmAuthority.AssignWork);

        var paused = await AdviceAsync(Paused, FarmA, plot, SprayWords);
        paused.Status.Should().Be(HttpStatusCode.Forbidden);
        paused.Body.Should().BeEmpty();
    }

    [Fact]
    public async Task A_seat_without_the_authority_gets_the_same_empty_403_for_a_real_plot_a_made_up_plot_and_another_farms_plot()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();

        foreach (var seat in new[] { Mukadam, CoOwner })
        {
            // The precondition: this seat reads the overview, so the stage panel DOES tell a real plot from a made-up one (200 / 404).
            // Were the authority asked AFTER the stage plan, the advice would answer the same way: an oracle for "this plot exists".
            (await StagePlanAsync(seat, FarmA, plot)).Status.Should().Be(HttpStatusCode.OK);
            (await StagePlanAsync(seat, FarmA, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.NotFound);

            var real = await AdviceAsync(seat, FarmA, plot, SprayWords);
            var madeUp = await AdviceAsync(seat, FarmA, Guid.NewGuid(), SprayWords);
            var elsewhere = await AdviceAsync(seat, FarmA, PlotB, SprayWords);
            real.Status.Should().Be(HttpStatusCode.Forbidden);
            madeUp.Status.Should().Be(real.Status, "the authority is asked BEFORE the plot: a real plot and a made-up one answer alike");
            elsewhere.Status.Should().Be(real.Status, "and so does another farm's plot");
            real.Body.Should().BeEmpty();
            madeUp.Body.Should().Be(real.Body);
            elsewhere.Body.Should().Be(real.Body);
        }
    }

    [Fact]
    public async Task A_PlanWork_holder_who_reads_only_his_own_records_is_refused_on_purpose()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();
        await GrantAsync(Mukadam, FarmAuthority.PlanWork);
        (await AdviceAsync(Mukadam, FarmA, plot, SprayWords)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: with the authority and every plot he reads it");

        // The rule (CTO ruling, SCH-ADV fix 1): advice is part of the stage-plan overview right. A seat on "own work only" has no overview, so a
        // PlanWork holder there is refused (fail closed) and the phone draws nothing - whatever the authority says.
        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner, new { plotScope = "OwnWork" }))
        {
            set.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var refused = await AdviceAsync(Mukadam, FarmA, plot, SprayWords);
        refused.Status.Should().Be(HttpStatusCode.Forbidden);
        refused.Body.Should().BeEmpty();
        (await StagePlanAsync(Mukadam, FarmA, plot)).Status.Should().Be(HttpStatusCode.Forbidden, "the same inner wall: his own-records seat has no stage-plan overview either");
    }

    [Theory]
    [InlineData(2, "waiting for approval")]
    [InlineData(5, "removed (revoked)")]
    [InlineData(6, "exited")]
    public async Task A_seat_that_is_not_active_is_refused_with_an_empty_403_even_with_both_authorities_stored(int status, string why)
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();
        await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET permissions = 72 WHERE user_id = @u AND farm_id = @f", ("u", Mukadam), ("f", FarmA));
        (await AdviceAsync(Mukadam, FarmA, plot, SprayWords)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: while Active with PlanWork + AssignWork stored he reads it");

        await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET status = @s WHERE user_id = @u AND farm_id = @f", ("s", status), ("u", Mukadam), ("f", FarmA));
        var refused = await AdviceAsync(Mukadam, FarmA, plot, SprayWords);
        refused.Status.Should().Be(HttpStatusCode.Forbidden, why);
        refused.Body.Should().BeEmpty(why);
    }

    [Fact]
    public async Task An_active_seat_whose_PlanWork_and_AssignWork_have_ended_is_refused_with_an_empty_403()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();
        // PlanWork = bit 8, AssignWork = bit 64: stored with an end in the FUTURE first (held), then in the PAST (ended).
        const string setEnd = """
            UPDATE ssf.farm_memberships
            SET permissions = 72,
                authority_expires_at = jsonb_build_object(
                    '8', to_char(@end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                    '64', to_char(@end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
            WHERE user_id = @u AND farm_id = @f
            """;
        await ExecOnSuperuserAsync(setEnd, ("end", DateTime.UtcNow.AddDays(5)), ("u", Mukadam), ("f", FarmA));
        (await AdviceAsync(Mukadam, FarmA, plot, SprayWords)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: an authority that has not ended yet is held");

        await ExecOnSuperuserAsync(setEnd, ("end", DateTime.UtcNow.AddMinutes(-5)), ("u", Mukadam), ("f", FarmA));
        var refused = await AdviceAsync(Mukadam, FarmA, plot, SprayWords);
        refused.Status.Should().Be(HttpStatusCode.Forbidden);
        refused.Body.Should().BeEmpty();
    }

    [Fact]
    public async Task A_chosen_plots_seat_asking_another_plot_gets_404_like_a_made_up_id()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (mine, _, _, _) = await TwoSchedulesAsync();
        var (other, _) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-5));
        await GrantAsync(Mukadam, FarmAuthority.PlanWork);
        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { mine } }))
        {
            set.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        (await AdviceAsync(Mukadam, FarmA, mine, SprayWords)).Status.Should().Be(HttpStatusCode.OK, "his own plot");
        var notMine = await AdviceAsync(Mukadam, FarmA, other, SprayWords);
        var madeUpId = Guid.NewGuid();
        var madeUp = await AdviceAsync(Mukadam, FarmA, madeUpId, SprayWords);
        notMine.Status.Should().Be(HttpStatusCode.NotFound);
        madeUp.Status.Should().Be(HttpStatusCode.NotFound);
        ErrorCode(notMine.Body).Should().Be(ErrorCode(madeUp.Body));
        notMine.Body.Replace(other.ToString(), "X").Should().Be(madeUp.Body.Replace(madeUpId.ToString(), "X"), "E4: same body, ids aside");
    }

    [Fact]
    public async Task A_plot_that_is_not_on_this_farm_gets_404_like_a_made_up_id()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();

        var foreign = await AdviceAsync(Owner, FarmA, PlotB, SprayWords);
        var madeUpId = Guid.NewGuid();
        var madeUp = await AdviceAsync(Owner, FarmA, madeUpId, SprayWords);
        (await AdviceAsync(Owner, FarmA, plot, SprayWords)).Status.Should().Be(HttpStatusCode.OK, "not vacuous");
        foreign.Status.Should().Be(HttpStatusCode.NotFound);
        madeUp.Status.Should().Be(HttpStatusCode.NotFound);
        foreign.Body.Replace(PlotB.ToString(), "X").Should().Be(madeUp.Body.Replace(madeUpId.ToString(), "X"));
    }

    [Fact]
    public async Task Another_farms_holder_is_refused_and_the_body_equals_a_made_up_farms()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();

        var unseenFarm = await AdviceAsync(OwnerB, FarmA, plot, SprayWords);
        var madeUpFarm = Guid.NewGuid();
        var madeUpPlot = Guid.NewGuid();
        var noFarm = await AdviceAsync(OwnerB, madeUpFarm, madeUpPlot, SprayWords);
        unseenFarm.Status.Should().NotBe(HttpStatusCode.OK);
        unseenFarm.Status.Should().Be(noFarm.Status, "E4: a farm he cannot open answers exactly like one that does not exist");
        ErrorCode(unseenFarm.Body).Should().Be(ErrorCode(noFarm.Body));
        unseenFarm.Body.Replace(FarmA.ToString(), "F").Replace(plot.ToString(), "P")
            .Should().Be(noFarm.Body.Replace(madeUpFarm.ToString(), "F").Replace(madeUpPlot.ToString(), "P"));
        unseenFarm.Body.Should().NotContain("First Checked").And.NotContain(plot.ToString());
    }

    // ---- what the answer holds --------------------------------------------------------------------------------------

    [Fact]
    public async Task The_answer_holds_no_quantity_and_no_dose_and_no_record()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();
        // PlotA holds records that carry a quantity and a cost; the answer is about another plot, but the proof must not lean on that
        (await CountAsync("SELECT count(*) FROM ssf.daily_logs WHERE plot_id = @p", ("p", PlotA))).Should().BeGreaterThan(0);

        var advice = await AdviceOkAsync(Owner, plot, SprayWords);
        Lines(advice).Should().NotBeEmpty("the answer is live, not an empty shell");
        var names = new SortedSet<string>(StringComparer.Ordinal);
        void Walk(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                    foreach (var p in e.EnumerateObject())
                    {
                        names.Add(p.Name);
                        Walk(p.Value);
                    }

                    break;
                case JsonValueKind.Array:
                    foreach (var child in e.EnumerateArray())
                    {
                        Walk(child);
                    }

                    break;
            }
        }

        Walk(advice);
        names.Should().BeEquivalentTo(new[]
        {
            "serverTimeUtc", "needsSchedule", "notRecognised", "part", "operationKey", "stage", "name", "startDay", "endDay", "dayToday", "lines",
            "subscriptionId", "scheduleName", "slot", "origin", "check", "state", "checkerDisplayName", "checkedAtUtc", "note", "items", "nothingInStage",
            "activityId", "title", "frequencyMode", "intervalDays", "days", "timesInStage", "afterTitle",
        }, "exactly these fields: schedules hold no quantity and no dose (P4); the answer reads schedules only, never a record");
        names.Should().NotContain(n => new[] { "quantity", "dose", "dosage", "amount", "cost", "price", "qty", "litre", "liter", "kg", "rate", "done", "log" }
            .Any(bad => n.Contains(bad, StringComparison.OrdinalIgnoreCase)));
    }

    [Fact]
    public async Task The_read_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot, _, _, _) = await TwoSchedulesAsync();
        (await AdviceOkAsync(Owner, plot, SprayWords)).GetProperty("lines").GetArrayLength().Should().Be(2); // warm up the first-time paths

        var before = await RowCountsAsync();
        await AdviceOkAsync(Owner, plot, SprayWords);
        await AdviceOkAsync(Owner, plot, "औषध मारायचं", date: Day(TodayIst().AddDays(25)));
        await AdviceOkAsync(Owner, plot, "xyzzy");
        await AdviceAsync(Worker, FarmA, plot, SprayWords);
        await AdviceAsync(OwnerB, FarmA, plot, SprayWords);
        var after = await RowCountsAsync();

        before.Count.Should().BeGreaterThan(20, "the probe reads every table of the schedule");
        after.Should().Equal(before, "a read changes no row of any table (no audit row, no outbox row, no subscription, nothing)");
    }

    private async Task<Dictionary<string, long>> RowCountsAsync()
    {
        await using var db = new Npgsql.NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT table_schema || '.' || table_name,
                   (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
            FROM information_schema.tables
            WHERE table_schema IN ('ssf', 'accounts') AND table_type = 'BASE TABLE'
            ORDER BY 1
            """;
        var rows = new Dictionary<string, long>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows[reader.GetString(0)] = reader.GetInt64(1);
        }

        return rows;
    }

    [Fact]
    public void The_route_table_carries_the_route()
    {
        var path = Path.Combine(RequiresPostgresConnection.RepoRoot(), "sync-contract", "routes", "server-rest-routes.txt");
        File.ReadAllLines(path).Select(l => l.Trim())
            .Should().Contain("GET /shramsafal/farms/{farmId:guid}/plots/{plotId:guid}/schedule-advice");
    }
}
