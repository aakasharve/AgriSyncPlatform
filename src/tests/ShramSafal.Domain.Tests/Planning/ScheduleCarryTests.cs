// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year")
using System;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ScheduleCarryTests
{
    private static readonly Guid Plot = Guid.Parse("7b000000-0000-4000-8000-000000000002");
    private static readonly Guid From = Guid.Parse("7b000000-0000-4000-8000-000000000003");
    private static readonly Guid To = Guid.Parse("7b000000-0000-4000-8000-000000000004");

    private static ScheduleTaskContent Spray(ScheduleTaskTiming? timing = null) =>
        new("t-spray", "spray", ScheduleTaskKind.Spray, timing ?? ScheduleTaskTiming.OnDays(10, 30), ScheduleBasis.Stated, Dose: "2 g per litre",
            Products: [new ScheduleProduct("p", "2 g per litre", "g", "litre")], ReEntryHours: 24, PreHarvestDays: 30, Origin: "take:abc");

    [Fact]
    public void AsScheduled_And_Skip_AreTheWorkAsWritten()
    {
        ScheduleCarry.Content(Spray(), ScheduleCarryChoice.AsScheduled, 12, "9 g").Should().BeEquivalentTo(Spray());
        ScheduleCarry.Content(Spray(), ScheduleCarryChoice.Skip, 12, "9 g").Should().BeEquivalentTo(Spray());
    }

    [Fact]
    public void AsIDid_TakesTheRecordedDay_KeepsTheWidth_AndNeverTouchesGapsOrOrigin()
    {
        var copy = ScheduleCarry.Content(Spray(), ScheduleCarryChoice.AsIDid, 12, null);
        copy.Timing.FromDay.Should().Be(12);
        copy.Timing.ToDay.Should().Be(32);
        copy.Dose.Should().Be("2 g per litre", "no recorded quantity: the work keeps its own");
        copy.ReEntryHours.Should().Be(24);
        copy.PreHarvestDays.Should().Be(30);
        copy.Origin.Should().Be("take:abc");
    }

    [Fact]
    public void AsIDid_WithNoRecordedDay_KeepsTheDay_AndATimerOtherThanADayIsKept()
    {
        ScheduleCarry.Content(Spray(), ScheduleCarryChoice.AsIDid, null, null).Timing.Should().Be(Spray().Timing);
        var after = ScheduleTaskTiming.AfterTask("t-prune", 3);
        ScheduleCarry.Content(Spray(after), ScheduleCarryChoice.AsIDid, 12, null).Timing.Should().Be(after, "an after-a-work timer follows the next record, not this season's day");
        var seen = ScheduleTaskTiming.WhenSeen("flower");
        ScheduleCarry.Content(Spray(seen), ScheduleCarryChoice.AsIDid, 12, null).Timing.Should().Be(seen);
    }

    [Fact]
    public void AsIDid_TakesAQuantityOnlyWhenTheRecordStatesIt_AndNoDayWindowEndIsInvented()
    {
        ScheduleCarry.Content(Spray(), ScheduleCarryChoice.AsIDid, null, "3 g per litre").Dose.Should().Be("3 g per litre");
        ScheduleCarry.Content(Spray(), ScheduleCarryChoice.AsIDid, null, "  ").Dose.Should().Be("2 g per litre");
        ScheduleCarry.Content(Spray(ScheduleTaskTiming.OnDays(10)), ScheduleCarryChoice.AsIDid, 12, null).Timing.ToDay.Should().BeNull();
    }

    [Fact]
    public void TheAnswerId_IsOnePerPlotSeasonPairAndKey()
    {
        OwnScheduleSeasonCarry.IdFor(Plot, From, To, "t1").Should().Be(OwnScheduleSeasonCarry.IdFor(Plot, From, To, "t1"));
        OwnScheduleSeasonCarry.IdFor(Plot, From, To, "t1").Should().NotBe(OwnScheduleSeasonCarry.IdFor(Plot, From, To, "t2"));
        OwnScheduleSeasonCarry.IdFor(Plot, From, To, "t1").Should().NotBe(OwnScheduleSeasonCarry.IdFor(Plot, To, From, "t1"));
    }
}
