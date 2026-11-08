using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

/// <summary>
/// spec: plr-d10 lane L8b-2 (founder D-32) - the cursor rule of the pull's <c>scheduleSubscriptions</c> key. A choice has two
/// clocks (adopted, and the last change of its state) and moves no plot's or season's clock, so nothing else would carry the
/// cursor past a choice that was just sent.
/// </summary>
internal static class PullScheduleSubscriptions
{
    /// <summary>The later of a subscription's two clocks: when it was last made or changed.</summary>
    internal static DateTime ChangedAt(ScheduleSubscription subscription) =>
        subscription.StateChangedAtUtc is { } changed && changed > subscription.AdoptedAtUtc
            ? changed
            : subscription.AdoptedAtUtc;

    /// <summary>The cursor after these rows: at least where it was, and the newest change sent when that is later.</summary>
    internal static DateTime AdvanceCursor(DateTime cursor, IReadOnlyCollection<ScheduleSubscription> sent) =>
        sent.Count > 0 && sent.Max(ChangedAt) is var newest && newest > cursor ? newest : cursor;
}
