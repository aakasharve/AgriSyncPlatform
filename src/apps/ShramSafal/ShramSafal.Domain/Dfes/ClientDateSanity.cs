namespace ShramSafal.Domain.Dfes;

/// <summary>Sanity-checks the client-supplied LocalDate against server "today".
/// A device clock set far ahead (or an absurdly old backfill) must not mint a
/// bogus rich day — an implausible date routes the classifier to
/// PendingReconciliation. Forward grace absorbs timezone/clock skew.</summary>
public static class ClientDateSanity
{
    private const int ForwardGraceDays = 1;   // device just over midnight / TZ skew
    private const int BackfillYears = 2;       // reasonable historical backfill window

    public static bool IsPlausible(DateOnly localDate, DateOnly serverTodayLocal)
        => localDate <= serverTodayLocal.AddDays(ForwardGraceDays)
           && localDate >= serverTodayLocal.AddYears(-BackfillYears);
}
