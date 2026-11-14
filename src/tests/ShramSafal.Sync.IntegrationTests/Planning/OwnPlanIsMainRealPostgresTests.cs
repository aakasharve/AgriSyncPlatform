// spec: plr-d10 lane CMP-OWN (founder ticked compare v4: the farmer's OWN plan is the main one; spec ids as in G:\agrisync-scratch\streamI\r5s\BRIEF-CMPOWN.md).
//
// A plot that follows a schedule that is HIS OWN (ssf.schedule_templates.owner_user_id = the owner of the plot's farm, D-136) AND stores stages gets that
// schedule as its मुख्य one, through every door that names a main schedule: the stage panel (isMain, the stage and day), the compare (isMain, day 0, the
// stages the counts are against) and the pull (plotMainSchedules). A blank own schedule (no stage), or one owned by somebody else, never does: the
// checked University schedule stays main exactly as before.
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host and routes. Fake phone numbers only.
using System;
using System.Collections.Generic;
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
public sealed class OwnPlanIsMainRealPostgresTests(ITestOutputHelper output) : ScheduleGateLane(output)
{
    private static string Day(DateOnly d) => d.ToString("yyyy-MM-dd");

    private Task PaidAsync() =>
        SetStandingAsync(AccountA, Owner, Active, DateTime.UtcNow.AddDays(-100), DateTime.UtcNow.AddDays(200));

    /// <summary>A person's own schedule that STORES its stages (and one work), through the production domain; its owner column names <paramref name="owner"/>.</summary>
    private async Task<Guid> SeedOwnWithStagesAsync(Guid owner, string name = "माझं योजना")
    {
        var me = new AgriSync.SharedKernel.Contracts.Ids.UserId(owner);
        var v1 = ScheduleTemplate.CreateOwn(Guid.NewGuid(), name, "Grapes", me, me, DateTime.UtcNow);
        await using var db = NewSuperuserContext();
        db.ScheduleTemplates.Add(v1);
        await db.SaveChangesAsync();
        var v2 = v1.EditCopyOnWrite(
            Guid.NewGuid(), null, null,
            [new("Mine-A", 0, 9), new("Mine-B", 10, 60)],
            [new("ठिबक सिंचन", "irrigation", null, 0, 20, FrequencyMode.EveryNDays, 3)],
            me, DateTime.UtcNow, out var problem);
        problem.Should().BeNull();
        db.ScheduleTemplates.Add(v2!);
        await db.SaveChangesAsync();
        return v2!.Id;
    }

    /// <summary>A blank own schedule: made, no stage, no work (it stores no days).</summary>
    private async Task<Guid> SeedOwnBlankAsync(Guid owner)
    {
        var me = new AgriSync.SharedKernel.Contracts.Ids.UserId(owner);
        var id = Guid.NewGuid();
        await using var db = NewSuperuserContext();
        db.ScheduleTemplates.Add(ScheduleTemplate.CreateOwn(id, "रिकामं", "Grapes", me, me, DateTime.UtcNow));
        await db.SaveChangesAsync();
        return id;
    }

    /// <summary>A plot on its day 20 following the checked University schedule (place 1, day 0 = the season start) AND the given own schedule (place 0, own day 0 five days ago).</summary>
    private async Task<(Guid Plot, Guid Cycle, ScheduleTemplate Uni)> PlotWithOwnAsync(Guid ownTemplate)
    {
        var uni = await CheckedInstitutionAsync();
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-20));
        await PushAdoptAsync(Owner, plot, cycle, uni.Id);
        // His own schedule cannot be adopted through the door before it stores days; the row is arranged as superuser (as the lanes before did).
        await SeedFollowedRowAsync(plot, cycle, ownTemplate, "Own", 0, referenceDate: Day(TodayIst().AddDays(-5)));
        return (plot, cycle, uni);
    }

    private async Task<JsonElement> StagePlanOkAsync(Guid plot)
    {
        var (status, body) = await StagePlanAsync(Owner, FarmA, plot);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body);
    }

    private async Task<JsonElement> CompareOkAsync(Guid plot)
    {
        var (status, body) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/compare", Owner, null);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body).GetProperty("plots").EnumerateArray().Single(p => p.GetProperty("plotId").GetGuid() == plot);
    }

    private async Task<Guid?> PullMainOfAsync(Guid plot)
    {
        var (_, root) = await PullAsync(Owner);
        var rows = root.GetProperty("plotMainSchedules").EnumerateArray().Where(m => m.GetProperty("plotId").GetGuid() == plot).ToList();
        return rows.Count == 0 ? null : rows.Single().GetProperty("subscriptionId").GetGuid();
    }

    private static (Guid Sub, bool IsMain) Of(JsonElement schedules, Guid template)
    {
        var row = schedules.EnumerateArray().Single(s => s.GetProperty("templateId").GetGuid() == template);
        return (row.GetProperty("subscriptionId").GetGuid(), row.GetProperty("isMain").GetBoolean());
    }

    [Fact]
    public async Task His_own_schedule_with_stages_is_main_in_the_panel_the_compare_and_the_pull_and_sets_day_zero_and_the_stages()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var own = await SeedOwnWithStagesAsync(Owner);
        var (plot, _, uni) = await PlotWithOwnAsync(own);

        // the stage panel: his own is main; the stage and the day are his (day 5 of his own schedule, not day 20 of the University one)
        var plan = await StagePlanOkAsync(plot);
        var planSchedules = plan.GetProperty("schedules");
        Of(planSchedules, own).IsMain.Should().BeTrue("his own plan with stages is the main one");
        Of(planSchedules, uni.Id).IsMain.Should().BeFalse();
        plan.GetProperty("stage").GetProperty("name").GetString().Should().Be("Mine-A");
        plan.GetProperty("stage").GetProperty("dayToday").GetInt32().Should().Be(5);

        // the compare: isMain on his own, day 0 = his own reference date, the plot's stages are HIS stages
        var compare = await CompareOkAsync(plot);
        Of(compare.GetProperty("schedules"), own).IsMain.Should().BeTrue();
        Of(compare.GetProperty("schedules"), uni.Id).IsMain.Should().BeFalse();
        compare.GetProperty("day").GetInt32().Should().Be(5);
        compare.GetProperty("stages").EnumerateArray().Select(s => s.GetProperty("name").GetString()).Should().Equal("Mine-A", "Mine-B");
        compare.GetProperty("stages").EnumerateArray().Select(s => s.GetProperty("state").GetString()).Should().Equal("current", "ahead");

        // the pull names the same subscription
        (await PullMainOfAsync(plot)).Should().Be(Of(planSchedules, own).Sub);
    }

    [Fact]
    public async Task A_blank_own_schedule_does_not_become_main_the_checked_University_schedule_stays()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var blank = await SeedOwnBlankAsync(Owner);
        var (plot, _, uni) = await PlotWithOwnAsync(blank);

        var plan = await StagePlanOkAsync(plot);
        Of(plan.GetProperty("schedules"), uni.Id).IsMain.Should().BeTrue();
        Of(plan.GetProperty("schedules"), blank).IsMain.Should().BeFalse();

        var compare = await CompareOkAsync(plot);
        Of(compare.GetProperty("schedules"), uni.Id).IsMain.Should().BeTrue();
        compare.GetProperty("day").GetInt32().Should().Be(20, "day 0 is still the University schedule's");
        compare.GetProperty("stages").EnumerateArray().Select(s => s.GetProperty("name").GetString())
            .Should().Equal("Post Pruning", "Canopy Build", "Berry Development");

        (await PullMainOfAsync(plot)).Should().Be(Of(plan.GetProperty("schedules"), uni.Id).Sub);
    }

    [Fact]
    public async Task A_schedule_owned_by_somebody_else_is_not_his_own_plan_so_the_University_schedule_stays_main()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PaidAsync();
        var theirs = await SeedOwnWithStagesAsync(CoOwner, "त्याची योजना");
        var (plot, _, uni) = await PlotWithOwnAsync(theirs);

        var plan = await StagePlanOkAsync(plot);
        Of(plan.GetProperty("schedules"), uni.Id).IsMain.Should().BeTrue();
        // (his co-owner's row may not even be described to him - then it is not listed at all; if it is, it is not main)
        plan.GetProperty("schedules").EnumerateArray().Where(x => x.GetProperty("templateId").GetGuid() == theirs)
            .Should().OnlyContain(x => !x.GetProperty("isMain").GetBoolean());
        (await PullMainOfAsync(plot)).Should().Be(Of(plan.GetProperty("schedules"), uni.Id).Sub);
    }
}
