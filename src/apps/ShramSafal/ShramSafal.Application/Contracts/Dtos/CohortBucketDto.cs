namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// One row in the Mode B intervention queue (cap 50) or watchlist
/// (cap 100). Both lists share the same shape — the <see cref="Bucket"/>
/// field on the parent <see cref="CohortPatternsDto"/> distinguishes
/// them.
/// </summary>
/// <remarks>
/// <para>
/// Sourced from <c>mis.dwc_score_per_farm_week</c> filtered to the
/// current ISO week and the relevant <c>bucket</c> classification.
/// Joined to <c>ssf.farms</c> for the canonical farm name (subject to
/// the redactor's <c>FarmerHealth</c> module policy).
/// </para>
/// <para>
/// <see cref="WeeklyDelta"/> is the score change versus the prior ISO
/// week; positive numbers = improvement.
/// </para>
/// </remarks>
public sealed record CohortBucketDto(
    Guid FarmId,
    string FarmerName,
    int Score,
    int WeeklyDelta,
    DateTime LastActiveAt);

/// <summary>One bin of the score distribution histogram (10-point buckets).</summary>
public sealed record CohortScoreBinDto(string Bucket, int Count);

/// <summary>One row of the engagement-tier breakdown donut.</summary>
public sealed record CohortEngagementTierDto(string Tier, int Count);

/// <summary>
/// One row of the pillar heatmap — average pillar score across all
/// farms in the current week, plus a count of farms where the pillar
/// is &lt; 50% of its weight (i.e. the "failing" cohort).
/// </summary>
public sealed record CohortPillarHeatmapDto(
    string Pillar,
    decimal AvgScore,
    int FailingFarmsCount);

/// <summary>One point on the 8-week trend line.</summary>
public sealed record CohortWeeklyTrendDto(
    DateOnly WeekStart,
    decimal AvgScore,
    int FarmCount);

/// <summary>
/// One row of the farmer-suffering top-10 list. Reuses the existing
/// <c>mis.farmer_suffering_watchlist</c> matview (per DWC v2 §3.5
/// Step 2) — same farmId space as <see cref="CohortBucketDto"/>.
/// </summary>
/// <remarks>
/// <see cref="FarmerName"/> is gated by <c>pii:read</c> per the
/// redaction matrix.
/// </remarks>
public sealed record CohortFarmerSufferingDto(
    Guid FarmId,
    string FarmerName,
    int ErrorCount7d,
    DateTime LastErrorAt);
