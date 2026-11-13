// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 FIX ROUND (independent review: M1, M2, M3; founder D-24e1, D-26, P10, R16).
// Pure rules: the money rule is for reminders only; the stamp that lets a pull name a reminder to a phone is set by assigning it or moving it;
// the naming rule never names a reader a log is kept from, and names one who could have held the reminder over every place it ever had.
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Planning;
using Xunit;
using static ShramSafal.Domain.Tests.Planning.PlannedWorkTests;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ReminderFixRoundTests
{
    private static readonly Guid Santosh = Guid.Parse("8c100000-0000-4000-8000-000000000031");
    private static readonly Guid Elsewhere = Guid.Parse("8c100000-0000-4000-8000-000000000032");
    private static readonly Guid Gone = Guid.Parse("8c100000-0000-4000-8000-000000000033");
    private static readonly Guid PlotC = Guid.Parse("8c100000-0000-4000-8000-0000000000a3");
    private static readonly DateTime Later = Now.AddMinutes(30);

    private static PlannedWorkDetails Words(string title, Guid? assignee = null, Guid[]? plots = null) =>
        new(title, PlannedWorkScope.Plot, plots ?? [PlotA], null, null, null, assignee, null, null, null, null, null);

    private static PlannedWork Made(PlannedWorkDetails details, Guid? by = null) =>
        PlannedWork.Create(
            Guid.NewGuid(), new FarmId(Farm), details, PlannedWorkSource.Planning, PlannedWorkSourceKind.Typed,
            new DateOnly(2026, 11, 8), by ?? Creator, Now);

    private static PlannedWorkSeat SeatOf(Guid user, IReadOnlySet<Guid>? chosen = null, bool active = true, bool ownWork = false) =>
        new(user, active, false, false, false, false, chosen, ownWork);

    private static IReadOnlySet<Guid> Chosen(params Guid[] plots) => plots.ToHashSet();

    // ── M3: R16 is for reminders ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_money_rule_blanks_the_words_of_a_reminder_and_never_the_words_of_work_handed_to_someone()
    {
        const string withMoney = "फवारणी ₹300 रोजाने";
        var reminder = Made(Words(withMoney));
        var handed = Made(Words(withMoney, assignee: Santosh));
        var reader = Guid.NewGuid();

        ReminderLooks.WithholdsWords(reminder, null, reader).Should().BeTrue("a reminder of someone else that mentions money, to a reader who may not hear it");
        ReminderLooks.WithholdsWords(reminder, null, Creator).Should().BeFalse("its maker reads his own words");
        ReminderLooks.WithholdsWords(handed, null, Santosh).Should().BeFalse("work handed to him reads exactly as before REM-1 (D-24e1)");
        ReminderLooks.WithholdsWords(handed, null, reader).Should().BeFalse("assigned work is never blanked by the reminder rule");
    }

    // ── M2 (a): never name a reader the log is kept from ──────────────────────────────────────────────────────────────

    [Fact]
    public void A_reader_a_log_is_kept_from_is_never_named_even_when_he_covers_the_plot()
    {
        var reminder = Made(Words("पाईप बघायचा"));
        reminder.NoteReminderAudienceChanged(Later);
        var seat = SeatOf(Santosh, Chosen(PlotA));

        ReminderVisibility.MustForget(seat, reminder, sourceLogHidden: false).Should().BeTrue("control: he could have held it");
        ReminderVisibility.MustForget(seat, reminder, sourceLogHidden: true).Should().BeFalse("the log was kept from him: he never held it (P10, D-26)");
    }

    // ── M1: the stamp is set by assigning a reminder or moving it, and by nothing else ───────────────────────────────

    [Fact]
    public void Assigning_a_reminder_to_someone_else_stamps_it_and_so_does_moving_it_to_another_plot()
    {
        var assigned = Made(Words("पाईप बघायचा"));
        assigned.ReminderAudienceChangedAtUtc.Should().BeNull();
        assigned.Edit(Words("पाईप बघायचा", assignee: Santosh), Later);
        assigned.IsReminder.Should().BeFalse();
        assigned.ReminderAudienceChangedAtUtc.Should().Be(assigned.ModifiedAtUtc, "it left the reminders: phones that could have held it are told, once");

        var moved = Made(Words("पाईप बघायचा"));
        moved.Edit(Words("पाईप बघायचा", plots: [PlotB]), Later);
        moved.ReminderAudienceChangedAtUtc.Should().Be(moved.ModifiedAtUtc, "it moved to another place");

        var reworded = Made(Words("पाईप बघायचा"));
        reworded.Edit(Words("पाईप आज बघायचा"), Later);
        reworded.ReminderAudienceChangedAtUtc.Should().BeNull("a new title changes nobody's right to see it");

        var work = Made(Words("फवारणी", assignee: Santosh));
        work.Edit(Words("फवारणी", assignee: Elsewhere), Later);
        work.ReminderAudienceChangedAtUtc.Should().BeNull("it was never a reminder: the former-assignee rule is its own");
    }

    [Fact]
    public void A_stamp_names_a_covering_seat_over_every_place_the_reminder_ever_had_and_nobody_else()
    {
        var reminder = Made(Words("पाईप बघायचा"));
        reminder.Edit(Words("पाईप बघायचा", plots: [PlotB]), Later);     // moved from A to B; the row on A is dropped, still remembered

        ReminderVisibility.MustForget(SeatOf(Santosh, Chosen(PlotA)), reminder).Should().BeTrue("he covered the plot it was on");
        ReminderVisibility.MustForget(SeatOf(Santosh, null), reminder).Should().BeTrue("a seat on every plot");
        ReminderVisibility.MustForget(SeatOf(Elsewhere, Chosen(PlotC)), reminder).Should().BeFalse("he covered neither place: he could never have held it");
        ReminderVisibility.MustForget(SeatOf(Gone, null, active: false), reminder).Should().BeFalse("not an Active seat");
        ReminderVisibility.MustForget(SeatOf(Santosh, null, ownWork: true), reminder).Should().BeFalse("a seat on his own work is never on a plot");

        var assigned = Made(Words("पाईप बघायचा"));
        assigned.Edit(Words("पाईप बघायचा", assignee: Elsewhere), Later);
        ReminderVisibility.MustForget(SeatOf(Santosh, Chosen(PlotA)), assigned).Should().BeTrue("it is no longer a reminder, but he could have held it as one");
        ReminderVisibility.MustForget(SeatOf(Santosh, Chosen(PlotC)), assigned).Should().BeFalse("off its plot");
    }
}
