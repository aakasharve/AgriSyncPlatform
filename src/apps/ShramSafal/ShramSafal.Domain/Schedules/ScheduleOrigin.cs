namespace ShramSafal.Domain.Schedules;

/// <summary>
/// spec: plr-d10 lane L8b-1F (R5, R23) - whose schedule a plot follows. <see cref="Outside"/>: a built-in sample or a Public
/// library schedule (ShramSafal's check applies). <see cref="Own"/>: a Team schedule of THIS plot's farm owner (no check, D-82 = 3;
/// opened by SCH-OWN). Stored as its name in <c>ssf.schedule_subscriptions.origin</c>; NULL = chosen before this lane, read as Outside.
/// </summary>
public enum ScheduleOrigin
{
    Outside = 0,
    Own = 1,
}
