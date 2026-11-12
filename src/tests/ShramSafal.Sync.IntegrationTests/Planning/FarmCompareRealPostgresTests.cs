// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D2 Tasks 2 and 4 (server half): "तुलना worked out on the server"
// (founder D-68, D-83 = 1, D-86 note / R33, R34, R12, R10, R28; CMP-D1 "तुलना पाहणे"; Review Focus 11-15).
//
// GET /shramsafal/farms/{farmId}/compare: per plot, what every schedule the plot follows asked, did, left, was told "not done" and was
// given MORE than asked, STAGE by STAGE, from the one engine (CMP-E) - and the plot's own work. This is an AUTHORITY read: it needs
// "तुलना पाहणे" (or the primary owner), a Worker can never hold it, and the two old season routes are gated by the same rule.
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host and routes. A record reaches the plot through the real
// push door; the owner hides one through set_record_audience. Fake phone numbers only. Every negative asserts that NOTHING leaked.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class FarmCompareRealPostgresTests(ITestOutputHelper output) : FarmCompareLane(output)
{
    private const string SecretNote = "गुप्त-टीप-९९";

    /// <summary>A plot on its day <paramref name="dayToday"/> following the checked University schedule (stages 0-12, 13-40, 41-99).</summary>
    private async Task<(Guid Plot, Guid Cycle, ScheduleTemplate Uni)> UniversityPlotAsync(int dayToday = 20)
    {
        var uni = await CheckedInstitutionAsync();
        var (plot, cycle, _) = await FollowingAsync(uni.Id, dayToday);
        return (plot, cycle, uni);
    }

    private static DateOnly DayOf(int dayToday, int day) => TodayIst().AddDays(-dayToday + day);

    // ---- who may read (the heart: every compare read is an authority read) --------------------------------------

    [Fact]
    public async Task A_worker_gets_403_and_learns_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync();
        var log = await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी");

        (await CompareAsync(Owner, FarmA)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: the owner reads it");
        var worker = await CompareAsync(Worker, FarmA);
        worker.Status.Should().Be(HttpStatusCode.Forbidden);
        worker.Body.Should().NotContain(plot.ToString()).And.NotContain(log.ToString()).And.NotContain("बुरशीनाशक");

        // Even a Worker whose stored row carries the bit (a hand-written row, an old build) holds nothing (CanBeHeldBy).
        await ExecOnSuperuserAsync(
            "UPDATE ssf.farm_memberships SET permissions = 4096 WHERE farm_id = @f AND user_id = @u", ("f", FarmA), ("u", Worker));
        (await CompareAsync(Worker, FarmA)).Status.Should().Be(HttpStatusCode.Forbidden, "a Worker can never hold तुलना पाहणे");
    }

    [Fact]
    public async Task A_mukadam_without_SeeCompare_gets_403_and_with_it_gets_200()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync();
        var log = await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी");

        var without = await CompareAsync(Mukadam, FarmA);
        without.Status.Should().Be(HttpStatusCode.Forbidden);
        without.Body.Should().NotContain(plot.ToString()).And.NotContain(log.ToString());

        await HoldsSeeCompareAsync(Mukadam);
        (await CompareAsync(Mukadam, FarmA)).Status.Should().Be(HttpStatusCode.OK, "the owner's switch opens it");
    }

    [Fact]
    public async Task A_co_owner_without_SeeCompare_gets_403()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, _, _) = await UniversityPlotAsync();

        var without = await CompareAsync(CoOwner, FarmA);
        without.Status.Should().Be(HttpStatusCode.Forbidden, "a सहमालक is not the primary owner: he holds only what is stored");
        without.Body.Should().NotContain(plot.ToString());

        await HoldsSeeCompareAsync(CoOwner);
        (await CompareAsync(CoOwner, FarmA)).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_paused_seat_holding_the_bit_gets_403()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        await UniversityPlotAsync();
        await ExecOnSuperuserAsync(
            "UPDATE ssf.farm_memberships SET permissions = 4096 WHERE farm_id = @f AND user_id = @u", ("f", FarmA), ("u", Paused));

        (await CompareAsync(Paused, FarmA)).Status.Should().Be(HttpStatusCode.Forbidden, "a paused seat reads nothing of the farm");
    }

    [Fact]
    public async Task Another_farms_holder_gets_403_and_it_answers_like_a_farm_that_does_not_exist()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync();
        var log = await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी");

        // Farm B's primary owner passes the rule on HIS farm and on no other.
        (await CompareAsync(OwnerB, FarmB)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: he reads his own farm");
        var stranger = await CompareAsync(OwnerB, FarmA);
        stranger.Status.Should().Be(HttpStatusCode.Forbidden);
        stranger.Body.Should().NotContain(plot.ToString()).And.NotContain(log.ToString()).And.NotContain(FarmA.ToString());

        var madeUp = Guid.NewGuid();
        var nowhere = await CompareAsync(OwnerB, madeUp);
        nowhere.Status.Should().Be(stranger.Status, "E4: a farm he is not on answers exactly like one that does not exist");
        stranger.Body.Replace(FarmA.ToString(), "F").Should().Be(nowhere.Body.Replace(madeUp.ToString(), "F"));
    }

    [Fact]
    public async Task A_chosen_plots_seat_gets_only_his_plots()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (mine, _, uni) = await UniversityPlotAsync();
        var (other, otherCycle, _) = await FollowingAsync(uni.Id, 5);
        await RecordAsync(Owner, other, otherCycle, DayOf(5, 2), "बुरशीनाशक फवारणी");
        await HoldsSeeCompareAsync(Mukadam);
        using (var set = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { mine } }))
        {
            set.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var all = await CompareOkAsync(Owner, FarmA);
        all.GetProperty("plots").EnumerateArray().Select(p => p.GetProperty("plotId").GetGuid()).Should().Contain([mine, other],
            "the precondition: the owner reads both");

        var (status, body) = await CompareAsync(Mukadam, FarmA);
        status.Should().Be(HttpStatusCode.OK, body);
        Json(body).GetProperty("plots").EnumerateArray().Select(p => p.GetProperty("plotId").GetGuid()).Should().Equal([mine]);
        body.Should().NotContain(other.ToString()).And.NotContain(otherCycle.ToString());
    }

    // ---- the D-68 case -------------------------------------------------------------------------------------------

    [Fact]
    public async Task The_D68_case_a_hidden_spray_counts_done_and_nothing_of_it_is_returned()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync();
        var hidden = await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी", notes: SecretNote, hide: true);
        await HoldsSeeCompareAsync(CoOwner);

        var owner = await CompareOkAsync(Owner, FarmA);
        var (status, body) = await CompareAsync(CoOwner, FarmA);
        status.Should().Be(HttpStatusCode.OK, body);
        var co = Json(body);

        // The precondition: the owner's record IS hidden from the co-owner (he is told no record of it).
        var spray = ItemsOf(CountsOf(PlotOf(co, plot), 0, 1)).Single(i => i.GetProperty("title").GetString() == "बुरशीनाशक फवारणी");
        spray.GetProperty("asked").GetInt32().Should().Be(4, "18, 25, 32, 39 fall in the stage");
        spray.GetProperty("done").GetInt32().Should().Be(1, "a hidden record is a done mark for every reader (D-68)");
        spray.GetProperty("notYet").GetInt32().Should().Be(3);
        CountsOf(PlotOf(co, plot), 0, 1).GetProperty("done").GetInt32().Should().Be(1);

        // ... and nothing of it: not its id, not its note, not a list entry of any kind.
        body.Should().NotContain(hidden.ToString()).And.NotContain(SecretNote);
        PlotOf(co, plot).GetProperty("ownWork").GetArrayLength().Should().Be(0);
        PlotOf(co, plot).GetProperty("notRecognised").GetArrayLength().Should().Be(0);

        // Owner and co-owner get identical counts.
        WithoutClock(co).Should().Be(WithoutClock(owner));
        PlotOf(owner, plot).GetProperty("schedules").GetRawText().Should().Be(PlotOf(co, plot).GetProperty("schedules").GetRawText());
    }

    // ---- the read's facts ----------------------------------------------------------------------------------------

    [Fact]
    public async Task Trial_compare_read_counts_only_todays_stage()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetStandingAsync(AccountA, Owner, Trialing, DateTime.UtcNow.AddDays(10), DateTime.UtcNow.AddDays(10));
        var (plot, cycle, _) = await UniversityPlotAsync();
        await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी");

        var trial = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        trial.GetProperty("inTrial").GetBoolean().Should().BeTrue();
        trial.GetProperty("stages").EnumerateArray().Select(s => s.GetProperty("state").GetString())
            .Should().Equal("passed", "current", "ahead");
        CountsOf(trial, 0, 0).ValueKind.Should().Be(JsonValueKind.Null, "in the trial a passed stage carries no numbers (R10)");
        CountsOf(trial, 0, 2).ValueKind.Should().Be(JsonValueKind.Null);
        CountsOf(trial, 0, 1).GetProperty("asked").GetInt32().Should().Be(4, "today's stage is counted");
        CountsOf(trial, 0, 1).GetProperty("done").GetInt32().Should().Be(1);

        // Control: after the trial the same passed stage IS counted.
        await PaidAccountAsync();
        var paid = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        paid.GetProperty("inTrial").GetBoolean().Should().BeFalse();
        CountsOf(paid, 0, 0).ValueKind.Should().Be(JsonValueKind.Object, "the control: a passed stage is counted after the trial");
    }

    [Fact]
    public async Task Compare_expected_for_a_passed_stage_equals_the_stage_plan_count()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync(20);
        var second = await CheckedScheduleAsync("Grapes - Second Compare",
            CompareStages,
            [new ImportedActivity("a", "ठिबक सिंचन", 0, 12, FrequencyMode.EveryNDays, 3), new ImportedActivity("b", "खुरपणी", 5, 5, FrequencyMode.OneTime, 1)]);
        await PushAdoptAsync(Owner, plot, cycle, second.Id);

        // The stage plan asked for a day inside the main schedule's PASSED stage "Post Pruning" (days 0-12).
        var (planStatus, planBody) = await StagePlanAsync(Owner, FarmA, plot, Day(DayOf(20, 5)));
        planStatus.Should().Be(HttpStatusCode.OK, planBody);
        var plan = Json(planBody);
        plan.GetProperty("stage").GetProperty("name").GetString().Should().Be("Post Pruning");

        var compare = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        compare.GetProperty("stages").EnumerateArray().First().GetProperty("state").GetString().Should().Be("passed");
        var planSchedules = plan.GetProperty("schedules").EnumerateArray().ToList();
        planSchedules.Should().HaveCount(2, "the precondition: two schedules are followed");
        for (var i = 0; i < planSchedules.Count; i++)
        {
            var planned = planSchedules[i].GetProperty("items").EnumerateArray().Sum(it => it.GetProperty("timesInStage").GetInt32());
            var schedule = SchedulesOf(compare).Single(s => s.GetProperty("templateId").GetGuid() == planSchedules[i].GetProperty("templateId").GetGuid());
            schedule.GetProperty("stages").EnumerateArray().First().GetProperty("asked").GetInt32().Should().Be(planned,
                $"{planSchedules[i].GetProperty("name").GetString()}: what compare expects of a passed stage is what the panel said it asked");
            planned.Should().BeGreaterThan(0);
        }
    }

    [Fact]
    public async Task After_the_trial_with_NeedsSchedule_the_read_returns_no_counts()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        await CheckedInstitutionAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        StateOf((await PullAsync(Owner)).Root, plot)!.Value.GetProperty("needsSchedule").GetBoolean().Should().BeTrue("the precondition, through the pull");

        var compare = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        SchedulesOf(compare).Should().BeEmpty("nothing is counted until he chooses (D-83 = 1)");
        compare.GetProperty("stages").GetArrayLength().Should().Be(0, "no stage is drawn without a followed schedule");
        compare.TryGetProperty("needsSchedule", out _).Should().BeFalse("तुलना never names the gate: the ask is the pull's planning state");
        compare.GetProperty("ownWork").GetArrayLength().Should().Be(0);
        compare.GetProperty("notRecognised").GetArrayLength().Should().Be(0);

        // The read never refuses a record: a record made now is accepted and kept (an ask is the phone's).
        var log = await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी");
        (await CountAsync("SELECT count(*) FROM ssf.daily_logs WHERE \"Id\" = @l", ("l", log))).Should().Be(1);
    }

    [Fact]
    public async Task An_ahead_stage_is_null()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, _, _) = await UniversityPlotAsync(20);

        var compare = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        compare.GetProperty("stages").EnumerateArray().Select(s => s.GetProperty("state").GetString()).Should().Equal("passed", "current", "ahead");
        CountsOf(compare, 0, 2).ValueKind.Should().Be(JsonValueKind.Null, "P4: an ahead stage carries no numbers");
        compare.GetProperty("stages").EnumerateArray().ElementAt(1).GetProperty("daysLeft").GetInt32().Should().Be(20);
        compare.GetProperty("stages").EnumerateArray().ElementAt(2).GetProperty("daysLeft").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task The_read_has_no_amber_no_partial_and_no_day_changed_field()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync(20);
        await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी");
        await RecordAsync(Owner, plot, cycle, DayOf(20, 19), "वेली बांधणी");
        await RecordAsync(Owner, plot, cycle, DayOf(20, 19), "zxqv wlmk");

        var root = await CompareOkAsync(Owner, FarmA);
        var names = NamesIn(root);
        PlotOf(root, plot).GetProperty("ownWork").GetArrayLength().Should().BeGreaterThan(0, "the precondition: the answer is live");
        names.Should().BeSubsetOf(new[]
        {
            "serverTimeUtc", "plots", "plotId", "cropCycleId", "inTrial", "day", "totalDays",
            "stages", "name", "state", "startDay", "endDay", "daysLeft",
            "schedules", "subscriptionId", "templateId", "slot", "origin", "isMain", "check", "checkerDisplayName", "checkedAtUtc", "note",
            "asked", "done", "notYet", "saidNotDone", "moreThanAsked", "parts", "part", "items", "activityId", "title",
            "order", "firstTitle", "thenTitle", "firstDay", "thenDay",
            "ownWork", "dailyLogId", "workKey", "stageName", "matchedWords", "reason",
            "notRecognised", "recogniserVersions", "vocabulary", "catalog",
        }, "exactly the planned fields; nothing the founder ruled out");
        names.Should().NotContain(n => n.Contains("amber", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("partial", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("differ", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("changed", StringComparison.OrdinalIgnoreCase)
                                       || n.Equals("ok", StringComparison.OrdinalIgnoreCase)
                                       || n.Equals("miss", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("quantity", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("amount", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("cost", StringComparison.OrdinalIgnoreCase)
                                       || n.Contains("dose", StringComparison.OrdinalIgnoreCase));
        root.GetProperty("recogniserVersions").GetProperty("vocabulary").GetString().Should().Be(WorkVocabulary.Version);
    }

    [Fact]
    public async Task A_record_the_recogniser_cannot_read_is_listed_as_not_recognised_and_never_counted()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync(20);
        var spray = await RecordAsync(Owner, plot, cycle, DayOf(20, 18), "बुरशीनाशक फवारणी");
        var unreadable = await RecordAsync(Owner, plot, cycle, DayOf(20, 19), "zxqv wlmk");

        var compare = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        var notRecognised = compare.GetProperty("notRecognised").EnumerateArray().Single();
        notRecognised.GetProperty("dailyLogId").GetGuid().Should().Be(unreadable);
        notRecognised.GetProperty("title").GetString().Should().Be("zxqv wlmk");
        compare.GetProperty("ownWork").EnumerateArray().Select(o => o.GetProperty("dailyLogId").GetGuid()).Should().NotContain(unreadable, "R12: never counted as anything else");
        CountsOf(compare, 0, 1).GetProperty("done").GetInt32().Should().Be(1, "only the spray is done");
        _ = spray;
    }

    // ---- own work and order notes --------------------------------------------------------------------------------

    [Fact]
    public async Task Own_work_from_a_record_the_reader_may_not_see_is_left_out()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync(20);
        var shown = await RecordAsync(Owner, plot, cycle, DayOf(20, 19), "वेली बांधणी");
        var hidden = await RecordAsync(Owner, plot, cycle, DayOf(20, 19), "वेली बांधणी", notes: SecretNote, hide: true);
        await HoldsSeeCompareAsync(CoOwner);

        var owner = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        owner.GetProperty("ownWork").EnumerateArray().Select(o => o.GetProperty("dailyLogId").GetGuid()).Should().BeEquivalentTo([shown, hidden],
            "the precondition: the holder sees both pieces of his own work");

        var (status, body) = await CompareAsync(CoOwner, FarmA);
        status.Should().Be(HttpStatusCode.OK, body);
        var co = PlotOf(Json(body), plot);
        co.GetProperty("ownWork").EnumerateArray().Select(o => o.GetProperty("dailyLogId").GetGuid()).Should().Equal([shown]);
        body.Should().NotContain(hidden.ToString()).And.NotContain(SecretNote);
        var item = co.GetProperty("ownWork").EnumerateArray().Single();
        item.GetProperty("title").GetString().Should().Be("वेली बांधणी");
        item.GetProperty("stageName").GetString().Should().Be("Canopy Build");
        item.GetProperty("day").GetInt32().Should().Be(19);
        item.GetProperty("workKey").GetString().Should().NotBeNullOrWhiteSpace();
        item.GetProperty("matchedWords").GetArrayLength().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task An_own_work_record_that_states_money_keeps_its_words_from_a_reader_who_does_not_hear_wages()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await UniversityPlotAsync(20);
        var money = await RecordAsync(Owner, plot, cycle, DayOf(20, 19), "वेली बांधणी", notes: "रवीला ५०० रु.");
        await HoldsSeeCompareAsync(CoOwner);

        var owner = PlotOf(await CompareOkAsync(Owner, FarmA), plot).GetProperty("ownWork").EnumerateArray().Single(o => o.GetProperty("dailyLogId").GetGuid() == money);
        owner.GetProperty("title").GetString().Should().Be("वेली बांधणी", "the maker reads his own words");

        var (status, body) = await CompareAsync(CoOwner, FarmA);
        status.Should().Be(HttpStatusCode.OK, body);
        var coItem = PlotOf(Json(body), plot).GetProperty("ownWork").EnumerateArray().Single(o => o.GetProperty("dailyLogId").GetGuid() == money);
        coItem.GetProperty("title").ValueKind.Should().Be(JsonValueKind.Null, "D-66: a record that states money keeps its words from a reader who does not hear wages");
        coItem.GetProperty("matchedWords").GetArrayLength().Should().Be(0);
        body.Should().NotContain("५००").And.NotContain("रवीला");
    }

    private const int OrderToday = 50;

    private async Task<(Guid Plot, Guid Cycle, ScheduleTemplate Row)> OrderPlotAsync()
    {
        var row = await CheckedScheduleAsync("Grapes - Order Compare", CompareStages,
        [
            new ImportedActivity("thin", "घड विरळणी", 38, 38, FrequencyMode.OneTime, 1),
            new ImportedActivity("ga", "जीए (संजीवक) बुडवणी", 42, 42, FrequencyMode.OneTime, 1, "thin"),
            new ImportedActivity("fung", "बुरशीनाशक फवारणी", 34, 55, FrequencyMode.EveryNDays, 7),
        ]);
        var (plot, cycle, _) = await FollowingAsync(row.Id, OrderToday);
        return (plot, cycle, row);
    }

    [Fact]
    public async Task Order_notes_name_only_works_the_reader_may_see()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await OrderPlotAsync();
        await RecordAsync(Owner, plot, cycle, DayOf(OrderToday, 44), "जीए (संजीवक) बुडवणी");
        await RecordAsync(Owner, plot, cycle, DayOf(OrderToday, 46), "घड विरळणी");
        await HoldsSeeCompareAsync(CoOwner);

        var (status, body) = await CompareAsync(CoOwner, FarmA);
        status.Should().Be(HttpStatusCode.OK, body);
        var note = SchedulesOf(PlotOf(Json(body), plot))[0].GetProperty("order").EnumerateArray().Single();
        note.GetProperty("firstTitle").GetString().Should().Be("घड विरळणी", "a title is the SCHEDULE's word, never a record's");
        note.GetProperty("thenTitle").GetString().Should().Be("जीए (संजीवक) बुडवणी");
        note.GetProperty("firstDay").GetInt32().Should().Be(46);
        note.GetProperty("thenDay").GetInt32().Should().Be(44);
        note.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("firstTitle", "thenTitle", "firstDay", "thenDay");
    }

    [Fact]
    public async Task An_order_note_is_dropped_for_a_reader_who_may_not_see_one_or_both_records()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        var (plot, cycle, _) = await OrderPlotAsync();
        var then = await RecordAsync(Owner, plot, cycle, DayOf(OrderToday, 44), "जीए (संजीवक) बुडवणी");
        var first = await RecordAsync(Owner, plot, cycle, DayOf(OrderToday, 46), "घड विरळणी");
        var unrelated = await RecordAsync(Owner, plot, cycle, DayOf(OrderToday, 48), "बुरशीनाशक फवारणी");
        await HoldsSeeCompareAsync(CoOwner);

        async Task<(JsonElement Plot, string Body)> CoOwnerReadsAsync()
        {
            var (status, body) = await CompareAsync(CoOwner, FarmA);
            status.Should().Be(HttpStatusCode.OK, body);
            return (PlotOf(Json(body), plot), body);
        }

        var owner = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        SchedulesOf(owner)[0].GetProperty("order").GetArrayLength().Should().Be(1, "the precondition: the holder is told the order");

        // Neither hidden, only an unrelated record hidden: the note stays.
        SchedulesOf((await CoOwnerReadsAsync()).Plot)[0].GetProperty("order").GetArrayLength().Should().Be(1);
        await HideAsync(unrelated);
        SchedulesOf((await CoOwnerReadsAsync()).Plot)[0].GetProperty("order").GetArrayLength().Should().Be(1, "a record that is no part of the note changes nothing");

        // One of the two hidden: the note is gone (its days would reveal the hidden record's day), the counts are not.
        await HideAsync(then);
        var onlyThenHidden = await CoOwnerReadsAsync();
        SchedulesOf(onlyThenHidden.Plot)[0].GetProperty("order").GetArrayLength().Should().Be(0);
        onlyThenHidden.Body.Should().NotContain(then.ToString());
        SchedulesOf(onlyThenHidden.Plot)[0].GetProperty("stages").EnumerateArray().ElementAt(1).GetProperty("done").GetInt32()
            .Should().Be(SchedulesOf(owner)[0].GetProperty("stages").EnumerateArray().ElementAt(1).GetProperty("done").GetInt32(), "hidden work still counts as done");

        // The other one hidden instead (a new reader state: restore the first, hide the second).
        await PushOkAsync(Owner, "set_record_audience", $"cmpd2-restore-{then:N}", new Dictionary<string, object?>
        {
            ["recordKind"] = "DailyLog",
            ["recordId"] = then,
            ["audience"] = "Team",
            ["selectedUserIds"] = Array.Empty<Guid>(),
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        await HideAsync(first);
        var onlyFirstHidden = await CoOwnerReadsAsync();
        SchedulesOf(onlyFirstHidden.Plot)[0].GetProperty("order").GetArrayLength().Should().Be(0);
        onlyFirstHidden.Body.Should().NotContain(first.ToString());

        // Both hidden.
        await HideAsync(then);
        SchedulesOf((await CoOwnerReadsAsync()).Plot)[0].GetProperty("order").GetArrayLength().Should().Be(0);
    }

    // ---- the worked plot of index-L8R3.html ----------------------------------------------------------------------

    [Fact]
    public async Task Worked_plot_of_index_L8R3_through_the_read_gives_the_pages_numbers()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();
        const int today = 50;
        var s1 = await CheckedScheduleAsync("Grapes - L8R3 one", CompareStages,
        [
            new ImportedActivity("ir", "ठिबक सिंचन", 31, 56, FrequencyMode.EveryNDays, 5),
            new ImportedActivity("fert", "विद्राव्य खत 0:52:34 (ठिबकातून)", 40, 60, FrequencyMode.EveryNDays, 10),
            new ImportedActivity("fung", "बुरशीनाशक फवारणी", 34, 55, FrequencyMode.EveryNDays, 7),
            new ImportedActivity("ga", "जीए (संजीवक) बुडवणी", 42, 42, FrequencyMode.OneTime, 1, "thin"),
            new ImportedActivity("thin", "घड विरळणी", 38, 38, FrequencyMode.OneTime, 1),
        ]);
        var s2 = await CheckedScheduleAsync("Grapes - L8R3 two", CompareStages,
        [
            new ImportedActivity("fung", "बुरशीनाशक फवारणी", 36, 50, FrequencyMode.EveryNDays, 14),
            new ImportedActivity("ins", "कीटकनाशक फवारणी", 46, 46, FrequencyMode.OneTime, 1),
            new ImportedActivity("leaf", "पानांची तपासणी", 37, 37, FrequencyMode.OneTime, 1),
        ]);
        var s3 = await CheckedScheduleAsync("Grapes - L8R3 three", CompareStages,
            [new ImportedActivity("bor", "बोरॉन फवारणी", 47, 47, FrequencyMode.OneTime, 1)]);
        var own = await SeedStoredRowWithStagesAsync("Grapes - L8R3 mine", CompareStages,
            [new ImportedActivity("weed", "खुरपणी (गवत काढणे)", 35, 55, FrequencyMode.EveryNDays, 10)], TenantScope.Team, Owner);

        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-today));
        await PushAdoptAsync(Owner, plot, cycle, s1.Id);
        await PushAdoptAsync(Owner, plot, cycle, s2.Id);
        await PushAdoptAsync(Owner, plot, cycle, s3.Id);
        await SeedFollowedRowAsync(plot, cycle, own.Id, "Own", 0);

        (int Day, string Title, int Status)[] records =
        [
            (31, "ठिबक सिंचन", 0), (35, "खुरपणी केली", 0), (36, "बुरशीनाशक फवारणी", 0), (37, "ठिबक सिंचन", 0), (41, "ठिबक सिंचन", 0),
            (41, "वेली बांधणी", 0), (42, "विद्राव्य खत 0:52:34 (ठिबकातून)", 0), (42, "बोरॉन फवारणी", 0), (44, "बुरशीनाशक फवारणी", 0),
            (44, "जीए (संजीवक) बुडवणी", 0), (45, "खुरपणी केली", 0), (46, "घड विरळणी", 0), (46, "कीटकनाशक फवारणी", 1),
            (47, "ठिबक सिंचन", 0), (49, "बुरशीनाशक फवारणी", 0),
        ];
        var veli = Guid.Empty;
        foreach (var (day, title, status) in records)
        {
            var id = await RecordAsync(Owner, plot, cycle, DayOf(today, day), title, status: status);
            if (title == "वेली बांधणी")
            {
                veli = id;
            }
        }

        var compare = PlotOf(await CompareOkAsync(Owner, FarmA), plot);
        compare.GetProperty("day").GetInt32().Should().Be(today);
        compare.GetProperty("stages").EnumerateArray().ElementAt(1).GetProperty("daysLeft").GetInt32().Should().Be(10, "days left: 10");
        var schedules = SchedulesOf(compare);
        schedules.Select(s => s.GetProperty("templateId").GetGuid()).Should().Equal([s1.Id, s2.Id, s3.Id, own.Id]);

        void Check(int schedule, (int Asked, int Done, int NotYet) expected)
        {
            var c = CountsOf(compare, schedule, 1);
            (c.GetProperty("asked").GetInt32(), c.GetProperty("done").GetInt32(), c.GetProperty("notYet").GetInt32()).Should().Be(expected, $"schedule {schedule + 1}");
        }

        Check(0, (15, 10, 5));
        Check(1, (4, 3, 1));
        Check(2, (1, 1, 0));
        Check(3, (3, 2, 1));
        ItemsOf(CountsOf(compare, 1, 1)).Sum(i => i.GetProperty("moreThanAsked").GetInt32()).Should().Be(1, "one more fungicide spray than asked");
        ItemsOf(CountsOf(compare, 1, 1)).Single(i => i.GetProperty("title").GetString() == "बुरशीनाशक फवारणी").GetProperty("moreThanAsked").GetInt32().Should().Be(1);

        var note = schedules[0].GetProperty("order").EnumerateArray().Single();
        (note.GetProperty("firstTitle").GetString(), note.GetProperty("thenTitle").GetString(), note.GetProperty("firstDay").GetInt32(), note.GetProperty("thenDay").GetInt32())
            .Should().Be(("घड विरळणी", "जीए (संजीवक) बुडवणी", 46, 44), "GA before thinning");
        foreach (var other in schedules.Skip(1))
        {
            other.GetProperty("order").GetArrayLength().Should().Be(0);
        }

        var item = compare.GetProperty("ownWork").EnumerateArray().Single();
        item.GetProperty("dailyLogId").GetGuid().Should().Be(veli);
        item.GetProperty("title").GetString().Should().Be("वेली बांधणी");
        item.GetProperty("day").GetInt32().Should().Be(41);
        item.GetProperty("matchedWords").GetArrayLength().Should().BeGreaterThan(0, "the words that decided it");
        compare.GetProperty("notRecognised").GetArrayLength().Should().Be(0);
        schedules[3].GetProperty("check").ValueKind.Should().Be(JsonValueKind.Null, "his own schedule has no check");
    }

    // ---- the two old season routes, gated by the same rule --------------------------------------------------------

    [Fact]
    public async Task The_two_old_compare_routes_are_gated_a_worker_gets_403_on_both()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();

        (await OldCompareAsync(Owner, CycleA)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: the primary owner reads /compare");
        (await OldCompareStageAsync(Owner, CycleA)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: the primary owner reads /compare/stage");

        var worker = await OldCompareAsync(Worker, CycleA);
        var workerStage = await OldCompareStageAsync(Worker, CycleA);
        worker.Status.Should().Be(HttpStatusCode.Forbidden);
        workerStage.Status.Should().Be(HttpStatusCode.Forbidden);
        worker.Body.Should().NotContain("Vegetative").And.NotContain(CycleA.ToString());
        workerStage.Body.Should().NotContain("Vegetative").And.NotContain(CycleA.ToString());
    }

    [Fact]
    public async Task The_two_old_compare_routes_refuse_a_mukadam_and_a_co_owner_without_SeeCompare_and_open_for_a_holder()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAccountAsync();

        foreach (var seat in new[] { Mukadam, CoOwner })
        {
            (await OldCompareAsync(seat, CycleA)).Status.Should().Be(HttpStatusCode.Forbidden, $"{seat} /compare without the switch");
            (await OldCompareStageAsync(seat, CycleA)).Status.Should().Be(HttpStatusCode.Forbidden, $"{seat} /compare/stage without the switch");
        }

        await HoldsSeeCompareAsync(Mukadam);
        (await OldCompareAsync(Mukadam, CycleA)).Status.Should().Be(HttpStatusCode.OK);
        (await OldCompareStageAsync(Mukadam, CycleA)).Status.Should().Be(HttpStatusCode.OK);

        // Another farm's primary owner is refused on this farm's season (and learns nothing of it).
        var stranger = await OldCompareAsync(OwnerB, CycleA);
        stranger.Status.Should().NotBe(HttpStatusCode.OK);
        stranger.Body.Should().NotContain("Vegetative").And.NotContain(CycleA.ToString());
    }

    // ---- the route table -----------------------------------------------------------------------------------------

    [Fact]
    public void The_route_table_carries_the_compare_route()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        string? file = null;
        while (current is not null && file is null)
        {
            var candidate = Path.Combine(current.FullName, "sync-contract", "routes", "server-rest-routes.txt");
            file = File.Exists(candidate) ? candidate : null;
            current = current.Parent;
        }

        file.Should().NotBeNull("the checked-in route table is found above the test output");
        File.ReadAllLines(file!).Select(l => l.Trim()).Should().Contain("GET /shramsafal/farms/{farmId:guid}/compare");
    }
}
