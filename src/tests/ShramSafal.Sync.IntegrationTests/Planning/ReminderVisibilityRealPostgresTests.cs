// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 Task 2 (founder D-78, D-79, D-84 = 1, D-24e1, D-26, D-66, D-69; R15, R16, R17, R21; E3, E4).
//
// Who sees a reminder once the owner's settings are in, on a real Postgres as agrisync_app (E3 first, in every fact), through the real host and
// the real push handler: the pull and the REST reads agree; another farm's settings and list are invisible; a changed setting withdraws a
// reminder from the phones that lose it on their next pull (and names it to nobody else); a reminder from a log hidden "फक्त मी" is never
// widened by any setting or by always-show; a reminder that mentions money shows its words only to people who may hear them; a marked
// maker's reminders reach everyone on the plot; the audit row of a change holds no reminder words; a person of another farm cannot be
// marked and another farm's settings cannot be written; the four routes are in the route table.
using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Farms;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ReminderVisibilityRealPostgresTests(ITestOutputHelper output) : ReminderLane(output)
{
    // ── the defaults, and the owner's choice, on both roads ───────────────────────────────────────────────────────────

    [Fact]
    public async Task A_log_reminder_is_seen_by_its_maker_and_the_owner_only_until_the_owner_chooses_the_plot_team_and_pull_and_REST_agree()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, task) = await SpokenAsync(Mukadam);

        foreach (var (user, sees) in new[] { (Mukadam, true), (Owner, true), (Worker, false), (Worker2, false), (CoOwner, false) })
        {
            (await SeesOnPullAsync(user, task)).Should().Be(sees, $"pull, default settings, {user}");
            (await SeesOnRestAsync(user, task)).Should().Be(sees, $"REST, default settings, {user}");
        }

        await SetSettingsAsync(Owner, log: "PlotTeam");
        foreach (var user in new[] { Mukadam, Owner, Worker, Worker2, CoOwner })
        {
            (await SeesOnPullAsync(user, task)).Should().BeTrue($"pull, plot team, {user}");
            (await SeesOnRestAsync(user, task)).Should().BeTrue($"REST, plot team, {user}");
        }

        (await SeesOnPullAsync(Paused, task)).Should().BeFalse("a paused seat reads nothing of the farm, whatever the setting");
        (await SeesOnPullAsync(OwnerB, task)).Should().BeFalse("another farm's owner");

        await SetSettingsAsync(Owner, log: "MakerAndOwner");
        (await SeesOnPullAsync(Worker, task)).Should().BeFalse("back to the maker and the owner");
        (await SeesOnRestAsync(Worker, task)).Should().BeFalse();
        (await SeesOnRestAsync(Mukadam, task)).Should().BeTrue("the base is never narrowed");
    }

    [Fact]
    public async Task The_own_reminder_choice_works_the_same_way_and_never_touches_assigned_work_D24e1()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var own = Guid.NewGuid();
        var given = Guid.NewGuid();
        await MadeAsync(Mukadam, own);                          // his own reminder
        await MadeAsync(Owner, given, assignee: Worker);        // work given to Worker

        await SetSettingsAsync(Owner, own: "PlotTeam");
        (await SeesOnPullAsync(Worker2, own)).Should().BeTrue("everyone on the plot sees his own reminders now");
        (await SeesOnRestAsync(Worker2, own)).Should().BeTrue();
        (await SeesOnPullAsync(Worker2, given)).Should().BeFalse("work given to another person is never widened by a setting");
        (await SeesOnRestAsync(Worker2, given)).Should().BeFalse();
        (await SeesOnPullAsync(Worker, given)).Should().BeTrue("the assignee: the base is never narrowed");

        await SetSettingsAsync(Owner, own: "MakerAndOwner", log: "MakerAndOwner");
        (await SeesOnPullAsync(Worker, given)).Should().BeTrue("no setting narrows the assigned-work rule");
        (await SeesOnPullAsync(Owner, given)).Should().BeTrue();
        (await SeesOnPullAsync(Mukadam, own)).Should().BeTrue();
    }

    [Fact]
    public async Task A_seat_that_does_not_cover_the_plot_does_not_see_it_even_on_the_plot_team_choice()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, _) = await SeedSeasonAsync("Grapes");
        await SetChosenPlotsAsync(Worker2, plot2);
        var (_, task) = await SpokenAsync(Mukadam);
        await SetSettingsAsync(Owner, log: "PlotTeam");

        (await SeesOnPullAsync(Worker, task)).Should().BeTrue("a seat on every plot");
        (await SeesOnPullAsync(Worker2, task)).Should().BeFalse("his plots are another plot");
        (await SeesOnRestAsync(Worker2, task)).Should().BeFalse();

        await SetChosenPlotsAsync(Worker2, PlotA);
        (await SeesOnPullAsync(Worker2, task)).Should().BeTrue("now it is his plot");
    }

    // ── a changed setting leaves the phones that lose it, and tells nobody else ───────────────────────────────────────

    [Fact]
    public async Task A_changed_setting_withdraws_the_reminder_from_the_phone_that_loses_it_on_the_next_pull_and_names_it_to_nobody_else()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, _) = await SeedSeasonAsync("Grapes");
        await SetChosenPlotsAsync(Worker2, plot2);                  // never on the plot of the reminder
        var (_, task) = await SpokenAsync(Mukadam);
        await SetSettingsAsync(Owner, log: "PlotTeam");
        (await SeesOnPullAsync(Worker, task)).Should().BeTrue("his phone holds it");
        var cursor = await CursorAfterNowAsync();

        await SetSettingsAsync(Owner, log: "MakerAndOwner");
        await Task.Delay(TimeSpan.FromMilliseconds(1100));

        var (body, losing) = await PullAsync(Worker, cursor);
        Withdrawn(losing).Should().Contain(("PlannedWork", task), "his phone is told to forget it");
        PlannedIds(losing).Should().NotContain(task);
        body.Should().NotContain(SpokenTitle, "none of its words");
        var (_, elsewhere) = await PullAsync(Worker2, cursor);
        Withdrawn(elsewhere).Should().NotContain(("PlannedWork", task), "a seat that could never have held it is told nothing (P10, D-26)");
        Withdrawn((await PullAsync(Mukadam, cursor)).Root).Should().NotContain(("PlannedWork", task), "the maker keeps it");
        PlannedIds((await PullAsync(Owner, cursor)).Root).Should().Contain(task, "the owner is resent it, not told to forget it");

        // Delivered once.
        var next = losing.GetProperty("nextCursorUtc").GetDateTime();
        await Task.Delay(TimeSpan.FromMilliseconds(1100));
        Withdrawn((await PullAsync(Worker, next)).Root).Should().NotContain(("PlannedWork", task));

        // And choosing the plot team again brings it back, with its words.
        await SetSettingsAsync(Owner, log: "PlotTeam");
        await Task.Delay(TimeSpan.FromMilliseconds(1100));
        (await SeesOnPullAsync(Worker, task, next)).Should().BeTrue();
    }

    [Fact]
    public async Task A_new_reminder_nobody_may_see_is_never_named_in_anyones_withdrawn_list()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var cursor = await CursorAfterNowAsync();
        var (_, task) = await SpokenAsync(Mukadam);
        await Task.Delay(TimeSpan.FromMilliseconds(1100));
        foreach (var user in new[] { Worker, Worker2, CoOwner })
        {
            var (body, root) = await PullAsync(user, cursor);
            Withdrawn(root).Should().NotContain(("PlannedWork", task), $"{user} never held it");
            body.Should().NotContain(task.ToString());
        }
    }

    // ── a hidden source log is never widened ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_reminder_from_a_log_hidden_only_me_or_kept_for_chosen_people_is_never_widened_by_a_setting_or_by_always_show()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (log, task) = await SpokenAsync(Mukadam);
        await SetSettingsAsync(Owner, log: "PlotTeam", own: "PlotTeam");
        await MarkAsync(Owner, Mukadam);
        (await SeesOnPullAsync(Worker, task)).Should().BeTrue("control: widened while the log is the team's");

        await SetLogAudienceAsync(log, "OnlyMe");
        foreach (var user in new[] { Worker, Worker2, CoOwner })
        {
            (await SeesOnPullAsync(user, task)).Should().BeFalse($"hidden only me: {user}");
            (await SeesOnRestAsync(user, task)).Should().BeFalse($"hidden only me, REST: {user}");
        }

        (await SeesOnPullAsync(Mukadam, task)).Should().BeTrue("the maker keeps his own");
        (await SeesOnPullAsync(Owner, task)).Should().BeTrue("the primary owner always sees");

        // Kept for chosen people: only they (and the maker and the owner).
        await SetLogAudienceAsync(log, "Selected", Worker2);
        (await SeesOnPullAsync(Worker2, task)).Should().BeTrue("chosen for this record, and the owner chose the plot team");
        (await SeesOnPullAsync(Worker, task)).Should().BeFalse("not among its people, whatever any setting or mark says");
        var chosen = (await PulledAsync(Worker2, task))!.Value;
        chosen.GetProperty("fromChosenPeopleRecord").GetBoolean().Should().BeTrue("the card says it stays with that record's people");
        chosen.GetProperty("makerAlwaysShown").GetBoolean().Should().BeFalse("never claimed for a record kept for chosen people");
    }

    // ── D-84 = 1: always show ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_marked_makers_reminders_reach_every_seat_covering_the_plot_and_unmarking_returns_them_to_the_setting()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var own = Guid.NewGuid();
        await MadeAsync(Mukadam, own);
        var (_, spoken) = await SpokenAsync(Mukadam);
        (await SeesOnPullAsync(Worker, own)).Should().BeFalse("not marked yet");

        (await MarkAsync(Owner, Mukadam)).Status.Should().Be(HttpStatusCode.OK);
        (await MarkCountAsync()).Should().Be(1);
        foreach (var task in new[] { own, spoken })
        {
            foreach (var user in new[] { Worker, Worker2, CoOwner })
            {
                (await SeesOnPullAsync(user, task)).Should().BeTrue($"marked maker, pull, {user}");
                (await SeesOnRestAsync(user, task)).Should().BeTrue($"marked maker, REST, {user}");
            }
        }

        var card = (await PulledAsync(Worker, own))!.Value;
        card.GetProperty("makerAlwaysShown").GetBoolean().Should().BeTrue("the card says: by the owner's setting everyone on the plot sees it");
        card.GetProperty("createdByName").GetString().Should().Be(MukadamName, "his own name, from the farm's directory");
        card.GetProperty("category").GetString().Should().Be("FromPlanning");
        (await PulledAsync(Worker, spoken))!.Value.GetProperty("category").GetString().Should().Be("FromLogs");

        // Marking twice changes nothing; unmarking returns them to the category setting.
        (await MarkAsync(Owner, Mukadam)).Status.Should().Be(HttpStatusCode.OK);
        (await MarkCountAsync()).Should().Be(1);
        var cursor = await CursorAfterNowAsync();
        (await MarkAsync(Owner, Mukadam, mark: false)).Status.Should().Be(HttpStatusCode.OK);
        (await MarkCountAsync()).Should().Be(0, "current state: the mark is gone");
        await Task.Delay(TimeSpan.FromMilliseconds(1100));
        (await SeesOnPullAsync(Worker, own)).Should().BeFalse("back to the maker and the owner");
        Withdrawn((await PullAsync(Worker, cursor)).Root).Should().Contain(("PlannedWork", own), "the phone that held it forgets it");
        (await SeesOnPullAsync(Mukadam, own)).Should().BeTrue();

        // The history is kept (P3): the audit rows of the mark and the unmark.
        (await AuditOfAsync("ReminderSettings")).Select(a => a.Action).Should().Contain(["ReminderAlwaysShowAdded", "ReminderAlwaysShowRemoved"]);
    }

    // ── words: money (R16) and voice (R15) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_reminder_that_mentions_money_shows_its_words_only_to_readers_who_may_hear_money_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        const string Money = "मजुरांना ₹500 द्यायचे";
        var (_, task) = await SpokenAsync(Mukadam, Money);
        await SetSettingsAsync(Owner, log: "PlotTeam");

        // Not vacuous: the people who may hear it get the words.
        (await PulledAsync(Mukadam, task))!.Value.GetProperty("title").GetString().Should().Be(Money, "the maker made it");
        (await PulledAsync(Owner, task))!.Value.GetProperty("title").GetString().Should().Be(Money, "the primary owner sees wages");

        var worker = (await PulledAsync(Worker, task))!.Value;
        worker.GetProperty("wordsWithheld").GetBoolean().Should().BeTrue();
        worker.GetProperty("title").GetString().Should().BeEmpty("by ShramSafal's rule the words are not sent");
        (await PullAsync(Worker)).Body.Should().NotContain("₹500").And.NotContain("मजुरांना");
        var (status, rest) = await GetAsync(Worker, TaskUrl(task));
        status.Should().Be(HttpStatusCode.OK);
        rest.Should().NotContain("₹500").And.NotContain("मजुरांना");

        await GrantAsync(CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        (await PulledAsync(CoOwner, task))!.Value.GetProperty("title").GetString().Should().Be(Money, "he may see money and wages now");
    }

    [Fact]
    public async Task mayPlayVoice_is_true_only_for_a_reader_who_may_hear_the_logs_voice_and_the_voice_is_never_copied()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (log, task) = await SpokenAsync(Mukadam);
        await SetSettingsAsync(Owner, log: "PlotTeam");
        (await PulledAsync(Owner, task))!.Value.GetProperty("mayPlayVoice").ValueKind.Should().Be(JsonValueKind.Null, "the log has no recording: nothing to say and no button (P5, P4)");

        await using (var raw = new NpgsqlConnection(SuperuserConn))
        {
            await raw.OpenAsync();
            await using var cmd = raw.CreateCommand();
            cmd.CommandText = "UPDATE ssf.daily_logs SET voice_clip_id = @clip WHERE \"Id\" = @log";
            cmd.Parameters.AddWithValue("clip", Guid.NewGuid());
            cmd.Parameters.AddWithValue("log", log);
            (await cmd.ExecuteNonQueryAsync()).Should().Be(1);
        }

        (await PulledAsync(Owner, task))!.Value.GetProperty("mayPlayVoice").GetBoolean().Should().BeTrue("the primary owner");
        (await PulledAsync(Mukadam, task))!.Value.GetProperty("mayPlayVoice").GetBoolean().Should().BeTrue("the speaker");
        (await PulledAsync(Worker, task))!.Value.GetProperty("mayPlayVoice").GetBoolean().Should().BeFalse("he sees the reminder but may not hear this voice (D-31)");
        await GrantAsync(CoOwner, FarmAuthority.ConfirmRecords);
        (await PulledAsync(CoOwner, task))!.Value.GetProperty("mayPlayVoice").GetBoolean().Should().BeTrue("the owner's confirm-records grant");

        var worker = (await PullAsync(Worker)).Body;
        worker.Should().NotContain("clipId", "no recording id").And.NotContain("cipher", "no audio");
    }

    // ── another farm ──────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Another_farms_settings_and_reminders_are_invisible_and_do_not_widen_this_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, task) = await SpokenAsync(Mukadam);
        await SetSettingsAsync(Owner, log: "PlotTeam");
        await MarkAsync(Owner, Mukadam);

        (await SeesOnPullAsync(OwnerB, task)).Should().BeFalse("another farm's owner");
        (await GetAsync(OwnerB, TaskUrl(task, FarmB))).Status.Should().Be(HttpStatusCode.NotFound);
        var (readStatus, readBody) = await GetAsync(OwnerB, SettingsUrl(FarmA));
        var (unknownStatus, unknownBody) = await GetAsync(OwnerB, SettingsUrl(Guid.NewGuid()));
        readStatus.Should().Be(unknownStatus, "farm A's settings answer like a farm that does not exist");
        readBody.Should().Be(unknownBody);
        readBody.Should().NotContain("PlotTeam").And.NotContain(Mukadam.ToString());

        // Farm B's own owner choosing the plot team on farm B changes nothing on farm A, and reads only farm B's row.
        await MarkAsync(Owner, Mukadam, mark: false);
        (await PutSettingsAsync(OwnerB, log: "PlotTeam", farm: FarmB)).Status.Should().Be(HttpStatusCode.OK);
        (await SettingsRowAsync(FarmB))!.Value.Log.Should().Be("PlotTeam");
        (await SettingsRowAsync(FarmA))!.Value.Log.Should().Be("PlotTeam");
        await SetSettingsAsync(Owner, log: "MakerAndOwner");
        (await SettingsRowAsync(FarmB))!.Value.Log.Should().Be("PlotTeam", "farm B's choice is its own");
        (await SeesOnPullAsync(Worker, task)).Should().BeFalse("farm B's choice does not widen farm A");
    }

    [Fact]
    public async Task Settings_write_to_another_farm_answers_like_an_unknown_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var foreign = await PutSettingsAsync(OwnerB, log: "PlotTeam", farm: FarmA);
        var unknown = await PutSettingsAsync(OwnerB, log: "PlotTeam", farm: Guid.NewGuid());
        foreign.Status.Should().Be(unknown.Status);
        foreign.Body.Should().Be(unknown.Body);
        foreign.Status.Should().NotBe(HttpStatusCode.OK);
        (await SettingsRowAsync(FarmA)).Should().BeNull("nothing was written to farm A");

        var markForeign = await MarkAsync(OwnerB, Worker, farm: FarmA);
        var markUnknown = await MarkAsync(OwnerB, Worker, farm: Guid.NewGuid());
        markForeign.Status.Should().Be(markUnknown.Status);
        (await MarkCountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Always_show_of_a_user_from_another_farm_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (status, body) = await MarkAsync(Owner, OwnerB);
        status.Should().Be(HttpStatusCode.BadRequest, body);
        body.Should().Contain("ReminderAlwaysShowNotMember");
        (await MarkCountAsync()).Should().Be(0, "nothing was kept: a person of another farm cannot be marked (E4, the child's side)");
        (await AuditOfAsync("ReminderSettings")).Should().BeEmpty("a refused mark writes no audit row");

        // Not an Active member of THIS farm either: a paused seat, and a made-up person.
        (await MarkAsync(Owner, Paused)).Status.Should().Be(HttpStatusCode.BadRequest);
        (await MarkAsync(Owner, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.BadRequest);
        (await MarkCountAsync()).Should().Be(0);
        (await MarkAsync(Owner, Worker)).Status.Should().Be(HttpStatusCode.OK, "control: an Active member of this farm can be marked");
        (await MarkCountAsync()).Should().Be(1);
    }

    // ── what the audit keeps ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_audit_row_of_a_setting_change_says_old_to_new_and_holds_no_reminder_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, task) = await SpokenAsync(Mukadam, "गुप्त शब्द पाईप");
        await SetSettingsAsync(Owner, log: "PlotTeam", schedule: "Planners");

        var rows = await AuditOfAsync("ReminderSettings");
        rows.Should().ContainSingle();
        var (action, payload, actor) = rows[0];
        action.Should().Be("ReminderSettingsChanged");
        actor.Should().Be(Owner);
        payload.Should().Contain("FromLogs").And.Contain("MakerAndOwner").And.Contain("PlotTeam").And.Contain("Planners");
        payload.Should().NotContain("गुप्त").And.NotContain("पाईप").And.NotContain(task.ToString()).And.NotContain("title", "no reminder, no words");

        // The same choice again changes nothing and writes nothing.
        await SetSettingsAsync(Owner, log: "PlotTeam");
        (await AuditOfAsync("ReminderSettings")).Should().HaveCount(1);
        var stored = (await SettingsRowAsync())!.Value;
        (stored.Log, stored.Own, stored.Schedule, stored.By).Should().Be(("PlotTeam", "MakerAndOwner", "Planners", Owner));
    }

    // ── P11: release 1.0.17 reads the new bodies ───────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Pull_bodies_with_the_new_fields_and_the_withdrawn_kind_are_kept_for_the_1017_run()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (log, spoken) = await SpokenAsync(Mukadam);
        var (chosenLog, chosen) = await SpokenAsync(Mukadam, "निवडक पाईप");
        var (_, money) = await SpokenAsync(Mukadam, "मजुरांना ₹500 द्यायचे");
        await SetSettingsAsync(Owner, log: "PlotTeam");
        await MarkAsync(Owner, Mukadam);
        await SetLogAudienceAsync(chosenLog, "Selected", Worker2);

        var (marked, markedRoot) = await PullAsync(Worker2);
        TasksOf(markedRoot).Select(t => t.GetProperty("id").GetGuid()).Should().Contain([spoken, chosen, money]);
        Keep("rem1-worker-plot-team-marked-chosen-money", marked);
        var (ownerBody, _) = await PullAsync(Owner);
        Keep("rem1-owner-full", ownerBody);
        var (makerBody, _) = await PullAsync(Mukadam);
        Keep("rem1-maker-full", makerBody);

        var cursor = await CursorAfterNowAsync();
        await SetSettingsAsync(Owner, log: "MakerAndOwner");
        await MarkAsync(Owner, Mukadam, mark: false);
        await Task.Delay(TimeSpan.FromMilliseconds(1100));
        var (withdrawnBody, withdrawn) = await PullAsync(Worker, cursor);
        Withdrawn(withdrawn).Should().Contain(("PlannedWork", spoken));
        Keep("rem1-worker-withdrawn", withdrawnBody);
        log.Should().NotBeEmpty();
    }

    // ── the four routes ───────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_route_table_carries_the_four_routes()
    {
        var table = File.ReadAllText(Path.Combine(RepoRoot(), "sync-contract", "routes", "server-rest-routes.txt"));
        table.Should().Contain("GET /shramsafal/farms/{farmId:guid}/reminder-settings");
        table.Should().Contain("PUT /shramsafal/farms/{farmId:guid}/reminder-settings");
        table.Should().Contain("PUT /shramsafal/farms/{farmId:guid}/reminder-settings/always-show/{userId:guid}");
        table.Should().Contain("DELETE /shramsafal/farms/{farmId:guid}/reminder-settings/always-show/{userId:guid}");
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "sync-contract", "routes", "server-rest-routes.txt")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new DirectoryNotFoundException("sync-contract/routes/server-rest-routes.txt was not found above the test binaries.");
    }
}
