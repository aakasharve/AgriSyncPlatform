namespace ShramSafal.Domain.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Slice 3a). Rolls the three INTERNAL lens
/// scores (<see cref="LensScores"/>, each 0–100 or null) UP into the single
/// farmer-facing "Day Understanding Score" — an <c>int?</c> on a 0–10 scale,
/// framed as the ASSISTANT's understanding of the day (blame-the-app).
///
/// <para><b>Formula (founder-confirmable).</b> Let A = the set of APPLICABLE
/// lenses (the non-null members of {Execution, Insight, Learning}).
/// <list type="bullet">
///   <item>A is empty → <c>null</c> (the assistant understood nothing scorable; no number shown).</item>
///   <item>otherwise → <c>Clamp( Round( Mean(A) / 10 ), 0, 10 )</c>, where <c>Mean(A)</c>
///         is the arithmetic mean of the applicable lens scores (0–100) and
///         <c>Round</c> uses <see cref="MidpointRounding.AwayFromZero"/> (so an
///         exact .5 rounds UP — 45→4.5→5, 75→7.5→8).</item>
/// </list></para>
///
/// <para><b>Rationale — DFES "reward honest richness, don't punish a simple day".</b>
/// N/A (null) lenses are EXCLUDED from the mean; they are NEVER counted as 0. A
/// day with only one applicable lens is scored on that lens alone, so a
/// genuinely simple-but-honest day is not dragged down by lenses that never
/// applied. All-null means the assistant has nothing to score → no number
/// (blame-the-app: "I couldn't understand today"), NOT a zero.</para>
///
/// <para>The <c>/10</c> is the ONLY value that ever crosses to the client — the
/// three lenses stay 100% server-internal. The score is DERIVED on read (no new
/// persisted column) so it always reflects the current engine.</para>
///
/// <para>Pure Domain type: no I/O, no serialization. Tied to
/// <see cref="DfesTuning.ScoreEngineVersion"/> via <see cref="Version"/> so a
/// rollup change is traceable alongside the lens engine that produced its inputs.</para>
/// </summary>
public static class DayUnderstandingScore
{
    /// <summary>Ties this rollup to the lens engine that produced its inputs ("dfes-1").</summary>
    public const string Version = DfesTuning.ScoreEngineVersion;

    /// <summary>Lower bound of the farmer-facing 0–10 scale.</summary>
    public const int MinScore = 0;

    /// <summary>Upper bound of the farmer-facing 0–10 scale.</summary>
    public const int MaxScore = 10;

    /// <summary>
    /// Roll the three internal lens scores up into the 0–10 Day Understanding
    /// Score, or <c>null</c> when no lens applied. See the type remarks for the
    /// exact formula + rationale.
    /// </summary>
    public static int? From(LensScores lenses)
    {
        var sum = 0;
        var applicable = 0;

        if (lenses.ExecutionScore is { } e) { sum += e; applicable++; }
        if (lenses.InsightScore is { } i) { sum += i; applicable++; }
        if (lenses.LearningScore is { } l) { sum += l; applicable++; }

        if (applicable == 0)
        {
            return null; // no applicable lens → no score (never a zero)
        }

        var mean = (double)sum / applicable;                                     // 0–100
        var rounded = (int)Math.Round(mean / 10.0, MidpointRounding.AwayFromZero); // 0–10
        return Math.Clamp(rounded, MinScore, MaxScore);                          // defensive clamp
    }
}
