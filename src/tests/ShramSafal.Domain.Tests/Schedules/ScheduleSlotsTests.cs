using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

/// <summary>spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - the places: outside 1..3, his own 0, full -> null.</summary>
public sealed class ScheduleSlotsTests
{
    [Fact]
    public void The_limits_are_three_outside_and_one_own()
    {
        Assert.Equal(3, ScheduleSlots.MaxOutsideSchedulesPerPlot);
        Assert.Equal(1, ScheduleSlots.MaxOwnSchedulesPerPlot);
        Assert.Equal((short)0, ScheduleSlots.OwnSlot);
    }

    [Theory]
    [InlineData(new short[] { }, 1)]
    [InlineData(new short[] { 1 }, 2)]
    [InlineData(new short[] { 1, 2 }, 3)]
    [InlineData(new short[] { 2 }, 1)]
    [InlineData(new short[] { 1, 3 }, 2)]
    [InlineData(new short[] { 0 }, 1)] // his own place does not take an outside place
    [InlineData(new short[] { 0, 2, 3 }, 1)]
    public void Outside_takes_the_lowest_free_place_of_1_to_3(short[] taken, int expected)
    {
        Assert.Equal((short?)expected, ScheduleSlots.NextFree(ScheduleOrigin.Outside, taken));
    }

    [Fact]
    public void Outside_is_full_at_three()
    {
        Assert.Null(ScheduleSlots.NextFree(ScheduleOrigin.Outside, [1, 2, 3]));
        Assert.Null(ScheduleSlots.NextFree(ScheduleOrigin.Outside, [0, 1, 2, 3]));
    }

    [Fact]
    public void Own_takes_place_0_when_free_else_null()
    {
        Assert.Equal((short?)0, ScheduleSlots.NextFree(ScheduleOrigin.Own, []));
        Assert.Equal((short?)0, ScheduleSlots.NextFree(ScheduleOrigin.Own, [1, 2, 3]));
        Assert.Null(ScheduleSlots.NextFree(ScheduleOrigin.Own, [0]));
    }

    [Theory]
    [InlineData(-1, false)]
    [InlineData(0, true)]
    [InlineData(3, true)]
    [InlineData(4, false)]
    public void A_place_is_0_to_3(int slot, bool valid) => Assert.Equal(valid, ScheduleSlots.IsValid((short)slot));
}
