namespace ShramSafal.Domain.Dfes;

/// <summary>
/// DFES — the ONE rule that maps between a UTC instant and the farmer's local day.
///
/// <para><b>Why it is a type and not a constant repeated per caller.</b> Three places now
/// have to agree on which day an instant belongs to: the derivation service (which day is
/// "today" for the client-date sanity check), the question handler (which day did the
/// farmer just answer for), and the repository (which rows are that day's question
/// events). If any one of them drifted, an answer would credit a DIFFERENT day than the
/// one whose score the farmer is watching — he would answer, the number would not move,
/// and the loop this all exists to create would be broken by an off-by-one. One clock,
/// one rule.</para>
///
/// <para>Asia/Kolkata is a fixed +05:30 offset with no DST, so the conversion is exact
/// arithmetic and needs no host TZ database — which is why this can be a pure Domain type
/// with no dependencies.</para>
/// </summary>
public static class FarmLocalDay
{
    /// <summary>Asia/Kolkata — fixed +05:30, no DST.</summary>
    public static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);

    /// <summary>The farmer-local date a UTC instant falls on.</summary>
    public static DateOnly From(DateTime utcInstant) => DateOnly.FromDateTime(utcInstant + IstOffset);

    /// <summary>
    /// The half-open UTC window <c>[StartUtc, EndUtcExclusive)</c> covering
    /// <paramref name="localDate"/> — the exact inverse of <see cref="From"/>, so an
    /// instant is inside the window if and only if <c>From(instant) == localDate</c>.
    /// Both ends carry <see cref="DateTimeKind.Utc"/> because the columns they are
    /// compared against are <c>timestamp with time zone</c>.
    /// </summary>
    public static (DateTime StartUtc, DateTime EndUtcExclusive) UtcWindow(DateOnly localDate)
    {
        var startUtc = localDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc) - IstOffset;
        return (startUtc, startUtc.AddDays(1));
    }
}
