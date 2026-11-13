// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 Task 1 (founder D-78, D-79, D-84 = 1, D-24e1, D-26; R13, R17).
// The visibility truth table of a reminder: each category x each setting x each seat, the PRV-hidden source log under every setting
// and under always-show, the D-24e1 base never narrowed, and the four D-84 = 1 facts. Pure (the real log audience is read through a
// real RecordVisibility built from a restricted record, exactly as the pull builds it).
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.RecordPrivacy;
using Xunit;
using static ShramSafal.Domain.Tests.Planning.PlannedWorkTests;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ReminderVisibilityTests
{
    private static readonly Guid TestFarm = PlannedWorkTests.Farm;
    private static readonly Guid Mukadam = Guid.Parse("8c100000-0000-4000-8000-000000000021");
    private static readonly Guid WorkerOnA = Guid.Parse("8c100000-0000-4000-8000-000000000022");
    private static readonly Guid WorkerOnB = Guid.Parse("8c100000-0000-4000-8000-000000000023");
    private static readonly Guid Holder = Guid.Parse("8c100000-0000-4000-8000-000000000024");
    private static readonly Guid Owner = Guid.Parse("8c100000-0000-4000-8000-000000000025");
    private static readonly Guid Expired = Guid.Parse("8c100000-0000-4000-8000-000000000026");
    private static readonly Guid SourceLog = Guid.Parse("8c100000-0000-4000-8000-0000000000c1");
    private static readonly IReadOnlySet<Guid> Nobody = new HashSet<Guid>();

    private static IReadOnlySet<Guid> Marked(params Guid[] users) => users.ToHashSet();

    private static IReadOnlySet<Guid> Chosen(params Guid[] plots) => plots.ToHashSet();

    private static ReminderSettings Settings(
        ReminderAudience log = ReminderAudience.MakerAndOwner,
        ReminderAudience own = ReminderAudience.MakerAndOwner,
        ReminderAudience schedule = ReminderAudience.PlotTeam)
    {
        var settings = ReminderSettings.Defaults(new FarmId(TestFarm));
        settings.Apply(log, own, schedule, Owner, Now);
        return settings;
    }

    /// <summary>A reminder of the given source: no assignee, on plot A, made by <see cref="Creator"/>.</summary>
    private static PlannedWork Reminder(
        PlannedWorkSource source, Guid? by = null, PlannedWorkScope scope = PlannedWorkScope.Plot, Guid[]? plots = null,
        Guid? sourcePlot = null, Guid? assignee = null)
    {
        var fromLog = source is PlannedWorkSource.VoiceLog or PlannedWorkSource.LogLeftover;
        return PlannedWork.Create(
            Guid.NewGuid(),
            new FarmId(TestFarm),
            Details(scope, plots, assignee),
            source,
            source switch
            {
                PlannedWorkSource.VoiceLog => PlannedWorkSourceKind.Spoken,
                PlannedWorkSource.LogLeftover => PlannedWorkSourceKind.Leftover,
                PlannedWorkSource.Planning => PlannedWorkSourceKind.Typed,
                _ => null,
            },
            new DateOnly(2026, 11, 8),
            by ?? Creator,
            Now,
            sourceDailyLogId: fromLog ? SourceLog : null,
            sourcePlotId: sourcePlot);
    }

    private static PlannedWorkSeat SeatOf(
        Guid user, bool primary = false, bool plan = false, bool assign = false, bool seeAll = false, bool active = true,
        IReadOnlySet<Guid>? chosen = null, bool ownWork = false) =>
        new(user, active, primary, plan, assign, seeAll, chosen, ownWork);

    private static bool Sees(PlannedWorkSeat seat, PlannedWork task, ReminderSettings settings, IReadOnlySet<Guid>? marked = null, bool logHidden = false) =>
        ReminderVisibility.VisiblePlots(seat, task, settings, marked ?? Nobody, logHidden) is not null;

    // ── each category x each setting x each seat ──────────────────────────────────────────────────────────────────────

    public static TheoryData<PlannedWorkSource, ReminderAudience> LogAndOwnCases => new()
    {
        { PlannedWorkSource.VoiceLog, ReminderAudience.MakerAndOwner },
        { PlannedWorkSource.VoiceLog, ReminderAudience.PlotTeam },
        { PlannedWorkSource.LogLeftover, ReminderAudience.MakerAndOwner },
        { PlannedWorkSource.LogLeftover, ReminderAudience.PlotTeam },
        { PlannedWorkSource.Planning, ReminderAudience.MakerAndOwner },
        { PlannedWorkSource.Planning, ReminderAudience.PlotTeam },
    };

    private static ReminderSettings For(PlannedWorkSource source, ReminderAudience audience) =>
        ReminderCategories.Of(source) == ReminderCategory.FromLogs
            ? Settings(log: audience)
            : Settings(own: audience);

    [Theory]
    [MemberData(nameof(LogAndOwnCases))]
    public void Each_seat_of_a_log_or_own_reminder_under_each_setting(PlannedWorkSource source, ReminderAudience audience)
    {
        var settings = For(source, audience);
        var reminder = Reminder(source);
        var team = audience == ReminderAudience.PlotTeam;

        // The base, whatever the setting (never narrowed): the owner, the maker, a SeeAllTasks holder on every plot.
        Sees(SeatOf(Owner, primary: true), reminder, settings).Should().BeTrue("the primary owner");
        Sees(SeatOf(Creator), reminder, settings).Should().BeTrue("the maker: his own statement");
        Sees(SeatOf(Holder, seeAll: true), reminder, settings).Should().BeTrue("a SeeAllTasks holder on every plot");

        // The plot team, only when the owner chose it (and the seat is Active and covers the plot).
        Sees(SeatOf(Mukadam, chosen: Chosen(PlotA)), reminder, settings).Should().Be(team, "a मुकादम covering the plot");
        Sees(SeatOf(WorkerOnA, chosen: Chosen(PlotA)), reminder, settings).Should().Be(team, "a worker covering the plot");
        Sees(SeatOf(Stranger), reminder, settings).Should().Be(team, "a seat that covers every plot");
        Sees(SeatOf(WorkerOnB, chosen: Chosen(PlotB)), reminder, settings).Should().BeFalse("a worker not covering the plot");
        Sees(SeatOf(Expired, active: false), reminder, settings).Should().BeFalse("an expired member sees nothing, even on PlotTeam");
        Sees(SeatOf(Creator, active: false), reminder, settings).Should().BeFalse("not even as its maker once his seat has ended");
    }

    [Theory]
    [InlineData(ReminderAudience.PlotTeam)]
    [InlineData(ReminderAudience.Planners)]
    public void Each_seat_of_a_schedule_step_under_each_setting(ReminderAudience audience)
    {
        var settings = Settings(schedule: audience);
        var step = Reminder(PlannedWorkSource.Schedule);
        var team = audience == ReminderAudience.PlotTeam;

        Sees(SeatOf(Owner, primary: true), step, settings).Should().BeTrue();
        Sees(SeatOf(Mukadam, chosen: Chosen(PlotA)), step, settings).Should().Be(team, "a मुकादम covering the plot, no plan authority");
        Sees(SeatOf(Mukadam, plan: true, chosen: Chosen(PlotA)), step, settings).Should().BeTrue("a planner covering the plot sees it under either choice");
        Sees(SeatOf(Mukadam, assign: true, chosen: Chosen(PlotA)), step, settings).Should().BeTrue("AssignWork is a planner too");
        Sees(SeatOf(WorkerOnB, plan: true, chosen: Chosen(PlotB)), step, settings).Should().BeFalse("a planner who does not cover the plot");

        // The board's own question, with the plot test left to the board (it already narrows by plot): R13.
        ReminderVisibility.MaySeeScheduleStep(SeatOf(WorkerOnA, chosen: Chosen(PlotA)), settings).Should().Be(team);
        ReminderVisibility.MaySeeScheduleStep(SeatOf(Mukadam, plan: true), settings).Should().BeTrue();
        ReminderVisibility.MaySeeScheduleStep(SeatOf(Owner, primary: true), settings).Should().BeTrue();
        ReminderVisibility.MaySeeScheduleStep(SeatOf(Expired, plan: true, active: false), settings).Should().BeFalse();
    }

    [Fact]
    public void The_defaults_are_the_D79_base_for_logs_and_own_and_the_plot_team_for_the_schedule()
    {
        var defaults = ReminderSettings.Defaults(new FarmId(TestFarm));
        defaults.LogRemindersAudience.Should().Be(ReminderAudience.MakerAndOwner);
        defaults.OwnRemindersAudience.Should().Be(ReminderAudience.MakerAndOwner);
        defaults.ScheduleRemindersAudience.Should().Be(ReminderAudience.PlotTeam);
        Sees(SeatOf(WorkerOnA, chosen: Chosen(PlotA)), Reminder(PlannedWorkSource.VoiceLog), defaults).Should().BeFalse();
    }

    // ── the chosen-plots seat and the place of a reminder with no plot row ────────────────────────────────────────────

    [Fact]
    public void A_chosen_plots_seat_sees_only_his_rows_of_a_multi_plot_reminder_under_PlotTeam()
    {
        var settings = Settings(log: ReminderAudience.PlotTeam);
        var reminder = Reminder(PlannedWorkSource.VoiceLog, scope: PlannedWorkScope.MultiPlot, plots: [PlotA, PlotB]);
        ReminderVisibility.VisiblePlots(SeatOf(WorkerOnA, chosen: Chosen(PlotA)), reminder, settings, Nobody).Should().Equal(PlotA);
        ReminderVisibility.VisiblePlots(SeatOf(Stranger), reminder, settings, Nobody).Should().BeEquivalentTo([PlotA, PlotB]);
    }

    [Fact]
    public void A_spoken_reminder_with_no_plot_row_takes_the_plot_its_log_was_made_on()
    {
        var settings = Settings(log: ReminderAudience.PlotTeam);
        var spoken = Reminder(PlannedWorkSource.VoiceLog, scope: PlannedWorkScope.Unspecified, sourcePlot: PlotA);
        Sees(SeatOf(WorkerOnA, chosen: Chosen(PlotA)), spoken, settings).Should().BeTrue("the log's plot is his");
        Sees(SeatOf(WorkerOnB, chosen: Chosen(PlotB)), spoken, settings).Should().BeFalse("the log's plot is not his");
    }

    [Fact]
    public void A_whole_farm_reminder_with_no_plot_at_all_reaches_only_a_seat_that_covers_every_plot()
    {
        var settings = Settings(own: ReminderAudience.PlotTeam);
        var wholeFarm = Reminder(PlannedWorkSource.Planning, scope: PlannedWorkScope.Farm);
        Sees(SeatOf(Stranger), wholeFarm, settings).Should().BeTrue();
        Sees(SeatOf(WorkerOnA, chosen: Chosen(PlotA)), wholeFarm, settings).Should().BeFalse("a chosen-plots seat is not on the whole farm (MU design 11.6)");
    }

    [Fact]
    public void A_seat_on_his_own_work_is_never_on_a_plot_so_the_plot_team_does_not_reach_him()
    {
        var settings = Settings(log: ReminderAudience.PlotTeam);
        Sees(SeatOf(WorkerOnA, ownWork: true), Reminder(PlannedWorkSource.VoiceLog), settings, Marked(Creator)).Should().BeFalse();
        Sees(SeatOf(Creator, ownWork: true), Reminder(PlannedWorkSource.VoiceLog), settings).Should().BeTrue("his own reminder is his on any scope");
    }

    // ── D-24e1: the assigned-work base is never narrowed (and never widened by a setting) ─────────────────────────────

    [Theory]
    [InlineData(ReminderAudience.MakerAndOwner)]
    [InlineData(ReminderAudience.PlotTeam)]
    public void The_assigned_work_base_is_never_narrowed_by_any_setting_D24e1(ReminderAudience audience)
    {
        var settings = Settings(log: audience, own: audience);
        var given = PlannedWork.Create(
            Guid.NewGuid(), new FarmId(TestFarm), Details(assignee: Raju), PlannedWorkSource.Planning, PlannedWorkSourceKind.PlanForm,
            new DateOnly(2026, 11, 8), Creator, Now);

        Sees(SeatOf(Raju), given, settings).Should().BeTrue("the assignee");
        Sees(SeatOf(Creator), given, settings).Should().BeTrue("the maker");
        Sees(SeatOf(Owner, primary: true), given, settings).Should().BeTrue("the primary owner");
        Sees(SeatOf(Holder, seeAll: true), given, settings).Should().BeTrue("a SeeAllTasks holder");
        // And a setting does not WIDEN work given to a person: the plot team is not shown another person's assignment.
        Sees(SeatOf(WorkerOnA, chosen: Chosen(PlotA)), given, settings, Marked(Creator)).Should().BeFalse("assigned work is not a reminder");
    }

    [Fact]
    public void No_setting_returns_less_than_the_base_for_any_seat_category_or_choice()
    {
        // The base is a floor: for every source, every audience combination and every seat, what PlannedWorkVisibility shows is shown.
        var seats = new[]
        {
            SeatOf(Owner, primary: true), SeatOf(Creator), SeatOf(Holder, seeAll: true), SeatOf(Raju), SeatOf(Stranger),
            SeatOf(Mukadam, chosen: Chosen(PlotA)), SeatOf(WorkerOnB, seeAll: true, chosen: Chosen(PlotB)), SeatOf(Expired, active: false),
        };
        var cases =
            from source in new[] { PlannedWorkSource.Planning, PlannedWorkSource.VoiceLog, PlannedWorkSource.LogLeftover, PlannedWorkSource.Schedule }
            from assignee in new Guid?[] { null, Raju }
            from audience in new[] { ReminderAudience.MakerAndOwner, ReminderAudience.PlotTeam }
            from schedule in new[] { ReminderAudience.PlotTeam, ReminderAudience.Planners }
            from hidden in new[] { false, true }
            select (source, assignee, audience, schedule, hidden);
        foreach (var (source, assignee, audience, schedule, hidden) in cases)
        {
            var settings = Settings(audience, audience, schedule);
            var task = Reminder(source, assignee: assignee);
            foreach (var seat in seats)
            {
                var basis = PlannedWorkVisibility.VisiblePlots(seat, task, hidden);
                var withSettings = ReminderVisibility.VisiblePlots(seat, task, settings, Nobody, hidden);
                if (basis is not null)
                {
                    withSettings.Should().NotBeNull($"the base shows {source} to seat {seat.UserId} (hidden {hidden}); no setting takes it away");
                    withSettings.Should().BeEquivalentTo(basis);
                }
            }
        }
    }

    // ── a source log kept from the reader stays inside its audience, under every setting and under always-show ─────────

    [Theory]
    [InlineData(PlannedWorkSource.VoiceLog)]
    [InlineData(PlannedWorkSource.LogLeftover)]
    public void A_reminder_from_a_hidden_log_is_never_widened_by_any_setting_or_by_always_show(PlannedWorkSource source)
    {
        var reminder = Reminder(source);
        foreach (var audience in new[] { ReminderAudience.MakerAndOwner, ReminderAudience.PlotTeam })
        {
            var settings = Settings(audience, audience);
            foreach (var marks in new[] { Nobody, Marked(Creator) })
            {
                Sees(SeatOf(WorkerOnA, chosen: Chosen(PlotA)), reminder, settings, marks, logHidden: true).Should().BeFalse("the log is kept from him");
                Sees(SeatOf(Stranger), reminder, settings, marks, logHidden: true).Should().BeFalse();
                Sees(SeatOf(Holder, seeAll: true), reminder, settings, marks, logHidden: true).Should().BeFalse("SeeAllTasks does not widen over a hidden log (L8c-4)");
                Sees(SeatOf(Creator), reminder, settings, marks, logHidden: true).Should().BeTrue("the maker always keeps his own");
                Sees(SeatOf(Owner, primary: true), reminder, settings, marks, logHidden: true).Should().BeTrue("the primary owner always sees");
            }
        }
    }

    private static RecordVisibility VisibilityFor(Guid reader, RecordAudience audience, params Guid[] chosenPeople)
    {
        var access = new FarmAccess(AppRole.Worker, MembershipStatus.Active, IsRegistrant: false, FarmPermission.None);
        var scope = FarmReadScope.Of(TestFarm, access, Now)!;
        var restricted = new RestrictedRecord(
            RecordKinds.DailyLog, SourceLog, TestFarm, audience, Creator, Now, null, new DateOnly(2026, 11, 8), PlotA, null, [], chosenPeople);
        return RecordVisibility.For(reader, new Dictionary<Guid, FarmReadScope> { [TestFarm] = scope }, [restricted]);
    }

    [Fact]
    public void A_log_hidden_only_me_or_kept_for_chosen_people_keeps_its_reminder_with_its_people_through_the_real_log_audience()
    {
        var reminder = Reminder(PlannedWorkSource.VoiceLog);
        var settings = Settings(log: ReminderAudience.PlotTeam);
        var worker = SeatOf(WorkerOnA, chosen: Chosen(PlotA));

        // Only me: the worker is not among its people.
        var onlyMe = PlannedWorkSourceLog.HiddenFrom(VisibilityFor(WorkerOnA, RecordAudience.OnlyMe), reminder);
        onlyMe.Should().BeTrue();
        Sees(worker, reminder, settings, Marked(Creator), onlyMe).Should().BeFalse();

        // Chosen people he is not among; and the same log when he IS among them (then the owner's setting reaches him).
        var notAmong = PlannedWorkSourceLog.HiddenFrom(VisibilityFor(WorkerOnA, RecordAudience.Selected, Mukadam), reminder);
        notAmong.Should().BeTrue();
        Sees(worker, reminder, settings, Marked(Creator), notAmong).Should().BeFalse();
        var among = PlannedWorkSourceLog.HiddenFrom(VisibilityFor(WorkerOnA, RecordAudience.Selected, WorkerOnA), reminder);
        among.Should().BeFalse();
        Sees(worker, reminder, settings, null, among).Should().BeTrue("he is one of the chosen people and the owner chose the plot team");
        Sees(worker, reminder, Settings(), null, among).Should().BeFalse("among the chosen people, but the owner kept log reminders to the maker and himself");
    }

    // ── D-84 = 1: the always-show list ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_marked_makers_reminder_is_seen_by_every_active_seat_covering_the_plot()
    {
        var settings = Settings(); // MakerAndOwner everywhere: only the mark widens
        var marked = Marked(Creator);
        foreach (var source in new[] { PlannedWorkSource.Planning, PlannedWorkSource.VoiceLog, PlannedWorkSource.LogLeftover })
        {
            var reminder = Reminder(source);
            Sees(SeatOf(Mukadam, chosen: Chosen(PlotA)), reminder, settings, marked).Should().BeTrue($"{source}: a मुकादम covering the plot");
            Sees(SeatOf(WorkerOnA, chosen: Chosen(PlotA)), reminder, settings, marked).Should().BeTrue($"{source}: a worker covering it");
            Sees(SeatOf(Stranger), reminder, settings, marked).Should().BeTrue($"{source}: a seat on every plot");
            Sees(SeatOf(Expired, active: false), reminder, settings, marked).Should().BeFalse($"{source}: an ended seat is not on the plot");
        }
    }

    [Fact]
    public void A_seat_not_covering_the_plot_does_not_see_it()
    {
        var settings = Settings();
        var reminder = Reminder(PlannedWorkSource.VoiceLog);
        Sees(SeatOf(WorkerOnB, chosen: Chosen(PlotB)), reminder, settings, Marked(Creator)).Should().BeFalse();
        Sees(SeatOf(WorkerOnB, chosen: Chosen(PlotB)), reminder, Settings(log: ReminderAudience.PlotTeam)).Should().BeFalse();
    }

    [Fact]
    public void A_marked_maker_is_offered_no_private_choice()
    {
        ReminderVisibility.OffersPrivateChoice(Creator, Marked(Creator)).Should().BeFalse("his reminders show to everyone on the plot (D-84 = 1)");
        ReminderVisibility.OffersPrivateChoice(Raju, Marked(Creator)).Should().BeTrue("a person who is not marked keeps the ordinary choices");
        // And no way around it in the rule: nothing but a hidden SOURCE LOG (the record's own privacy) narrows a marked maker's reminder.
        Sees(SeatOf(WorkerOnA, chosen: Chosen(PlotA)), Reminder(PlannedWorkSource.Planning), Settings(), Marked(Creator)).Should().BeTrue();
    }

    [Fact]
    public void Unmarking_returns_his_reminders_to_the_category_setting()
    {
        var reminder = Reminder(PlannedWorkSource.VoiceLog);
        var worker = SeatOf(WorkerOnA, chosen: Chosen(PlotA));
        Sees(worker, reminder, Settings(), Marked(Creator)).Should().BeTrue("marked");
        Sees(worker, reminder, Settings(), Nobody).Should().BeFalse("unmarked, and the category is the maker and the owner");
        Sees(worker, reminder, Settings(log: ReminderAudience.PlotTeam), Nobody).Should().BeTrue("unmarked, but the owner chose the plot team for log reminders");
    }

    [Fact]
    public void A_mark_belongs_to_the_maker_not_to_the_reader_and_marks_only_reminders()
    {
        var settings = Settings();
        var reader = SeatOf(WorkerOnA, chosen: Chosen(PlotA));
        Sees(reader, Reminder(PlannedWorkSource.VoiceLog, by: Raju), settings, Marked(Creator)).Should().BeFalse("another maker's reminder");
        Sees(reader, Reminder(PlannedWorkSource.Planning, assignee: Raju), settings, Marked(Creator)).Should().BeFalse("assigned work is not a reminder");
    }

    // ── who may no longer see it: the withdraw rule ───────────────────────────────────────────────────────────────────

    [Fact]
    public void A_reminder_is_named_to_a_phone_that_lost_it_only_after_a_settings_change_and_only_if_he_could_have_held_it()
    {
        var reminder = Reminder(PlannedWorkSource.VoiceLog);
        var coversIt = SeatOf(WorkerOnA, chosen: Chosen(PlotA));
        var elsewhere = SeatOf(WorkerOnB, chosen: Chosen(PlotB));

        ReminderVisibility.MustForget(coversIt, reminder).Should().BeFalse("no settings change has touched it: nobody is told anything (P10)");
        reminder.NoteReminderAudienceChanged(Now.AddMinutes(5));
        reminder.ReminderAudienceChangedAtUtc.Should().NotBeNull();
        ReminderVisibility.MustForget(coversIt, reminder).Should().BeTrue("a seat on the plot could have held it while the plot team saw it");
        ReminderVisibility.MustForget(elsewhere, reminder).Should().BeFalse("a seat off the plot could never have held it");
        ReminderVisibility.MustForget(SeatOf(Expired, active: false), reminder).Should().BeFalse();
    }

    [Fact]
    public void A_settings_change_moves_the_clock_past_every_cursor_and_nothing_else()
    {
        var reminder = Reminder(PlannedWorkSource.VoiceLog);
        var before = reminder.ModifiedAtUtc;
        var status = reminder.Status;
        reminder.NoteReminderAudienceChanged(Now.AddMinutes(5));
        reminder.ModifiedAtUtc.Should().BeAfter(before);
        reminder.Status.Should().Be(status);
        reminder.Title.Should().Be("द्राक्षाला फवारणी");
    }

    // ── the pure records ──────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Each_category_offers_only_its_own_choices_and_a_wrong_one_is_refused()
    {
        ReminderSettings.IsOffered(ReminderCategory.FromLogs, ReminderAudience.Planners).Should().BeFalse();
        ReminderSettings.IsOffered(ReminderCategory.FromPlanning, ReminderAudience.Planners).Should().BeFalse();
        ReminderSettings.IsOffered(ReminderCategory.FromSchedule, ReminderAudience.MakerAndOwner).Should().BeFalse();
        ReminderSettings.IsOffered(ReminderCategory.FromSchedule, ReminderAudience.Planners).Should().BeTrue();
        var settings = ReminderSettings.Defaults(new FarmId(TestFarm));
        var act = () => settings.Apply(ReminderAudience.Planners, null, null, Owner, Now);
        act.Should().Throw<ArgumentException>();
        settings.LogRemindersAudience.Should().Be(ReminderAudience.MakerAndOwner, "a refused choice changes nothing");
    }

    [Fact]
    public void The_same_choice_again_changes_nothing_and_stamps_nothing()
    {
        var settings = ReminderSettings.Defaults(new FarmId(TestFarm));
        settings.Apply(null, null, ReminderAudience.PlotTeam, Owner, Now).Should().BeEmpty();
        settings.UpdatedAtUtc.Should().BeNull();
        settings.Apply(ReminderAudience.PlotTeam, null, null, Owner, Now).Should().ContainSingle()
            .Which.Should().Be((ReminderCategory.FromLogs, ReminderAudience.MakerAndOwner, ReminderAudience.PlotTeam));
        settings.UpdatedByUserId.Should().Be(Owner);
    }

    [Fact]
    public void The_category_comes_from_the_source_the_door_wrote()
    {
        ReminderCategories.Of(PlannedWorkSource.VoiceLog).Should().Be(ReminderCategory.FromLogs);
        ReminderCategories.Of(PlannedWorkSource.LogLeftover).Should().Be(ReminderCategory.FromLogs);
        ReminderCategories.Of(PlannedWorkSource.Planning).Should().Be(ReminderCategory.FromPlanning);
        ReminderCategories.Of(PlannedWorkSource.Schedule).Should().Be(ReminderCategory.FromSchedule);
    }

    [Fact]
    public void ManageReminders_is_stored_on_its_own_bit_switchable_and_held_by_the_primary_owner_alone_by_label_R17()
    {
        ((int)FarmPermission.ManageReminders).Should().Be(1 << 13);
        FarmAuthorities.BitOf(FarmAuthority.ManageReminders).Should().Be(FarmPermission.ManageReminders);
        FarmAuthorities.Switchable.Should().Contain(FarmAuthority.ManageReminders);
        FarmPermissionDefaults.All.HasFlag(FarmPermission.ManageReminders).Should().BeTrue("the primary owner always holds it");
        FarmPermissionDefaults.Effective(AppRole.Worker, null).HasFlag(FarmPermission.ManageReminders).Should().BeFalse("a label grants nothing (D-26)");
    }
}
