namespace ShramSafal.Application.UseCases.Labour.GetLabourData;

/// <summary>
/// Task 9 (spec: 2026-08-28-labour-v2-release-1) — the labour dashboard's
/// adjustable time window, resolved to a half-open-free INCLUSIVE range of
/// farmer-local calendar dates.
///
/// <para><b>Why calendar dates and not UTC instants.</b> Every column this
/// window is compared against is already a farm-local <c>DateOnly</c>:
/// <c>DailyLog.LogDate</c>, <c>CostEntry.EntryDate</c>,
/// <c>JobCard.PlannedDate</c>. The timezone question therefore arises exactly
/// ONCE — deciding which local date "now" is — and it is answered by
/// <see cref="ShramSafal.Domain.Dfes.FarmLocalDay"/> at the single call site in
/// <see cref="GetLabourDataHandler"/>, never re-derived here. This type does no
/// timezone arithmetic at all, which is why it cannot drift from that rule.</para>
///
/// <para><b>Why there is an upper bound.</b> The read it replaces was
/// <c>log.LogDate &gt;= weekStart</c> with no upper bound at all, so a day
/// dated ahead of today — a mis-keyed date, a device clock running fast —
/// counted inside "this week". A window the farmer reads as a statement about
/// elapsed time must not include days that have not happened, so
/// <c>today</c>/<c>week</c>/<c>month</c> all end at today, inclusive.
/// <see cref="AllTime"/> is the deliberate exception: it is "everything on
/// record", and silently dropping a future-dated row would make it disagree
/// with the raw ledgers it is meant to total.</para>
/// </summary>
/// <param name="FromDate">Inclusive lower bound; <c>null</c> means unbounded.</param>
/// <param name="ToDateInclusive">Inclusive upper bound; <c>null</c> means unbounded.</param>
public sealed record LabourTimeWindow(DateOnly? FromDate, DateOnly? ToDateInclusive)
{
    /// <summary>आजपर्यंत — everything on record. The founder-chosen DEFAULT.</summary>
    public const string AllTime = "alltime";

    /// <summary>आज — the farmer's local today.</summary>
    public const string Today = "today";

    /// <summary>हा आठवडा — Monday-anchored, matching Postgres <c>date_trunc('week', …)</c> used by analytics.</summary>
    public const string Week = "week";

    /// <summary>हा महिना — from the 1st of the farmer's local month.</summary>
    public const string Month = "month";

    /// <summary>Everything on record: no lower bound, no upper bound.</summary>
    public static LabourTimeWindow Unbounded { get; } = new(null, null);

    /// <summary>Whether a farm-local calendar date falls inside this window.</summary>
    public bool Contains(DateOnly date) =>
        (FromDate is null || date >= FromDate.Value)
        && (ToDateInclusive is null || date <= ToDateInclusive.Value);

    /// <summary>
    /// Resolves the wire value to a date range, or <c>null</c> if it is not one
    /// of the four windows.
    ///
    /// <para>Returning <c>null</c> for an unrecognised value — rather than
    /// quietly falling back to all-time — is deliberate and mirrors
    /// <c>GetFinanceSummaryHandler.NormalizeGroupBy</c>: answering a question
    /// the caller did not ask, under a heading that says otherwise, is the
    /// exact class of defect this task exists to remove. An OMITTED window
    /// (<c>null</c>, empty, or whitespace) is a different thing entirely — it
    /// is a client that predates the parameter, and it gets the default.</para>
    /// </summary>
    /// <param name="window">The raw wire value, or <c>null</c> when the caller sent none.</param>
    /// <param name="farmLocalToday">
    /// Today's date IN THE FARMER'S TIMEZONE — the caller resolves it via
    /// <c>FarmLocalDay.From(clock.UtcNow)</c>. Passed in rather than read from a
    /// clock here so this type stays pure and the one IST rule keeps one owner.
    /// </param>
    public static LabourTimeWindow? Resolve(string? window, DateOnly farmLocalToday)
    {
        var normalized = (window ?? string.Empty).Trim().ToLowerInvariant();
        if (normalized.Length == 0)
        {
            normalized = AllTime;
        }

        return normalized switch
        {
            AllTime => Unbounded,
            Today => new LabourTimeWindow(farmLocalToday, farmLocalToday),
            Week => new LabourTimeWindow(StartOfWeek(farmLocalToday), farmLocalToday),
            Month => new LabourTimeWindow(new DateOnly(farmLocalToday.Year, farmLocalToday.Month, 1), farmLocalToday),
            _ => null
        };
    }

    /// <summary>
    /// Monday-anchored, kept from the code this replaces because it matches the
    /// Postgres <c>date_trunc('week', …)</c> the analytics side buckets on — the
    /// two must agree or the same farmer's week means two different spans on
    /// two screens.
    /// </summary>
    private static DateOnly StartOfWeek(DateOnly date)
        => date.AddDays(-(((int)date.DayOfWeek + 6) % 7)); // Sunday=0..Saturday=6 -> Monday-anchored offset.
}
