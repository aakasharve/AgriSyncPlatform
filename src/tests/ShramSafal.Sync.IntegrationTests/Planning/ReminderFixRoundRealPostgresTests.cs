// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 FIX ROUND (independent review: M1, M2, M3, m1; founder D-24e1, D-26, P10, R16; doctrine E3).
//
// On a real Postgres as agrisync_app, through the real host and the real pull: the money rule reaches reminders only (never work handed to
// someone); a reader a log is kept from is never named when a setting changes; a reader the log is hidden from AFTER he held the reminder is
// told once and never again by a later edit; a stamp names a reminder to a phone at most once, never to a member who joined after it; a reminder
// given to someone else, or moved to other plots, is named to the readers who could have held it and to nobody else; a second first-ever settings
// save (or second mark of the same person) is a clean "changed first" and never a 500. Cursors are WHOLE seconds, like the phone's.
using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Planning;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ReminderFixRoundRealPostgresTests(ITestOutputHelper output) : ReminderLane(output)
{
    private static readonly Guid LateJoiner = Guid.Parse("3d030000-0000-4000-8000-0000000000f1");

    private static DateTime WholeSecond(DateTime at) => new(at.Ticks - (at.Ticks % TimeSpan.TicksPerSecond), DateTimeKind.Utc);

    /// <summary>A cursor a phone would send: whole seconds, after everything written so far.</summary>
    private static async Task<DateTime> PhoneCursorAsync() => WholeSecond(await CursorAfterNowAsync());

    private static DateTime NextOf(JsonElement root) => WholeSecond(root.GetProperty("nextCursorUtc").GetDateTime());

    private static Task WaitPastTheSecondAsync() => Task.Delay(TimeSpan.FromMilliseconds(1150));

    /// <summary>A reminder of the planning kind (the farm's "own" category) made by <paramref name="maker"/> on plot A.</summary>
    private async Task<Guid> OwnReminderAsync(Guid maker)
    {
        var id = Guid.NewGuid();
        await MadeAsync(maker, id);
        return id;
    }

    private Task SeedLateMemberAsync() => ExecOnSuperuserAsync("""
        INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
        VALUES (@user, '9300000901', 'नवा-सदस्य', 'x', NOW(), NOW(), TRUE, 0, 'mr');
        INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
        VALUES (gen_random_uuid(), @farm, @user, 'Worker', NOW(), NOW(), @account, 3, NULL, FALSE);
        """, ("user", LateJoiner), ("farm", FarmA), ("account", AccountA));

    // ── M3: the money rule is for reminders ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Work_handed_to_a_worker_keeps_its_words_when_they_mention_money_and_a_reminder_of_someone_else_still_does_not()
    {
        await AssertAppRoleIsNotVacuousAsync();
        const string handedTitle = "फवारणी ₹300 रोजाने";
        var handed = Guid.NewGuid();
        var made = await PushAsync(Owner, "plannedwork.create", $"fix-handed-{handed:N}", TaskPayload(handed, FarmA, Worker, [PlotA], "Plot", title: handedTitle));
        made.Status.Should().Be("applied", $"{made.ErrorCode}: {made.ErrorMessage}");

        var pulled = (await PulledAsync(Worker, handed))!.Value;
        pulled.GetProperty("title").GetString().Should().Be(handedTitle, "work handed to him reads exactly as before REM-1 (D-24e1)");
        pulled.GetProperty("wordsWithheld").GetBoolean().Should().BeFalse();
        var (status, body) = await GetAsync(Worker, TaskUrl(handed));
        status.Should().Be(HttpStatusCode.OK, body);
        JsonDocument.Parse(body).RootElement.GetProperty("title").GetString().Should().Be(handedTitle, "the single read says the same");

        // Control: a reminder of someone else that mentions money is still withheld from a worker who may not hear money words.
        var (_, spoken) = await SpokenAsync(Mukadam, title: "पाईप ₹500 चा");
        await SetSettingsAsync(Owner, log: "PlotTeam");
        var reminder = (await PulledAsync(Worker, spoken))!.Value;
        reminder.GetProperty("wordsWithheld").GetBoolean().Should().BeTrue("control: R16 still holds for reminders");
        reminder.GetProperty("title").GetString().Should().BeEmpty();
    }

    // ── M2 (a): a reader the log is kept from is never named when a setting changes ────────────────────────────────────

    [Fact]
    public async Task A_reader_a_log_is_kept_from_is_never_named_when_the_owner_changes_a_setting_or_marks_the_maker()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (log, task) = await SpokenAsync(Mukadam);
        await SetLogAudienceAsync(log, "OnlyMe");
        var cursor = await PhoneCursorAsync();

        await SetSettingsAsync(Owner, log: "PlotTeam");
        await MarkAsync(Owner, Mukadam);
        await SetSettingsAsync(Owner, log: "MakerAndOwner");
        await MarkAsync(Owner, Mukadam, mark: false);
        await WaitPastTheSecondAsync();

        foreach (var user in new[] { Worker, Worker2, CoOwner })
        {
            var (body, root) = await PullAsync(user, cursor);
            Withdrawn(root).Should().NotContain(("PlannedWork", task), $"{user} could never see it: its log is kept from him (P10, D-26)");
            body.Should().NotContain(task.ToString());
        }
    }

    // ── M2 (b): a log hidden AFTER he held the reminder names it to him once, and a later edit never names it again ────

    [Fact]
    public async Task A_plot_team_reader_is_told_once_when_the_log_is_hidden_and_never_again_by_a_later_edit_of_the_reminder()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, _) = await SeedSeasonAsync("Grapes");
        await SetChosenPlotsAsync(Worker2, plot2);                                   // off the plot of the reminder
        var (log, task) = await SpokenAsync(Mukadam);
        await SetSettingsAsync(Owner, log: "PlotTeam");
        (await SeesOnPullAsync(Worker, task)).Should().BeTrue("control: he holds it while the log is the team's");
        var cursor = await PhoneCursorAsync();

        await SetLogAudienceAsync(log, "OnlyMe");
        await WaitPastTheSecondAsync();
        var (_, first) = await PullAsync(Worker, cursor);
        Withdrawn(first).Should().Contain(("PlannedWork", task), "he held it and the log is now kept from him");
        Withdrawn((await PullAsync(Worker2, cursor)).Root).Should().NotContain(("PlannedWork", task), "off the plot: he could never have held it");
        var next = NextOf(first);

        // The maker words the reminder again: nobody is named by an edit.
        (await EditAsync(Mukadam, task, null, title: "पाईप आज बघायचा")).Status.Should().Be("applied");
        await WaitPastTheSecondAsync();
        Withdrawn((await PullAsync(Worker, next)).Root).Should().NotContain(("PlannedWork", task), "told once: a later edit never names it again");
    }

    // ── M2 (c): a stamp names a reminder at most once per reader, and never to a member who joined after it ───────────

    [Fact]
    public async Task A_settings_change_names_the_reminder_once_and_a_later_edit_names_nobody_including_a_member_who_joined_after()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetSettingsAsync(Owner, own: "PlotTeam");
        var task = await OwnReminderAsync(Mukadam);
        (await SeesOnPullAsync(Worker, task)).Should().BeTrue("control: he holds it");
        var cursor = await PhoneCursorAsync();

        await SetSettingsAsync(Owner, own: "MakerAndOwner");
        await SeedLateMemberAsync();                                                  // joins AFTER the change
        await WaitPastTheSecondAsync();
        var (_, told) = await PullAsync(Worker, cursor);
        Withdrawn(told).Should().Contain(("PlannedWork", task), "he held it: told once");
        var workerNext = NextOf(told);
        var (_, joined) = await PullAsync(LateJoiner);                                // his first pull, from the beginning
        Withdrawn(joined).Should().NotContain(("PlannedWork", task), "a phone pulling from the beginning holds nothing it is owed a word about");
        var lateNext = NextOf(joined);

        (await EditAsync(Mukadam, task, null, title: "पाईप आज बघायचा")).Status.Should().Be("applied");
        await WaitPastTheSecondAsync();
        Withdrawn((await PullAsync(Worker, workerNext)).Root).Should().NotContain(("PlannedWork", task), "told already: an edit names nobody again");
        Withdrawn((await PullAsync(LateJoiner, lateNext)).Root).Should().NotContain(("PlannedWork", task), "he joined after the change: never named");
        PlannedIds((await PullAsync(Mukadam, workerNext)).Root).Should().Contain(task, "control: the maker is resent it");
    }

    // ── M1: given to someone else, or moved to other plots ────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_reminder_given_to_someone_else_is_named_to_the_readers_who_could_have_held_it_and_to_nobody_else()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, _) = await SeedSeasonAsync("Grapes");
        await SetChosenPlotsAsync(Worker, PlotA);
        await SetChosenPlotsAsync(Worker2, plot2);                                    // off the plot
        await SetSettingsAsync(Owner, own: "PlotTeam");
        var task = await OwnReminderAsync(Mukadam);
        (await SeesOnPullAsync(Worker, task)).Should().BeTrue("control: he holds the reminder");
        var cursor = await PhoneCursorAsync();

        (await EditAsync(Owner, task, CoOwner, title: "द्राक्षाला फवारणी (बदल)")).Status.Should().Be("applied");
        await WaitPastTheSecondAsync();

        var (body, held) = await PullAsync(Worker, cursor);
        PlannedIds(held).Should().NotContain(task, "it is assigned work now: not his to see");
        Withdrawn(held).Should().Contain(("PlannedWork", task), "his phone holds a stale copy: told, content-free");
        body.Should().NotContain("बदल", "none of its words");
        Withdrawn((await PullAsync(Worker2, cursor)).Root).Should().NotContain(("PlannedWork", task), "off the plot: he could never have held it");
        PlannedIds((await PullAsync(CoOwner, cursor)).Root).Should().Contain(task, "the new assignee is sent it");
        Withdrawn((await PullAsync(CoOwner, cursor)).Root).Should().NotContain(("PlannedWork", task));

        await WaitPastTheSecondAsync();
        Withdrawn((await PullAsync(Worker, NextOf(held))).Root).Should().NotContain(("PlannedWork", task), "told once");
    }

    [Fact]
    public async Task A_reminder_moved_to_another_plot_is_named_to_the_readers_of_the_old_plot_and_sent_to_the_readers_of_the_new_one()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, _) = await SeedSeasonAsync("Grapes");
        var (plot3, _) = await SeedSeasonAsync("Pomegranate");
        await SetChosenPlotsAsync(Worker, PlotA);
        await SetChosenPlotsAsync(Worker2, plot2);
        await SetChosenPlotsAsync(CoOwner, plot3);                                    // covers neither place
        await SetSettingsAsync(Owner, own: "PlotTeam");
        var task = await OwnReminderAsync(Mukadam);
        (await SeesOnPullAsync(Worker, task)).Should().BeTrue("control: he holds it on plot A");
        var cursor = await PhoneCursorAsync();

        (await EditAsync(Owner, task, null, plots: [plot2], title: "द्राक्षाला फवारणी (बदल)")).Status.Should().Be("applied");
        await WaitPastTheSecondAsync();

        var (_, old) = await PullAsync(Worker, cursor);
        PlannedIds(old).Should().NotContain(task);
        Withdrawn(old).Should().Contain(("PlannedWork", task), "he covered plot A, where it was: his stale copy is told to go");
        PlannedIds((await PullAsync(Worker2, cursor)).Root).Should().Contain(task, "plot 2 is his: sent");
        var (_, neither) = await PullAsync(CoOwner, cursor);
        Withdrawn(neither).Should().NotContain(("PlannedWork", task), "he covered neither place: he could never have held it");
        PlannedIds(neither).Should().NotContain(task);
    }

    // ── m1: a lost first-ever save is a clean refusal, not a 500 ──────────────────────────────────────────────────────

    [Fact]
    public async Task A_second_first_ever_settings_save_and_a_second_mark_of_the_same_person_answer_changed_first_and_never_throw()
    {
        await AssertAppRoleIsNotVacuousAsync();
        DbContextOptions<ShramSafalDbContext> Options() => new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options;
        await using var first = new ShramSafalDbContext(Options());
        await using var second = new ShramSafalDbContext(Options());
        var one = new ShramSafalRepository(first);
        var two = new ShramSafalRepository(second);
        var at = DateTime.UtcNow;

        await one.AddReminderSettingsAsync(ReminderSettings.Create(new FarmId(FarmA), Owner, at));
        await two.AddReminderSettingsAsync(ReminderSettings.Create(new FarmId(FarmA), Owner, at));
        (await one.TrySavePlannedWorkChangeAsync()).Should().BeTrue("the first save wins");
        (await two.TrySavePlannedWorkChangeAsync()).Should().BeFalse("the second hits the primary key: a lost race, nothing kept");

        await one.AddReminderAlwaysShowAsync(new ReminderAlwaysShow(new FarmId(FarmA), Worker, Owner, at));
        await two.AddReminderAlwaysShowAsync(new ReminderAlwaysShow(new FarmId(FarmA), Worker, Owner, at));
        (await one.TrySavePlannedWorkChangeAsync()).Should().BeTrue();
        (await two.TrySavePlannedWorkChangeAsync()).Should().BeFalse("the same person marked twice at once");
        (await MarkCountAsync()).Should().Be(1);
    }
}
