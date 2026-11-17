using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Pictures;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Pictures;

/// <summary>
/// spec: plr-d10 lane SCH-ID-S (founder D-146; P6, E4) - WHOSE picture a set or a remove is about, and whether the caller may touch it.
/// One rule for both doors, so they cannot drift (<see cref="PicturePolicy"/> holds the pure part):
/// <list type="bullet">
/// <item><b>PERSON</b>: the subject is always the caller. There is no way to name another person.</item>
/// <item><b>SCHEDULE</b>: the id may be any version of the chain; the subject is its ROOT. A schedule he may not see answers NotFound
/// (like an unknown id); one he may see but does not own (a co-owner, a mukadam, a worker who typed a version) answers Forbidden.
/// Never for an outside (Public) schedule.</item>
/// <item><b>INSTITUTION</b>: staff only (<c>ModuleKey.ScheduleReview</c>, write), asked BEFORE anything about the schedule is learned;
/// the schedule must be an outside (Public) one, a root.</item>
/// </list>
/// </summary>
internal static class PictureSubject
{
    public static async Task<Result<(Guid SubjectId, string ActorRole)>> ResolveAsync(
        PictureKind kind,
        Guid? routeId,
        Guid callerUserId,
        IShramSafalRepository repository,
        IEntitlementResolver? entitlements,
        CancellationToken ct)
    {
        switch (kind)
        {
            case PictureKind.Person:
                return PicturePolicy.MaySetPerson(callerUserId, callerUserId)
                    ? Result.Success((callerUserId, "self"))
                    : Result.Failure<(Guid, string)>(ShramSafalErrors.PictureForbidden);

            case PictureKind.Schedule:
                {
                    if (routeId is not { } scheduleId || scheduleId == Guid.Empty
                        || await repository.GetScheduleTemplateByIdAsync(scheduleId, ct) is not { } row)
                    {
                        return Result.Failure<(Guid, string)>(ShramSafalErrors.ScheduleTemplateNotFound);
                    }

                    var root = await ScheduleChainRoot.FindAsync(repository, row, ct);
                    var viewer = new ScheduleViewer(repository, callerUserId, [row, root]);
                    if (!await viewer.MaySeeAsync(root, ct))
                    {
                        return Result.Failure<(Guid, string)>(ShramSafalErrors.ScheduleTemplateNotFound);
                    }

                    var owner = await viewer.OwnerOfAsync(root, ct);
                    return PicturePolicy.MaySetSchedule(callerUserId, owner, root.TenantScope == TenantScope.Public)
                        ? Result.Success((root.Id, "schedule_owner"))
                        : Result.Failure<(Guid, string)>(ShramSafalErrors.PictureForbidden);
                }

            case PictureKind.Institution:
                {
                    var staff = entitlements is not null
                        && callerUserId != Guid.Empty
                        && await entitlements.MayCheckSchedulesAsync(new UserId(callerUserId), ct);
                    if (!staff)
                    {
                        return Result.Failure<(Guid, string)>(ShramSafalErrors.PictureForbidden);
                    }

                    if (routeId is not { } id || id == Guid.Empty
                        || await repository.GetScheduleTemplateByIdAsync(id, ct) is not { } row)
                    {
                        return Result.Failure<(Guid, string)>(ShramSafalErrors.ScheduleTemplateNotFound);
                    }

                    // A logo hangs on the root of an outside schedule. A Public row has no previous version; one that did would hang its
                    // logo where the pull (which sees no previous id on a Public row) would never look, so it is refused.
                    return PicturePolicy.MaySetInstitution(true, row.TenantScope == TenantScope.Public) && row.PreviousVersionId is null
                        ? Result.Success((row.Id, "platform_staff"))
                        : Result.Failure<(Guid, string)>(ShramSafalErrors.PictureForbidden);
                }

            default:
                return Result.Failure<(Guid, string)>(ShramSafalErrors.InvalidCommand);
        }
    }
}
