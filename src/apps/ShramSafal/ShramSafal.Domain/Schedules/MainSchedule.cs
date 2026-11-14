using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Schedules;

/// <summary>
/// spec: plr-d10 lane L8b-3 (R6, D-76) - what the pick needs to know about the schedule a subscription follows: who it comes from and
/// whether ShramSafal's check says "Checked" NOW (a withdrawal changes it, never the subscription - R8). <c>null</c> facts, or a
/// <c>null</c> owner type (a built-in sample carries none), mean "not known": never assumed to be an Institution (P4).
/// <para>spec: plr-d10 lane CMP-OWN - and what makes it his OWN plan: <see cref="Scope"/> and <see cref="OwnerUserId"/> (the row's
/// <c>owner_user_id</c> COLUMN, D-136; <c>null</c> on a built-in sample, a Public row and every row made before SCH-OWN) and whether it
/// <see cref="HasStages"/> (it stores its days and at least one stage: the stages the compare counts against). All three default to "not
/// known" so every older construction means what it always did.</para>
/// </summary>
public sealed record MainScheduleFacts(
    ScheduleOwnerType? OwnerType,
    bool IsCheckedNow,
    TenantScope? Scope = null,
    Guid? OwnerUserId = null,
    bool HasStages = false);

/// <summary>
/// spec: plr-d10 lane L8b-3 (R6, D-76) - which of the schedules a plot-season follows is the मुख्य (main) one, the one its stage
/// line, tabs and header follow. In order:
/// <list type="number">
/// <item>spec: plr-d10 lane CMP-OWN (founder ticked compare v4: his own plan is primary) - the followed schedule that is HIS OWN (its
/// <c>owner_user_id</c> equals the plot farm's owner, a Team row: <see cref="FollowableOnPlot.Classify"/>) AND stores stages; several: the
/// lowest place. A blank own schedule (no stages) never takes this place;</item>
/// <item>the followed schedule that is CHECKED now and whose owner type is Institution (government / agricultural university);
/// several: the lowest place;</item>
/// <item>else the lowest outside place;</item>
/// <item>else his own;</item>
/// <item>none followed: <c>null</c>.</item>
/// </list>
/// Pure: it reads only the subscriptions it is given (Active ones - any other state is ignored), the facts it is asked for and the owner of the
/// plot's farm (REQUIRED, so a door cannot forget it; <c>null</c> or <c>Guid.Empty</c> = not known: nothing is then his own).
/// </summary>
public static class MainSchedule
{
    public static ScheduleSubscription? Pick(
        IReadOnlyList<ScheduleSubscription> active,
        Func<ScheduleTemplateId, MainScheduleFacts?> factsOf,
        Guid? plotFarmOwnerUserId)
    {
        ArgumentNullException.ThrowIfNull(active);
        ArgumentNullException.ThrowIfNull(factsOf);

        var followed = active.Where(s => s.State == ScheduleSubscriptionState.Active).ToList();
        if (followed.Count == 0)
        {
            return null;
        }

        var own = followed
            .Where(s => IsOwnWithStages(factsOf(s.ScheduleTemplateId), plotFarmOwnerUserId ?? Guid.Empty))
            .OrderBy(InPlaceOrder)
            .FirstOrDefault();
        if (own is not null)
        {
            return own;
        }

        var institution = followed
            .Where(s => factsOf(s.ScheduleTemplateId) is { OwnerType: ScheduleOwnerType.Institution, IsCheckedNow: true })
            .OrderBy(InPlaceOrder)
            .FirstOrDefault();
        if (institution is not null)
        {
            return institution;
        }

        // A row chosen before this lane has no origin and reads as Outside (L8b-1F).
        var outside = followed.Where(s => s.Origin != ScheduleOrigin.Own).OrderBy(InPlaceOrder).FirstOrDefault();
        return outside ?? followed.OrderBy(InPlaceOrder).First();
    }

    /// <summary>
    /// His own plan: the schedule's owner COLUMN names the owner of this plot's farm on a Team row (the one rule adopt uses,
    /// <see cref="FollowableOnPlot.Classify"/>; the subscription's own origin is how the row was CHOSEN and is not read here), and it stores stages.
    /// </summary>
    private static bool IsOwnWithStages(MainScheduleFacts? facts, Guid plotFarmOwnerUserId) =>
        facts is { HasStages: true, Scope: { } scope, OwnerUserId: { } scheduleOwner }
        && FollowableOnPlot.Classify(scope, ownerUserId: null, isBuiltIn: false, plotFarmOwnerUserId, scheduleOwner) == ScheduleOrigin.Own;

    /// <summary>Lowest place first; a row with no place (made by a binary that sets none) after those with one; then oldest, then id.</summary>
    private static (int, DateTime, Guid) InPlaceOrder(ScheduleSubscription s) =>
        (s.Slot is { } slot ? slot : int.MaxValue, s.AdoptedAtUtc, s.Id);
}
