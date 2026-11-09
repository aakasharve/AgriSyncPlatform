namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: plr-d10 lane L8b-3 (Open point 7) - what <see cref="IShramSafalRepository.TrySaveScheduleSubscriptionAsync"/> found when it
/// saved a staged schedule choice.
/// </summary>
public enum ScheduleSubscriptionSave
{
    /// <summary>Everything staged was kept.</summary>
    Saved = 0,

    /// <summary>A rival took the place first (<c>ux_sched_sub_active_slot</c>); nothing staged was kept.</summary>
    PlaceTaken = 1,

    /// <summary>The same schedule is already followed on this plot-season (<c>ux_sched_sub_active_template</c>); nothing staged was kept.</summary>
    TemplateAlreadyFollowed = 2,
}
