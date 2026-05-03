namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// DWC v2 score row mirrored from <c>mis.dwc_score_per_farm_week</c> for
/// the current ISO week of a single farm. Six pillar contributions sum
/// (with a 30-pt anti-gaming subtraction) to <see cref="Total"/>; the
/// matview also classifies the row into a <see cref="Bucket"/> and a
/// <see cref="Flag"/>.
/// </summary>
/// <remarks>
/// <para>
/// Sourced from <c>mis.dwc_score_per_farm_week</c> (one row per
/// <c>farm_id × week_start</c>). Pillar weights and clamps follow
/// <c>ADR-2026-05-04_dwc-scoring-formula.md</c>:
/// </para>
/// <list type="bullet">
/// <item><c>TriggerFit</c> — 0..10 (schedule compliance)</item>
/// <item><c>ActionSimplicity</c> — 0..20 (median closure duration)</item>
/// <item><c>Proof</c> — 0..25 (WVFD * 0.6 + attach ratio * 0.4)</item>
/// <item><c>Reward</c> — 0..10 (closure summary view ratio)</item>
/// <item><c>Investment</c> — 0..10 (worker reuse ratio, WTL v0)</item>
/// <item><c>Repeat</c> — 0..25 (distinct active days in last 7)</item>
/// </list>
/// <para>
/// <see cref="Bucket"/> is one of <c>intervention</c> (0–40) /
/// <c>watchlist</c> (41–60) / <c>healthy</c> (61–100).
/// <see cref="Flag"/> is one of <c>ok</c> / <c>flagged</c> /
/// <c>suspicious</c> / <c>insufficient_data</c>.
/// </para>
/// </remarks>
public sealed record FarmerHealthScoreBreakdownDto(
    int Total,
    string Bucket,
    string Flag,
    FarmerHealthPillarsDto Pillars,
    DateOnly WeekStart);

/// <summary>
/// Six pillar contributions to the DWC v2 score. Each pillar carries its
/// own clamp range (see <see cref="FarmerHealthScoreBreakdownDto"/>).
/// </summary>
public sealed record FarmerHealthPillarsDto(
    decimal TriggerFit,
    decimal ActionSimplicity,
    decimal Proof,
    decimal Reward,
    decimal Investment,
    decimal Repeat);
