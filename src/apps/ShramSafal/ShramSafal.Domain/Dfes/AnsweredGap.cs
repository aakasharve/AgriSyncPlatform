namespace ShramSafal.Domain.Dfes;

/// <summary>
/// DFES — one gap dimension the farmer explicitly answered on a given day.
/// <para>Founder ruling A (2026-08-14): answering Sathi's question must raise the
/// day's score. Without this, a farmer answers, watches the number stay still, and
/// stops answering — which costs the daily loop the habit it is built to create.</para>
/// <para>This is a FACT THE FARMER SUPPLIED, never an inference. It is created only
/// from a gap question — keyed <c>gap.&lt;dimension&gt;</c> in lower case by the client
/// bank — whose response actually carries content. A skip, or a bare acknowledgement
/// with no text, yields nothing, so silence can never score (doctrine P4).</para>
/// <para>Consumed by <see cref="DfesLensExtractor"/>, which credits the named dimension
/// at that dimension's own weight and only when the day has not already earned it —
/// answering is a second route to the same point, never a bonus on top of one.</para>
/// </summary>
/// <param name="Dimension">
/// The gap dimension in UPPER case (WHAT, DOSE, SCOPE, CARRIER, COST, WEATHER,
/// PURPOSE, CONTINUITY), matching the extractor's dimension names.
/// </param>
/// <param name="LocalDate">The farmer-local day the answer belongs to.</param>
public sealed record AnsweredGap(string Dimension, DateOnly LocalDate)
{
    /// <summary>Client bank prefix for a gap question (dfesQuestionBank.ts).</summary>
    private const string GapPrefix = "gap.";

    /// <summary>
    /// Parse a recorded question event into an <see cref="AnsweredGap"/>.
    /// Returns <c>false</c> — crediting nothing — for any key that is not a gap
    /// question, and for any answer that carries no content.
    /// </summary>
    public static bool TryFrom(
        string questionKey,
        string? response,
        DateOnly localDate,
        out AnsweredGap gap)
    {
        gap = null!;

        // An empty answer is silence. Silence never scores.
        if (string.IsNullOrWhiteSpace(response)) return false;
        if (string.IsNullOrWhiteSpace(questionKey)) return false;

        // Only gap questions name a dimension. safety.*, weather.*, stage.*,
        // schedule.*, followup.* and learning.* are real questions worth asking,
        // but answering them does not fill a gap in the day's record.
        if (!questionKey.StartsWith(GapPrefix, StringComparison.OrdinalIgnoreCase)) return false;

        var dimension = questionKey[GapPrefix.Length..].Trim();
        if (dimension.Length == 0) return false;

        // The bank lower-cases the dimension into the key; the extractor names it
        // in upper case. Normalise here so neither side has to know about the other.
        gap = new AnsweredGap(dimension.ToUpperInvariant(), localDate);
        return true;
    }
}
