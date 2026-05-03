using ShramSafal.Application.Admin;
using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Reads the per-farmer DWC v2 health payload (Mode A drilldown) from
/// the <c>mis</c> matview spine, gated by the caller's
/// <see cref="AdminScope"/>. Implementation joins
/// <c>mis.effective_org_farm_scope</c> per CEI W0 so a farm outside the
/// caller's scope returns <c>null</c> (NotFound at the handler layer).
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.5 Step 1. Five parallel reads under the hood (each
/// targeted &lt;300ms; assembly under the §3.9 1500ms p95 budget):
/// </para>
/// <list type="bullet">
/// <item>DWC score row from <c>mis.dwc_score_per_farm_week</c></item>
/// <item>14-day timeline from <c>analytics.events</c></item>
/// <item>Sync state from recent <c>api.error</c> rows</item>
/// <item>AI invocation success rate (last 14 days)</item>
/// <item>Verification states (counts) + WTL v0 worker summary (top 5)</item>
/// </list>
/// <para>
/// Returns <c>null</c> when the farm is not in the caller's scope or
/// does not exist; never throws on missing matview rows (graceful empty
/// payload — same discipline as <c>AdminMisRepository</c>).
/// </para>
/// </remarks>
public interface IAdminFarmerHealthRepository
{
    Task<FarmerHealthDto?> GetAsync(Guid farmId, AdminScope scope, CancellationToken ct = default);
}
