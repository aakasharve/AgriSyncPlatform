// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S)
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// Lane OF-S — the domain half of moving a SAVED record ("प्लॉट बदला" / "दिवस बदला") and of "no record of done work on
/// a day that has not happened": the scope invariant holds on a move exactly as at creation, the version moves on, the
/// clock only moves forward, and the one day rule reads the farm's India day with a minutes-wide skew margin.
/// </summary>
public sealed class DailyLogMoveAndDayRuleTests
{
    private static readonly Guid PlotA = Guid.Parse("0f5e3000-0000-4000-8000-0000000000a1");
    private static readonly Guid PlotB = Guid.Parse("0f5e3000-0000-4000-8000-0000000000a2");
    private static readonly Guid CycleA = Guid.Parse("0f5e3000-0000-4000-8000-0000000000a3");
    private static readonly Guid CycleB = Guid.Parse("0f5e3000-0000-4000-8000-0000000000a4");
    private static readonly DateTime Created = new(2026, 10, 30, 5, 0, 0, DateTimeKind.Utc);

    private static DailyLog Log() => DailyLog.Create(
        Guid.NewGuid(), new FarmId(Guid.NewGuid()), PlotA, CycleA, new UserId(Guid.NewGuid()),
        new DateOnly(2026, 10, 30), null, null, Created);

    [Fact]
    public void A_move_to_another_plot_and_day_names_the_new_place_and_moves_the_version_on()
    {
        var log = Log();
        log.MoveTo(DailyLogScope.Plot, [PlotB], PlotB, CycleB, new DateOnly(2026, 10, 28), Created.AddHours(1));

        log.Scope.Should().Be(DailyLogScope.Plot);
        log.PlotIds.Should().Equal(PlotB);
        log.PlotId.Should().Be(PlotB);
        log.CropCycleId.Should().Be(CycleB);
        log.LogDate.Should().Be(new DateOnly(2026, 10, 28));
        log.ContentVersion.Should().Be(2);
        // lane MU-4 fix pass 1 (M2) — a new place is stamped like an audience change: never exactly on a whole second.
        log.ModifiedAtUtc.Should().BeOnOrAfter(Created.AddHours(1)).And.BeCloseTo(Created.AddHours(1), TimeSpan.FromMilliseconds(1));
        log.PlaceChangedAtUtc.Should().Be(log.ModifiedAtUtc);
        log.IsPlacedAt(DailyLogScope.Plot, [PlotB], CycleB, new DateOnly(2026, 10, 28)).Should().BeTrue();
    }

    [Fact]
    public void A_move_to_the_whole_farm_or_several_plots_carries_no_single_plot_and_no_season()
    {
        var log = Log();
        log.MoveTo(DailyLogScope.MultiPlot, [PlotA, PlotB], null, null, log.LogDate, Created.AddHours(1));
        log.PlotId.Should().BeNull();
        log.CropCycleId.Should().BeNull();

        log.MoveTo(DailyLogScope.Farm, [], null, null, log.LogDate, Created.AddHours(2));
        log.PlotIds.Should().BeEmpty();
        log.ContentVersion.Should().Be(3);
    }

    [Fact]
    public void The_scope_invariant_holds_on_a_move_exactly_as_at_creation()
    {
        var log = Log();
        // a single-plot record without its season, a farm-wide record that names a plot, one plot written twice
        FluentActions.Invoking(() => log.MoveTo(DailyLogScope.Plot, [PlotB], PlotB, null, log.LogDate, Created))
            .Should().Throw<ArgumentException>();
        FluentActions.Invoking(() => log.MoveTo(DailyLogScope.Farm, [PlotB], null, null, log.LogDate, Created))
            .Should().Throw<ArgumentException>();
        FluentActions.Invoking(() => log.MoveTo(DailyLogScope.MultiPlot, [PlotA, PlotA], null, null, log.LogDate, Created))
            .Should().Throw<ArgumentException>();
        log.PlotId.Should().Be(PlotA, "a refused move changes nothing");
        log.ContentVersion.Should().Be(1);
    }

    [Fact]
    public void The_clock_never_moves_back_on_a_move()
    {
        var log = Log();
        log.MoveTo(DailyLogScope.Plot, [PlotA], PlotA, CycleA, new DateOnly(2026, 10, 29), Created.AddDays(-3));
        log.ModifiedAtUtc.Should().Be(Created, "a day-only move with an older time leaves the clock where it is");

        // spec: plr-d10 lane MU-4 fix pass 1 (M2) — a move to another PLACE is stamped like an audience change: strictly
        // forward (one microsecond), never back, so every phone's cursor passes it once.
        log.MoveTo(DailyLogScope.Plot, [PlotB], PlotB, CycleB, log.LogDate, Created.AddDays(-3));
        log.ModifiedAtUtc.Should().BeAfter(Created).And.BeCloseTo(Created, TimeSpan.FromMilliseconds(1));
    }

    [Fact]
    public void A_move_may_not_go_after_the_farms_India_today_and_a_create_may_not_go_after_its_tomorrow()
    {
        // 18:25 UTC = 23:55 IST on 30 Oct; 19:00 UTC = 00:30 IST on 31 Oct.
        var lateOn30 = new DateTime(2026, 10, 30, 18, 25, 0, DateTimeKind.Utc);
        var earlyOn31 = new DateTime(2026, 10, 30, 19, 0, 0, DateTimeKind.Utc);

        LogDayRule.IsAfterFarmToday(new DateOnly(2026, 10, 30), lateOn30).Should().BeFalse();
        LogDayRule.IsAfterFarmToday(new DateOnly(2026, 10, 31), lateOn30).Should().BeTrue("a move is strict: India is still on 30 Oct");
        LogDayRule.IsAfterFarmToday(new DateOnly(2026, 10, 31), earlyOn31).Should().BeFalse("the UTC date is 30 Oct, India is on 31 Oct");

        // B009 — a create from an installed phone whose clock runs ahead keeps its record: tomorrow is taken.
        LogDayRule.IsAfterFarmTomorrow(new DateOnly(2026, 10, 31), lateOn30).Should().BeFalse();
        LogDayRule.IsAfterFarmTomorrow(new DateOnly(2026, 11, 1), lateOn30).Should().BeTrue("beyond tomorrow is a wrong date");
    }

    [Fact]
    public void The_money_ids_match_the_phones_RFC_4122_v5_ids()
    {
        // Oracle values computed outside this code: Python uuid.uuid5 and the phone's `uuid` package agree on them.
        ShramSafal.Domain.Finance.MoneyEntryIdentity.V5(ShramSafal.Domain.Finance.MoneyEntryIdentity.Namespace, "bill-1:line-1")
            .Should().Be(Guid.Parse("a7afd51e-05a9-5f50-a9b4-c337ba2ca7ec"));
        var log = Guid.Parse("0f5e4000-0000-4000-8000-0000000000d1");
        ShramSafal.Domain.Finance.MoneyEntryIdentity.ForRecordLine(log, "input", "tm-input-0")
            .Should().Be(Guid.Parse("46656035-4724-5c68-a7c2-14d3d932aed5"));
        ShramSafal.Domain.Finance.MoneyEntryIdentity.ForRecordLine(log, "labour", "0f5e4000-0000-4000-8000-0000000000d2")
            .Should().Be(Guid.Parse("b7aa5244-057f-5016-858f-afd0a605b7c7"));
        ShramSafal.Domain.Finance.MoneyEntryIdentity.ForRecordLine(log, "activity-expense", "tm-exp-0")
            .Should().Be(Guid.Parse("ab2ad4e3-02ba-503e-9ea8-d829ba573c05"));
    }
}
