using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Schedules;

/// <summary>
/// spec: plr-d10 lane L8b-3 (R6, D-76) - what the pick needs to know about the schedule a subscription follows: who it comes from and
/// whether ShramSafal's check says "Checked" NOW (a withdrawal changes it, never the subscription - R8). <c>null</c> facts, or a
/// <c>null</c> owner type (a built-in sample carries none), mean "not known": never assumed to be an Institution (P4).
/// </summary>
public sealed record MainScheduleFacts(ScheduleOwnerType? OwnerType, bool IsCheckedNow);

/// <summary>
/// spec: plr-d10 lane L8b-3 (R6, D-76) - which of the schedules a plot-season follows is the मुख्य (main) one, the one its stage
/// line, tabs and header follow. In order:
/// <list type="number">
/// <item>the followed schedule that is CHECKED now and whose owner type is Institution (government / agricultural university);
/// several: the lowest place;</item>
/// <item>else the lowest outside place;</item>
/// <item>else his own;</item>
/// <item>none followed: <c>null</c>.</item>
/// </list>
/// Pure: it reads only the subscriptions it is given (Active ones - any other state is ignored) and the facts it is asked for.
/// </summary>
public static class MainSchedule
{
    public static ScheduleSubscription? Pick(
        IReadOnlyList<ScheduleSubscription> active,
        Func<ScheduleTemplateId, MainScheduleFacts?> factsOf)
    {
        ArgumentNullException.ThrowIfNull(active);
        ArgumentNullException.ThrowIfNull(factsOf);

        var followed = active.Where(s => s.State == ScheduleSubscriptionState.Active).ToList();
        if (followed.Count == 0)
        {
            return null;
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

    /// <summary>Lowest place first; a row with no place (made by a binary that sets none) after those with one; then oldest, then id.</summary>
    private static (int, DateTime, Guid) InPlaceOrder(ScheduleSubscription s) =>
        (s.Slot is { } slot ? slot : int.MaxValue, s.AdoptedAtUtc, s.Id);
}
