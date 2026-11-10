namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: plr-d10 lane SCH-OWN - what <see cref="IShramSafalRepository.TrySaveNewScheduleAsync"/> found when it saved a staged NEW schedule
/// row (a clone, a new version, or a farm's own schedule made empty).
/// </summary>
public enum ScheduleCopySave
{
    /// <summary>Everything staged was kept.</summary>
    Saved = 0,

    /// <summary>
    /// A copy of this source is already kept: one plain copy per source and version (<c>ix_schedule_templates_derived_version</c>), or one own
    /// copy per source and PERSON (<c>ix_schedule_templates_derived_owner</c>, SCH-OWN-c); nothing staged was kept.
    /// </summary>
    CopyExists = 1,

    /// <summary>The id is taken by another row (the primary key): a rival used it between the check and the save; nothing staged was kept.</summary>
    IdTaken = 2,
}
