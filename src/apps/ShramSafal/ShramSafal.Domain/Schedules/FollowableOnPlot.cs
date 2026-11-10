using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Schedules;

/// <summary>
/// spec: plr-d10 lane L8b-1F Task 3 (E4, R23) - what a plot may follow depends on the PLOT's farm's OWNER, never on who is asking.
/// Pure: the Application side works out the facts (is the id a built-in, the row's scope, the row's derived OWNER through
/// <c>ScheduleViewer.OwnerOfAsync</c> - never the version's <c>created_by_user_id</c> -, the plot farm's owner, and the row's own
/// <c>owner_user_id</c> COLUMN) and passes them in.
/// <list type="bullet">
/// <item>a built-in id, or a <see cref="TenantScope.Public"/> row: <see cref="ScheduleOrigin.Outside"/>;</item>
/// <item>spec: plr-d10 lane SCH-OWN-c (founder D-133 withdrawn, D-137; F218, F222) - a row whose <c>owner_user_id</c> is set
/// (<paramref name="scheduleOwnerUserId"/>, the COLUMN, never the derived owner) belongs to that PERSON: it is <see cref="ScheduleOrigin.Own"/> on a
/// plot of ANY farm he owns (the plot farm's <c>owner_user_id</c> equals it, read at call time) and only when Team; <c>null</c> on another owner's
/// farm - so after a transfer of the farm the new owner's plot cannot follow it afresh (the plot that already follows it keeps its version: that is
/// the subscription's);</item>
/// <item>a <see cref="TenantScope.Team"/> row with NO owner (every row made before SCH-OWN, every plain copy) whose derived owner is THIS plot's farm
/// owner: <see cref="ScheduleOrigin.Own"/> - this is only the RECOGNITION of his team's row (R23, so the handler answers it as x1 did, not "not
/// found"). F218: it is NEVER followable; the Application layer answers <c>OwnScheduleNotOpenYet</c> and keeps it closed to the planning gate;</item>
/// <item>anything else (another owner's Team row, any Private row - his own included - and Licensed, which does not exist yet):
/// <c>null</c>, which the handler answers exactly like an unknown id.</item>
/// </list>
/// </summary>
public static class FollowableOnPlot
{
    public static ScheduleOrigin? Classify(
        TenantScope scope, Guid? ownerUserId, bool isBuiltIn, Guid plotFarmOwnerUserId, Guid? scheduleOwnerUserId = null)
    {
        if (isBuiltIn || scope == TenantScope.Public)
        {
            return ScheduleOrigin.Outside;
        }

        if (scheduleOwnerUserId is { } scheduleOwner)
        {
            return scope == TenantScope.Team && scheduleOwner != Guid.Empty && plotFarmOwnerUserId != Guid.Empty && scheduleOwner == plotFarmOwnerUserId
                ? ScheduleOrigin.Own
                : null;
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
