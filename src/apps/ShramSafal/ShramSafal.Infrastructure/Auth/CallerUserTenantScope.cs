using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Auth;

/// <summary>
/// spec: dfes-companion-2026-07-11 · spec: 2026-08-25-prod-cutover-waves — see
/// <see cref="ICallerUserTenantScope"/> for the full rationale.
///
/// <para>
/// This type composes two sanctioned mechanisms and writes no GUC of its own:
/// <see cref="TenantContext.ElevateToAdminCrossTenant"/> to silence
/// <see cref="TenantConnectionInterceptor"/>'s per-command <c>SET LOCAL</c> prepend
/// (which desyncs EF's write rows-affected accounting — measured twice independently on
/// 2026-08-27, on the corrections write and on the consent-gate link write; see the
/// interface docs), then <see cref="RlsIdentityScope.RunAsUserAsync{T}"/> for the
/// identity itself. It previously hand-wrote <c>set_config('agrisync.user_id', …)</c>
/// here, which <c>RlsIdentityScopeRules</c> correctly rejects: the tenant-GUC
/// vocabulary belongs to the shared helper so there is exactly one place that can
/// forget the transaction or the NULLIF-safe empty case.
/// </para>
///
/// <para>
/// <b>No membership gate, deliberately.</b> Unlike <see cref="CallerFarmTenantScope"/>,
/// which must prove the caller belongs to a farm id the CALLER supplied, the scope
/// established here is always the caller's own validated JWT subject. There is no
/// foreign id to authorize against.
/// </para>
/// </summary>
internal sealed class CallerUserTenantScope(
    TenantContext tenantContext,
    ShramSafalDbContext db) : ICallerUserTenantScope
{
    public Task<T> RunForCallerAsync<T>(
        Guid userId,
        Func<CancellationToken, Task<T>> work,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(work);
        if (userId == Guid.Empty)
        {
            throw new ArgumentException(
                "CallerUserTenantScope requires a non-empty userId — an empty subject is not an " +
                "identity, and an empty GUC coerces to NULL through the policy's NULLIF wrap.",
                nameof(userId));
        }

        // Non-relational provider (EF InMemory, swapped in by some integration tests)
        // has no FORCE-RLS to satisfy and no raw SQL — and nothing to elevate away from,
        // since there is no interceptor to silence. Run the work unchanged, matching
        // CallerFarmTenantScope's identical guard and RlsIdentityScope's own.
        if (!db.Database.IsRelational())
        {
            return work(ct);
        }

        // Admin-elevate FIRST and before any DbCommand on this context. This is not the
        // identity — elevation grants no visibility and emits no GUC — it only stops the
        // interceptor prepending SET LOCAL onto the caller's own command text. The
        // identity is the set_config RlsIdentityScope issues next, as its own command.
        //
        // Idempotent when no farm was claimed, which matters: a route on the middleware's
        // admin skip-list (POST /shramsafal/consent-gate/link) is ALREADY elevated by the
        // time it reaches here, and a route that is not (POST /shramsafal/corrections) is
        // elevated by this call. Both arrive in the same state.
        tenantContext.ElevateToAdminCrossTenant();

        return RlsIdentityScope.RunAsUserAsync(db, userId, work, ct);
    }
}
