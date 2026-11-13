// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 Task 4 (founder D-78 "the owner can decide who can customise", D-26 no re-delegation; R17, R21; E3, E4).
//
// Who may change the reminder settings, through the real host as agrisync_app (E3 first, in every fact): the primary owner 200; a seat that holds
// "आठवणींची मांडणी बदलणे" 200 (and his change is his, in the audit); a holder GRANTING it to another seat is refused (only the primary owner
// grants it); a worker, a मुकादम, a सहमालक holding other authorities, and a paused seat are refused; a choice a kind of reminder does not offer
// is refused and changes nothing. REST only: there is no queued mutation for a setting (R21).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ReminderSettingsRoutesRealPostgresTests(ITestOutputHelper output) : ReminderLane(output)
{
    private async Task<(HttpStatusCode Status, string Body)> GetSettingsAsync(Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, SettingsUrl(), user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[REM-1] {user} GET settings -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    [Fact]
    public async Task The_primary_owner_reads_and_changes_the_settings_and_a_farm_that_never_changed_them_reads_the_defaults()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (status, body) = await GetSettingsAsync(Owner);
        status.Should().Be(HttpStatusCode.OK, body);
        var defaults = JsonDocument.Parse(body).RootElement;
        defaults.GetProperty("logRemindersAudience").GetString().Should().Be("MakerAndOwner");
        defaults.GetProperty("ownRemindersAudience").GetString().Should().Be("MakerAndOwner");
        defaults.GetProperty("scheduleRemindersAudience").GetString().Should().Be("PlotTeam");
        defaults.GetProperty("alwaysShow").GetArrayLength().Should().Be(0);
        (await SettingsRowAsync()).Should().BeNull("a read makes no row");

        (await PutSettingsAsync(Owner, log: "PlotTeam", schedule: "Planners")).Status.Should().Be(HttpStatusCode.OK);
        var changed = JsonDocument.Parse((await GetSettingsAsync(Owner)).Body).RootElement;
        changed.GetProperty("logRemindersAudience").GetString().Should().Be("PlotTeam");
        changed.GetProperty("ownRemindersAudience").GetString().Should().Be("MakerAndOwner", "an omitted choice is left as it was");
        changed.GetProperty("scheduleRemindersAudience").GetString().Should().Be("Planners");
        changed.GetProperty("updatedByUserId").GetGuid().Should().Be(Owner);

        (await MarkAsync(Owner, Worker)).Status.Should().Be(HttpStatusCode.OK);
        var marks = JsonDocument.Parse((await GetSettingsAsync(Owner)).Body).RootElement.GetProperty("alwaysShow");
        marks.GetArrayLength().Should().Be(1);
        marks[0].GetProperty("userId").GetGuid().Should().Be(Worker);
        marks[0].GetProperty("displayName").GetString().Should().Be(WorkerName, "his name from the farm's directory, never invented");
    }

    [Fact]
    public async Task A_holder_of_ManageReminders_may_read_and_change_the_settings_and_the_audit_says_it_was_he()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await GetSettingsAsync(CoOwner)).Status.Should().Be(HttpStatusCode.Forbidden, "control: without the authority he may not even read them");
        await GrantAsync(CoOwner, FarmAuthority.ManageReminders);

        (await GetSettingsAsync(CoOwner)).Status.Should().Be(HttpStatusCode.OK);
        (await PutSettingsAsync(CoOwner, own: "PlotTeam")).Status.Should().Be(HttpStatusCode.OK);
        (await MarkAsync(CoOwner, Mukadam)).Status.Should().Be(HttpStatusCode.OK);
        (await MarkAsync(CoOwner, Mukadam, mark: false)).Status.Should().Be(HttpStatusCode.OK);
        (await SettingsRowAsync())!.Value.Own.Should().Be("PlotTeam");
        (await SettingsRowAsync())!.Value.By.Should().Be(CoOwner);
        (await AuditOfAsync("ReminderSettings")).Should().OnlyContain(a => a.Actor == CoOwner).And.HaveCount(3);
    }

    [Fact]
    public async Task A_ManageReminders_holder_granting_ManageReminders_to_another_seat_is_refused_and_only_the_primary_owner_grants_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GrantAsync(CoOwner, FarmAuthority.ManageReminders);

        var attempt = new { authorities = new[] { new { name = "ManageReminders", expiresAtUtc = (DateTime?)null } } };
        using (var refused = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/authorities", CoOwner, attempt))
        {
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, "D-26: no re-delegation");
        }

        (await GetSettingsAsync(Mukadam)).Status.Should().Be(HttpStatusCode.Forbidden, "nothing was granted to him");

        // The primary owner grants it, by the same route.
        using (var granted = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/authorities", Owner, attempt))
        {
            granted.StatusCode.Should().Be(HttpStatusCode.OK, await granted.Content.ReadAsStringAsync());
        }

        (await GetSettingsAsync(Mukadam)).Status.Should().Be(HttpStatusCode.OK, "the owner gave it to him (a whole-farm seat)");
        (await PutSettingsAsync(Mukadam, log: "PlotTeam")).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_worker_a_mukadam_and_a_paused_seat_are_refused_and_nothing_is_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await GetSettingsAsync(Owner)).Status.Should().Be(HttpStatusCode.OK, "control: the owner may");
        foreach (var user in new[] { Worker, Mukadam, CoOwner })
        {
            (await GetSettingsAsync(user)).Status.Should().Be(HttpStatusCode.Forbidden, $"read, {user}");
            (await PutSettingsAsync(user, log: "PlotTeam")).Status.Should().Be(HttpStatusCode.Forbidden, $"write, {user}");
            (await MarkAsync(user, Worker2)).Status.Should().Be(HttpStatusCode.Forbidden, $"mark, {user}");
            (await MarkAsync(user, Worker2, mark: false)).Status.Should().Be(HttpStatusCode.Forbidden, $"unmark, {user}");
        }

        // Other authorities are not this one (PlanWork, AssignWork, SeeAllTasks, ConfirmRecords).
        await GrantAsync(Mukadam, FarmAuthority.PlanWork, FarmAuthority.AssignWork, FarmAuthority.SeeAllTasks, FarmAuthority.ConfirmRecords);
        (await PutSettingsAsync(Mukadam, log: "PlotTeam")).Status.Should().Be(HttpStatusCode.Forbidden);

        (await PutSettingsAsync(Paused, log: "PlotTeam")).Status.Should().NotBe(HttpStatusCode.OK, "a paused seat reads nothing of the farm");
        (await SettingsRowAsync()).Should().BeNull();
        (await MarkCountAsync()).Should().Be(0);
        (await AuditOfAsync("ReminderSettings")).Should().BeEmpty();
    }

    [Fact]
    public async Task A_choice_a_kind_of_reminder_does_not_offer_is_refused_and_changes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        foreach (var (log, own, schedule) in new (string?, string?, string?)[]
                 {
                     ("Planners", null, null),          // schedule steps only
                     (null, "Planners", null),
                     (null, null, "MakerAndOwner"),     // log and own only
                     ("everyone", null, null),          // not a word
                     ("1", null, null),                 // never a number
                     (null, null, null),                // nothing chosen
                 })
        {
            var (status, body) = await PutSettingsAsync(Owner, log, own, schedule);
            status.Should().Be(HttpStatusCode.BadRequest, body);
        }

        // One bad choice among good ones changes none of them.
        (await PutSettingsAsync(Owner, log: "PlotTeam", schedule: "MakerAndOwner")).Status.Should().Be(HttpStatusCode.BadRequest);
        (await SettingsRowAsync()).Should().BeNull();
        (await AuditOfAsync("ReminderSettings")).Should().BeEmpty();
    }

    [Fact]
    public async Task Setting_changes_are_REST_only_there_is_no_queued_mutation_for_them_R21()
    {
        await AssertAppRoleIsNotVacuousAsync();
        foreach (var mutation in new[] { "reminder_settings.set", "reminder.settings", "reminder_always_show.add", "reminders.set_settings" })
        {
            var result = await PushAsync(Owner, mutation, $"rem1-queue-{mutation}", new System.Collections.Generic.Dictionary<string, object?>
            {
                ["farmId"] = FarmA,
                ["logRemindersAudience"] = "PlotTeam",
            });
            result.Status.Should().NotBe("applied", $"{mutation} is not a door");
        }

        (await SettingsRowAsync()).Should().BeNull("nothing a queue could send changed a setting");
    }

    private async Task<List<string>> BoardStepsAsync(Guid user)
    {
        var (status, body) = await GetAsync(user, "/shramsafal/attention");
        status.Should().Be(HttpStatusCode.OK, body);
        var steps = JsonDocument.Parse(body).RootElement.TryGetProperty("scheduledWork", out var list) && list.ValueKind == JsonValueKind.Array
            ? list.EnumerateArray().Select(s => s.GetProperty("activityName").GetString()!).ToList()
            : [];
        Output.WriteLine($"[REM-1] board steps of {user}: [{string.Join(", ", steps)}]");
        return steps;
    }

    [Fact]
    public async Task The_attention_boards_schedule_steps_follow_the_schedule_setting_plot_team_by_default_planners_when_chosen_R13()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // A planned step of the schedule (due long ago, no work recorded for it): the board lists it for every seat that reads the overview.
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.planned_activities ("Id", crop_cycle_id, activity_name, stage, planned_date, created_at_utc, modified_at_utc)
            VALUES (gen_random_uuid(), @cycle, 'रोपांची छाटणी', 'Vegetative', DATE '2026-09-01', NOW(), NOW());
            """, ("cycle", CycleA));
        (await BoardStepsAsync(Owner)).Should().Contain("रोपांची छाटणी", "control: the owner reads the board");
        (await BoardStepsAsync(Mukadam)).Should().Contain("रोपांची छाटणी", "the default is the plot team, today's rule");

        await SetSettingsAsync(Owner, schedule: "Planners");
        (await BoardStepsAsync(Owner)).Should().Contain("रोपांची छाटणी", "the primary owner is always a planner");
        (await BoardStepsAsync(Mukadam)).Should().BeEmpty("a मुकादम with no plan authority is not a planner");
        await GrantAsync(Mukadam, FarmAuthority.PlanWork);
        (await BoardStepsAsync(Mukadam)).Should().Contain("रोपांची छाटणी", "a holder of PlanWork is a planner");
        await GrantAsync(Mukadam, FarmAuthority.AssignWork);
        (await BoardStepsAsync(Mukadam)).Should().Contain("रोपांची छाटणी", "AssignWork is a planner too");
        await GrantAsync(Mukadam);

        await SetSettingsAsync(Owner, schedule: "PlotTeam");
        (await BoardStepsAsync(Mukadam)).Should().Contain("रोपांची छाटणी", "back to the plot team");
    }

    [Fact]
    public async Task The_assignees_screen_and_every_other_planned_work_route_still_work_after_the_settings_exist()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetSettingsAsync(Owner, log: "PlotTeam");
        var (status, body) = await GetAsync(Owner, $"/shramsafal/farms/{FarmA}/planned-work/assignees");
        status.Should().Be(HttpStatusCode.OK, body);
        (await GetAsync(Owner, $"/shramsafal/farms/{FarmA}/planned-work")).Status.Should().Be(HttpStatusCode.OK);
        (await GetAsync(Worker, $"/shramsafal/farms/{FarmA}/planned-work/assignees")).Status.Should().Be(HttpStatusCode.Forbidden);
    }
}
