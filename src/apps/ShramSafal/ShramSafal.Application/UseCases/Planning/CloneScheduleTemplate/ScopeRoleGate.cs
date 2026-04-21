using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;

/// <summary>
/// Enforces the CEI Phase 2 §4.7 author-gate rules for schedule template scope promotion.
/// </summary>
internal static class ScopeRoleGate
{
    /// <summary>Roles that may write Licensed-scope templates.</summary>
    private static readonly HashSet<AppRole> LicensedRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.SecondaryOwner,
        AppRole.Agronomist,
        AppRole.Consultant
    ];

    /// <summary>Roles that may write Team-scope templates (superset of Licensed).</summary>
    private static readonly HashSet<AppRole> TeamRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.SecondaryOwner,
        AppRole.Agronomist,
        AppRole.Consultant,
        AppRole.FpcTechnicalManager
    ];

    /// <summary>
    /// Returns <c>true</c> when <paramref name="role"/> is permitted to create a template
    /// at <paramref name="scope"/>.
    /// </summary>
    public static bool IsAllowed(TenantScope scope, AppRole role) =>
        scope switch
        {
            TenantScope.Private  => true,            // any authenticated farm member
            TenantScope.Team     => TeamRoles.Contains(role),
            TenantScope.Licensed => LicensedRoles.Contains(role),
            TenantScope.Public   => false,           // only backend seed job — never via handler
            _                    => false
        };
}
