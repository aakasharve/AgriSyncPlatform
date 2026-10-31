using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning;

/// <summary>
/// CEI Phase 2 §4.7 author gate for schedule-template scope.
///
/// <para><b>lane 2b (fix 1, LOW-1).</b> A Team / Licensed template belongs to NO farm, so the
/// account's expert sign-up role (the CEI role lists, unchanged) is still required — otherwise
/// every farm's registrant, who holds every authority on his own farm, could write one. When the
/// caller ALSO names a farm (<c>?farmId=…</c>), his seat there must hold schedule templates (MU
/// design §11.1): both must agree. Nothing becomes possible that was not possible before.</para>
/// <list type="bullet">
/// <item><see cref="TenantScope.Private"/> — any signed-in person, as before (his own template).</item>
/// <item><see cref="TenantScope.Team"/> / <see cref="TenantScope.Licensed"/> — the role list AND,
/// when a farm is named, that seat's schedule-templates authority.</item>
/// <item><see cref="TenantScope.Public"/> — never through a handler (backend seed job only).</item>
/// </list>
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

    public static async Task<bool> IsAllowedAsync(
        IShramSafalRepository repository,
        TenantScope scope,
        Guid? farmId,
        Guid callerUserId,
        AppRole callerGlobalRole,
        DateTime nowUtc,
        CancellationToken ct)
    {
        var roleAllows = scope switch
        {
            TenantScope.Private => true,
            TenantScope.Team => TeamRoles.Contains(callerGlobalRole),
            TenantScope.Licensed => LicensedRoles.Contains(callerGlobalRole),
            _ => false,
        };

        if (!roleAllows || scope == TenantScope.Private)
        {
            return roleAllows;
        }

        return farmId is not { } farm
            || await FarmAuthorityGate.HoldsAsync(
                repository, farm, callerUserId, FarmAuthority.ScheduleTemplates, nowUtc, ct);
    }
}
