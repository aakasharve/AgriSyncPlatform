namespace ShramSafal.Domain.Dfes;

/// <summary>One scored dimension row (mirrors a scoreVlog dimension). Weight is
/// an engine constant; Coverage ∈ {0, 0.5, 1}; ConfidenceFactor ∈ (0, 1].</summary>
public sealed record ScoredDimension(
    string Name, int Weight, bool Applicable, double Coverage, double ConfidenceFactor);

/// <summary>The scoreVlog dimensions re-bucketed into 3 lenses.
/// Execution = {WHAT, DOSE, CARRIER, COST}. Insight = {WEATHER, PURPOSE,
/// + structured-observation facet}. Learning = {CONTINUITY + learning facet}.
/// SCOPE is intentionally absent: the plot is context-selected up front, so it
/// does not count toward the server /10. A lens with no applicable dim scores
/// null (UNKNOWN), never 0.</summary>
public sealed record LensInput(
    IReadOnlyList<ScoredDimension> Execution,
    IReadOnlyList<ScoredDimension> Insight,
    IReadOnlyList<ScoredDimension> Learning);

/// <summary>The three lens scores (0–100 or null). ComponentsJson is built by the
/// Application layer from the LensInput; the Domain scorer stays serialization-free.</summary>
public readonly record struct LensScores(int? ExecutionScore, int? InsightScore, int? LearningScore);
