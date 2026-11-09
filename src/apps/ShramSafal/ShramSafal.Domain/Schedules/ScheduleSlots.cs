namespace ShramSafal.Domain.Schedules;

/// <summary>
/// spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - the places a plot-season's followed schedules take. At most
/// <see cref="MaxOutsideSchedulesPerPlot"/> outside schedules (places 1..3) plus at most <see cref="MaxOwnSchedulesPerPlot"/> of his
/// own (place <see cref="OwnSlot"/> = 0). Only COUNTS places: which schedule may be followed at all is decided before a place is taken
/// (the check rule, L8b-1F; the Own branch, SCH-OWN). The database holds the same rule (unique places, CHECKs on the range and on
/// own = place 0), so two phones racing for the last place cannot both win.
/// </summary>
public static class ScheduleSlots
{
    public const int MaxOutsideSchedulesPerPlot = 3;
    public const int MaxOwnSchedulesPerPlot = 1;

    /// <summary>The one place of his own schedule.</summary>
    public const short OwnSlot = 0;

    /// <summary>
    /// The lowest free place for a schedule of <paramref name="origin"/> given the places already <paramref name="taken"/>:
    /// Outside takes the lowest free of 1..3, Own takes 0 when free. <c>null</c> = that kind is full.
    /// </summary>
    public static short? NextFree(ScheduleOrigin origin, IEnumerable<short> taken)
    {
        ArgumentNullException.ThrowIfNull(taken);
        var used = taken.ToHashSet();
        if (origin == ScheduleOrigin.Own)
        {
            return used.Contains(OwnSlot) ? null : OwnSlot;
        }

        for (short slot = 1; slot <= MaxOutsideSchedulesPerPlot; slot++)
        {
            if (!used.Contains(slot))
            {
                return slot;
            }
        }

        return null;
    }

    /// <summary>A place that can be held at all: 0 (his own) or 1..3 (outside).</summary>
    public static bool IsValid(short slot) => slot >= OwnSlot && slot <= MaxOutsideSchedulesPerPlot;
}
