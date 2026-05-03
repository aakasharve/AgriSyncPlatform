namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Mode B response root for <c>GET /admin/farmer-health/cohort</c>.
/// Aggregates DWC v2 metrics across every farm in the caller's
/// <c>AdminScope</c> for the current ISO week. Field shapes mirror
/// <c>UI_DESIGN_BRIEF_GEMINI.md</c> §2 (TypeScript).
/// </summary>
/// <remarks>
/// <para>
/// All collections are bounded so a single response stays under the
/// 1500ms p95 budget (per DWC v2 §3.9):
/// </para>
/// <list type="bullet">
/// <item><see cref="InterventionQueue"/> — capped at 50 rows.</item>
/// <item><see cref="Watchlist"/> — capped at 100 rows.</item>
/// <item><see cref="FarmerSufferingTop10"/> — capped at 10 rows.</item>
/// </list>
/// <para>
/// <see cref="ScoreDistribution"/> emits 10-point buckets
/// (<c>0-10</c>, <c>11-20</c>, …, <c>91-100</c>) so the histogram has
/// a fixed 10-bin shape regardless of farm count.
/// </para>
/// </remarks>
public sealed record CohortPatternsDto(
    IReadOnlyList<CohortScoreBinDto> ScoreDistribution,
    IReadOnlyList<CohortBucketDto> InterventionQueue,
    IReadOnlyList<CohortBucketDto> Watchlist,
    IReadOnlyList<CohortEngagementTierDto> EngagementTierBreakdown,
    IReadOnlyList<CohortPillarHeatmapDto> PillarHeatmap,
    IReadOnlyList<CohortWeeklyTrendDto> TrendByWeek,
    IReadOnlyList<CohortFarmerSufferingDto> FarmerSufferingTop10);
