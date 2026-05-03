using ShramSafal.Application.Admin;

namespace ShramSafal.Application.UseCases.Admin.GetFarmerHealth;

/// <summary>
/// Query for the Mode A drilldown (<c>GET /admin/farmer-health/{farmId}</c>).
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.6 Step 1. <see cref="Scope"/> is the first parameter per the
/// <c>admin-scope-guard</c> CI gate (plan §1.5.4 #18) — every admin-side
/// query record must take an <see cref="AdminScope"/> first so the gate
/// can verify it via syntactic inspection.
/// </para>
/// </remarks>
public sealed record GetFarmerHealthQuery(AdminScope Scope, Guid FarmId);
