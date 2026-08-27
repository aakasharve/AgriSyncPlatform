namespace ShramSafal.Domain.Dfes;

/// <summary>One scored dimension row (mirrors a scoreVlog dimension). Weight is
/// an engine constant; Coverage ∈ {0, 0.5, 1}; ConfidenceFactor ∈ (0, 1].</summary>
public sealed record ScoredDimension(
    string Name, int Weight, bool Applicable, double Coverage, double ConfidenceFactor);

/// <summary>The scoreVlog dimensions re-bucketed into 3 lenses, as the extractor
/// actually implements them. Execution = {WHAT, COST, + DOSE/CARRIER when applicable}.
/// Insight = {WEATHER, + OBS_FACET structured-observation}. Learning = {LEARN_FACET}.
/// SCOPE is intentionally absent: the plot is context-selected up front, so it
/// does not count toward the server /10. A lens with no applicable dim scores
/// null (UNKNOWN), never 0.
///
/// <para><b><see cref="Possible"/> — the day's completeness roster.</b> The three
/// lens lists above are the CLASSIFIER's input and only ever carry a dimension the
/// farmer actually gave a signal for (an absent OBS_FACET / LEARN_FACET is simply
/// missing). That makes them the wrong denominator for a farmer-facing "how
/// completely did I understand your day" number: the denominator would shrink to
/// whatever he happened to mention, so mentioning MORE could score LESS.
/// <see cref="Possible"/> is the FIXED denominator — every dimension that COULD
/// apply to the work actually present in the day, covered or not, across all three
/// lenses. Dimensions that cannot apply to the operations performed (a pesticide
/// DOSE on an irrigation-only day) still appear here with
/// <see cref="ScoredDimension.Applicable"/> = false and are excluded from BOTH the
/// numerator and the denominator — the number is never charged against work the
/// farmer did not do. Consumed by <see cref="DayUnderstandingScore"/>; ignored by
/// <see cref="ThreeLensScorer"/>.</para>
///
/// <para>Optional (defaults to <c>null</c>) so rows serialized by an engine that
/// predates the roster still deserialize; see <see cref="DayUnderstandingScore"/>
/// for the legacy fallback.</para></summary>
public sealed record LensInput(
    IReadOnlyList<ScoredDimension> Execution,
    IReadOnlyList<ScoredDimension> Insight,
    IReadOnlyList<ScoredDimension> Learning,
    IReadOnlyList<ScoredDimension>? Possible = null);

/// <summary>The three lens scores (0–100 or null). ComponentsJson is built by the
/// Application layer from the LensInput; the Domain scorer stays serialization-free.</summary>
public readonly record struct LensScores(int? ExecutionScore, int? InsightScore, int? LearningScore);
