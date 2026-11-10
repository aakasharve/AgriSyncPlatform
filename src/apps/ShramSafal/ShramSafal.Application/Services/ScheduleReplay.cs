using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane SCH-OWN fix round 1 (M011; session A's design call, F219) - is the row now stored under a schedule id THE SAME REQUEST that was
/// just refused as "taken"? The window is a race: the id-exists check passed, a rival saved the same id between it and the save. When the stored row
/// was made by the same person with the same content (id, maker, scope, owner, version, lineage, name, crop, stage, the four made-for tags, every stage
/// and every work as stored), it is the request's own earlier success - an idempotent replay, answered like one. Anything else is a different schedule
/// that holds the id.
/// The server mints each work's id, so works are compared by what they say, not by id.
/// </summary>
internal static class ScheduleReplay
{
    public static bool IsSameRequest(ScheduleTemplate stored, ScheduleTemplate attempted)
    {
        ArgumentNullException.ThrowIfNull(stored);
        ArgumentNullException.ThrowIfNull(attempted);
        return stored.Id == attempted.Id
            && stored.CreatedByUserId == attempted.CreatedByUserId
            && stored.TenantScope == attempted.TenantScope
            && stored.OwnerUserId == attempted.OwnerUserId
            && stored.Version == attempted.Version
            && stored.PreviousVersionId == attempted.PreviousVersionId
            && stored.DerivedFromTemplateId == attempted.DerivedFromTemplateId
            && stored.OwnerType == attempted.OwnerType
            && string.Equals(stored.Name, attempted.Name, StringComparison.Ordinal)
            && string.Equals(stored.CropKey, attempted.CropKey, StringComparison.Ordinal)
            && string.Equals(stored.Stage, attempted.Stage, StringComparison.Ordinal)
            // spec: plr-d10 lane SCH-OWN-c - whose it is and what it was made for are part of the request too.
            && string.Equals(stored.Variety, attempted.Variety, StringComparison.Ordinal)
            && string.Equals(stored.SoilType, attempted.SoilType, StringComparison.Ordinal)
            && string.Equals(stored.Region, attempted.Region, StringComparison.Ordinal)
            && string.Equals(stored.Climate, attempted.Climate, StringComparison.Ordinal)
            && stored.Stages.SequenceEqual(attempted.Stages)
            && WorksOf(stored).SequenceEqual(WorksOf(attempted));
    }

    private static IEnumerable<string> WorksOf(ScheduleTemplate t) =>
        t.Activities
            .Select(a => string.Join(
                "|", a.ActivityName, a.Part, a.OffsetDays, a.EndDay, a.StoredFrequencyMode, a.StoredIntervalDays, a.OperationKey, a.Role, a.NutrientKey))
            .OrderBy(s => s, StringComparer.Ordinal);
}
