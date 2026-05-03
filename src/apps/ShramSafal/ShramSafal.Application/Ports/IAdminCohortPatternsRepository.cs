using ShramSafal.Application.Admin;
using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Reads the cohort-level DWC v2 dashboard payload (Mode B) from the
/// <c>mis</c> matview spine, scoped to the caller's
/// <see cref="AdminScope"/> via <c>mis.effective_org_farm_scope</c>.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.5 Step 2. Returns the score-distribution histogram,
/// intervention queue (cap 50), watchlist (cap 100), engagement tier
/// breakdown, pillar heatmap, 8-week trend, and the existing farmer
/// suffering top 10 (reuses <c>mis.farmer_suffering_watchlist</c>).
/// </para>
/// </remarks>
public interface IAdminCohortPatternsRepository
{
    Task<CohortPatternsDto> GetAsync(AdminScope scope, CancellationToken ct = default);
}
