using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning;

/// <summary>
/// CEI Phase 2 §4.7 author gate for schedule-template scope, lane 2b (founder D-26; MU design §2,
/// §11.1) — answered by the schedule-templates AUTHORITY of a farm SEAT, never the account's global
/// role. The role lists that stood here read the JWT's sign-up role: any account whose sign-up role
/// matched could write a Team / Licensed template, and the farm's own owner (whose account carried
/// no such role) could not.
/// <list type="bullet">
/// <item><see cref="TenantScope.Private"/> — any signed-in person, as before (his own template).</item>
/// <item><see cref="TenantScope.Team"/> / <see cref="TenantScope.Licensed"/> — the caller names a
/// farm (<c>?farmId=…</c>) and his seat there holds schedule templates; its primary account holder
/// always does. No farm named, nobody is authorised.</item>
/// <item><see cref="TenantScope.Public"/> — never through a handler (backend seed job only).</item>
/// </list>
/// </summary>
internal static class ScopeRoleGate
{
    public static async Task<bool> IsAllowedAsync(
        IShramSafalRepository repository,
        TenantScope scope,
        Guid? farmId,
        Guid callerUserId,
        DateTime nowUtc,
        CancellationToken ct)
    {
        switch (scope)
        {
            case TenantScope.Private:
                return true;
            case TenantScope.Team:
            case TenantScope.Licensed:
                return farmId is { } farm
                    && await FarmAuthorityGate.HoldsAsync(
                        repository, farm, callerUserId, FarmAuthority.ScheduleTemplates, nowUtc, ct);
            default:
                return false;
        }
    }
}
