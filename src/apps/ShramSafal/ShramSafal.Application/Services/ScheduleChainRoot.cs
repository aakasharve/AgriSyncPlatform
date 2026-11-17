using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane SCH-ID-S - the ROOT of a schedule's edit chain (the first version, back along <c>previous_version_id</c>): the id a
/// SCHEDULE or INSTITUTION picture hangs on, so every later version shares it and a copy-on-write version copies nothing. The same walk
/// <see cref="ScheduleViewer.OwnerOfAsync"/> makes for whose schedule it is.
/// </summary>
public static class ScheduleChainRoot
{
    /// <summary>
    /// The first version of <paramref name="row"/>'s chain (the row itself when it has no previous version, or the chain is broken
    /// or loops - such a chain answers its last readable row, never throws).
    /// </summary>
    public static async Task<ScheduleTemplate> FindAsync(
        IShramSafalRepository repository, ScheduleTemplate row, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(row);
        var current = row;
        var walked = new HashSet<Guid> { row.Id };
        while (current.PreviousVersionId is { } previous && walked.Add(previous))
        {
            var before = await repository.GetScheduleTemplateByIdAsync(previous, ct);
            if (before is null)
            {
                break;
            }

            current = before;
        }

        return current;
    }
}
