namespace ShramSafal.Domain.Planning;

/// <summary>
/// spec: plr-d10 lane SCH-OWN (Task 2; founder D-74, D-82 = 3) - one activity of a farm's own schedule, as the farmer's phone sends it
/// (the <c>EditCopyOnWrite</c> overload of <see cref="ScheduleTemplate"/> that takes stages and activities).
/// Unlike <see cref="ImportedActivity"/> it names its part and its operation: a farmer types his own days and picks the part; the server
/// does not guess what he meant. The server mints every id; there is no order (R34's "after" is a platform-reviewer feature).
/// </summary>
/// <param name="Name">His words for the work (1..120).</param>
/// <param name="Part">One of <c>irrigation | nutrition | spray | work</c> (case-blind), stored as the <c>WorkPart</c> name.</param>
/// <param name="OperationKey">WORK-ID's <c>op_*</c> key when the phone knows it; otherwise the server proposes one from the name.</param>
/// <param name="StartDay">The first day of the work (0 or more).</param>
/// <param name="EndDay">The last day (not before the start).</param>
/// <param name="FrequencyMode">Once, every N days, or times a week.</param>
/// <param name="IntervalDays">Every N days (1 or more), or times a week (1 to 7).</param>
public sealed record ScheduleActivityDraft(
    string Name,
    string Part,
    string? OperationKey,
    int StartDay,
    int EndDay,
    FrequencyMode FrequencyMode,
    int IntervalDays);
