using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Schedules;

/// <summary>
/// spec: plr-d10 lane L8b-1F Task 3 (E4, R23) - what a plot may follow depends on the PLOT's farm, never on who is asking.
/// Pure: the Application side works out the facts (is the id a built-in, the row's scope, the row's OWNER through
/// <c>ScheduleViewer.OwnerOfAsync</c> - never the version's <c>created_by_user_id</c> - and the plot farm's owner) and passes them in.
/// <list type="bullet">
/// <item>a built-in id, or a <see cref="TenantScope.Public"/> row: <see cref="ScheduleOrigin.Outside"/>;</item>
/// <item>a <see cref="TenantScope.Team"/> row whose owner is THIS plot's farm owner: <see cref="ScheduleOrigin.Own"/>;</item>
/// <item>anything else (another farm's Team row, any Private row - his own included - and Licensed, which does not exist yet):
/// <c>null</c>, which the handler answers exactly like an unknown id.</item>
/// </list>
/// </summary>
public static class FollowableOnPlot
{
    public static ScheduleOrigin? Classify(TenantScope scope, Guid? ownerUserId, bool isBuiltIn, Guid plotFarmOwnerUserId)
    {
        if (isBuiltIn || scope == TenantScope.Public)
        {
            return ScheduleOrigin.Outside;
        }

        if (scope == TenantScope.Team
            && ownerUserId is { } owner
            && owner != Guid.Empty
            && plotFarmOwnerUserId != Guid.Empty
            && owner == plotFarmOwnerUserId)
        {
            return ScheduleOrigin.Own;
        }

        return null;
    }
}
