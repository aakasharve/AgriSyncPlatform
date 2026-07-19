using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Auth;

/// <summary>
/// spec: dfes-companion-2026-07-11 — see <see cref="ICallerUserTenantScope"/>
/// for the full rationale. Reuses the exact admin-elevate + manual
/// <c>set_config(..., true)</c> technique <see cref="CallerFarmTenantScope"/>
/// already proved WRITE-safe under prod FORCE-RLS (avoids the interceptor's
/// automatic <c>SET LOCAL</c> prepend, which desyncs EF's INSERT rows-affected
/// parsing — <c>reference_interceptor_setlocal_desyncs_ef_writes</c>) — with NO
/// membership/isolation-gate read, because the scope this establishes is
/// always the caller's OWN validated JWT subject, never a caller-suppliable
/// foreign id.
/// </summary>
internal sealed class CallerUserTenantScope(
    TenantContext tenantContext,
    ShramSafalDbContext db) : ICallerUserTenantScope
{
    public async Task<Result> EstablishForCallerAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        // Non-relational provider (EF InMemory, swapped in by some integration
        // tests) has no FORCE-RLS to satisfy — no-op, matching
        // CallerFarmTenantScope's identical guard.
        if (!db.Database.IsRelational())
        {
            return Result.Success();
        }

        // Admin-elevate so TenantConnectionInterceptor no-ops (no automatic
        // SET LOCAL prepend on the caller's actual DbCommand — the prepend is
        // what desyncs EF's write-rows-affected parsing). MUST precede any DB
        // command on this context.
        tenantContext.ElevateToAdminCrossTenant();

        // Set the GUC via a SEPARATE, preceding command — never prepended onto
        // the actual INSERT's CommandText — so ssf.correction_events' RLS
        // policy (USING/WITH CHECK on agrisync.user_id) is satisfied without
        // touching the write command EF generates.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {userId.ToString()}, true)", ct);

        return Result.Success();
    }
}
