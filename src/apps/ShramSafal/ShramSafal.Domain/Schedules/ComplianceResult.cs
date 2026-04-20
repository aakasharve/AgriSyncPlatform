using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Schedules;

public sealed record ComplianceResult(
    ScheduleSubscriptionId? SubscriptionId,
    PrescribedTaskId? MatchedTaskId,
    int? DeltaDays,
    ComplianceOutcome Outcome)
{
    public static ComplianceResult Unscheduled() =>
        new(null, null, null, ComplianceOutcome.Unscheduled);

    public static ComplianceResult Matched(
        ScheduleSubscriptionId subscriptionId,
        PrescribedTaskId matchedTaskId,
        int deltaDays,
        int toleranceDaysPlusMinus)
    {
        if (toleranceDaysPlusMinus < 0)
        {
            throw new ArgumentException("Tolerance days must be non-negative.", nameof(toleranceDaysPlusMinus));
        }

        var outcome = deltaDays switch
        {
            var d when d < -toleranceDaysPlusMinus => ComplianceOutcome.Early,
            var d when d > toleranceDaysPlusMinus => ComplianceOutcome.Late,
            _ => ComplianceOutcome.OnTime,
        };

        return new ComplianceResult(subscriptionId, matchedTaskId, deltaDays, outcome);
    }
}
