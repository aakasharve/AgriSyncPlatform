using ShramSafal.Application.Admin;

namespace ShramSafal.Application.UseCases.Admin.GetCohortPatterns;

/// <summary>
/// Query for the Mode B cohort dashboard
/// (<c>GET /admin/farmer-health/cohort</c>).
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.6 Step 1. <see cref="Scope"/> is the only parameter and
/// must be first per <c>admin-scope-guard</c>.
/// </para>
/// </remarks>
public sealed record GetCohortPatternsQuery(AdminScope Scope);
