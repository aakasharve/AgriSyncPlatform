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
        log.ModifiedAtUtc.Should().Be(Created.AddHours(1));
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
        log.MoveTo(DailyLogScope.Plot, [PlotB], PlotB, CycleB, log.LogDate, Created.AddDays(-3));
        log.ModifiedAtUtc.Should().Be(Created);
    }

    [Fact]
    public void The_day_rule_is_the_farms_India_day_with_a_minutes_wide_skew_margin()
    {
        // 18:25 UTC = 23:55 IST on 30 Oct.
        var nearMidnight = new DateTime(2026, 10, 30, 18, 25, 0, DateTimeKind.Utc);
        LogDayRule.IsInFuture(new DateOnly(2026, 10, 30), nearMidnight).Should().BeFalse();
        // A phone a few minutes fast already says 31 Oct: never refused.
        LogDayRule.IsInFuture(new DateOnly(2026, 10, 31), nearMidnight).Should().BeFalse();
        // Earlier the same evening (22:00 IST), tomorrow is refused — the margin is minutes, never a day.
        LogDayRule.IsInFuture(new DateOnly(2026, 10, 31), new DateTime(2026, 10, 30, 16, 30, 0, DateTimeKind.Utc)).Should().BeTrue();
        // A UTC clock still on 30 Oct while India is already on 31 Oct: 31 Oct is today, not the future.
        LogDayRule.IsInFuture(new DateOnly(2026, 10, 31), new DateTime(2026, 10, 30, 19, 0, 0, DateTimeKind.Utc)).Should().BeFalse();
        LogDayRule.ClockSkewMargin.Should().BeLessThan(TimeSpan.FromHours(1));
    }
}
