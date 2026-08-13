namespace ShramSafal.Domain.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Slice 3a). Rolls the day's scored dimensions
/// (<see cref="LensInput"/>) UP into the single farmer-facing "Day Understanding
/// Score" — an <c>int?</c> on a 0–10 scale, framed as the ASSISTANT's
/// understanding of the day (blame-the-app).
///
/// <para><b>Formula — completeness against a FIXED denominator.</b> Let R be the
/// day's completeness roster (<see cref="LensInput.Possible"/>): every dimension
/// that COULD apply to the work actually present in the day, across all three
/// lenses, whether or not the farmer said anything about it.
/// <list type="bullet">
///   <item><c>possible = Σ_{d ∈ R, d.Applicable} d.Weight</c></item>
///   <item><c>covered  = Σ_{d ∈ R, d.Applicable} d.Weight · d.Coverage · d.ConfidenceFactor</c></item>
///   <item><c>possible == 0</c> → <c>null</c> (nothing scorable; no number shown — NEVER a zero).</item>
///   <item>otherwise → <c>Clamp( Round( 10 · covered / possible ), 0, 10 )</c> with
///         <see cref="MidpointRounding.AwayFromZero"/>.</item>
/// </list></para>
///
/// <para><b>Why the denominator is fixed (the defect this replaces).</b> The
/// previous rollup was the arithmetic MEAN over whichever lenses happened to be
/// applicable. That made the number NON-MONOTONIC: a day scoring
/// mean(Execution 48, Insight 100) = 74 → 7 FELL to mean(48, 100, 40) = 63 → 6 the
/// moment the farmer answered Sathi's question and introduced a third, weaker
/// lens. The screen promises "tell me this and the number goes up"; the engine
/// could make that a lie. Holding the denominator fixed makes the score a
/// completeness ratio, so ADDING coverage on any dimension can only ever raise it
/// (see the monotonicity tests). Lower number = fewer details shared; higher
/// number = more details shared, pulled across ALL THREE lenses because they share
/// ONE denominator.</para>
///
/// <para><b>No fabricated denominator (project doctrine).</b> A dimension that
/// genuinely cannot apply to the operations performed — a pesticide DOSE on a day
/// the farmer only irrigated — carries <see cref="ScoredDimension.Applicable"/> =
/// false and is excluded from BOTH <c>covered</c> and <c>possible</c>. The farmer
/// is never charged for failing to describe work he did not do.</para>
///
/// <para><b>Legacy rows.</b> A row stamped by an engine that predates the roster
/// deserializes with <see cref="LensInput.Possible"/> null/empty. Rather than
/// invent a denominator for it, the union of the three lens lists is used — i.e.
/// it is scored on exactly what that engine recorded. New rows carry the roster.</para>
///
/// <para>The <c>/10</c> is the ONLY value that ever crosses to the client — the
/// three lens scores stay 100% server-internal. The score is DERIVED on read (no
/// new persisted column) so it always reflects the current engine.</para>
///
/// <para>Pure Domain type: no I/O, no serialization. Tied to
/// <see cref="DfesTuning.ScoreEngineVersion"/> via <see cref="Version"/> so a
/// rollup change is traceable alongside the lens engine that produced its inputs.</para>
/// </summary>
public static class DayUnderstandingScore
{
    /// <summary>Ties this rollup to the lens engine that produced its inputs.</summary>
    public const string Version = DfesTuning.ScoreEngineVersion;

    /// <summary>Lower bound of the farmer-facing 0–10 scale.</summary>
    public const int MinScore = 0;

    /// <summary>Upper bound of the farmer-facing 0–10 scale.</summary>
    public const int MaxScore = 10;

    /// <summary>
    /// Roll the day's scored dimensions up into the 0–10 Day Understanding Score,
    /// or <c>null</c> when no dimension applied. See the type remarks for the exact
    /// formula + rationale.
    /// </summary>
    public static int? From(LensInput input)
    {
        ArgumentNullException.ThrowIfNull(input);

        double covered = 0, possible = 0;
        foreach (var d in Roster(input))
        {
            if (!d.Applicable)
            {
                continue; // cannot apply to this day's work → out of BOTH sums
            }

            // Defensive clamps: ComponentsJson is now read back from storage, so a
            // corrupt/hand-edited row must not be able to push the ratio out of range.
            // Clamping is monotone non-decreasing, so it cannot break the guarantee.
            possible += d.Weight;
            covered += d.Weight * Math.Clamp(d.Coverage, 0.0, 1.0) * Math.Clamp(d.ConfidenceFactor, 0.0, 1.0);
        }

        if (possible <= 0)
        {
            return null; // no applicable dimension → no score (never a zero)
        }

        var rounded = (int)Math.Round(MaxScore * covered / possible, MidpointRounding.AwayFromZero);
        return Math.Clamp(rounded, MinScore, MaxScore); // defensive clamp
    }

    // The completeness roster, or — for a row written before the roster existed —
    // the union of the three lens lists (score what was recorded; invent nothing).
    private static IEnumerable<ScoredDimension> Roster(LensInput input)
        => input.Possible is { Count: > 0 } roster
            ? roster
            : Safe(input.Execution).Concat(Safe(input.Insight)).Concat(Safe(input.Learning));

    // Deserialized rows can hand back nulls for absent JSON members.
    private static IReadOnlyList<ScoredDimension> Safe(IReadOnlyList<ScoredDimension>? dims) => dims ?? [];
}
