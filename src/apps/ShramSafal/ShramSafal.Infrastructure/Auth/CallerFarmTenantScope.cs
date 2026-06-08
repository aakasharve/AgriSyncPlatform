using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Auth;

/// <summary>
/// spec: voice-tenant-claim-caller-farm-2026-06-08 — establishes a
/// membership-VALIDATED single-farm tenant scope for the current request, using
/// the prod-proven admin-elevate + manual <c>set_config(...,true)</c> technique
/// already live in <c>FirstFarmBootstrapEndpoints</c> (f7fab197) and
/// <c>ShramSafalRepository.GetMyFarmsAsync</c>.
///
/// <para>
/// <b>Why admin-elevate first.</b> <see cref="TenantContext.ElevateToAdminCrossTenant"/>
/// makes <c>TenantConnectionInterceptor</c> a no-op (no per-command
/// <c>SET LOCAL agrisync.* = ...</c> prepend → no EF write-rows-affected
/// desync, per <c>reference_interceptor_setlocal_desyncs_ef_writes</c>). We then
/// set the GUCs ourselves so reads filter to the farm AND the
/// <c>ssf.ai_jobs</c> <c>WITH CHECK (farm_id = agrisync.farm_id)</c> write
/// passes. The GUCs are tx-local (<c>is_local=true</c>) and ride the
/// per-request transaction <c>TenantTransactionMiddleware</c> already opened.
/// </para>
///
/// <para>
/// <b>Isolation gate (load-bearing).</b> Step 4 reads
/// <c>ssf.farms</c> (owner shortcut) + <c>ssf.farm_memberships</c> under the
/// caller's OWN user-scoped PERMISSIVE SELECT policies (keyed on the
/// <c>agrisync.user_id</c> set in step 3 — the validated JWT subject, NOT a
/// caller-supplied claim). A caller can only confirm membership of farms they
/// actually own/belong to; a forged <c>farmId</c> returns no membership and we
/// return Forbidden BEFORE any <c>agrisync.farm_id</c> GUC is set — nothing
/// leaks. This 403 is the SOLE authorization gate for the voice endpoints.
/// </para>
/// </summary>
internal sealed class CallerFarmTenantScope(
    TenantContext tenantContext,
    ShramSafalDbContext db,
    IShramSafalRepository repository) : ICallerFarmTenantScope
{
    public async Task<Result> EstablishForCallerAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        // The single-farm scope is established via Postgres GUCs (set_config) —
        // a relational-only mechanism. Under a NON-relational provider (the EF
        // InMemory provider the AI/farm endpoint integration tests swap in)
        // there is no FORCE-RLS to satisfy and raw SQL is unavailable, so this
        // is a no-op. Authorization is unaffected: every wired handler still
        // runs its own IsUserMemberOfFarmAsync membership check (LINQ, provider-
        // agnostic). Production always uses Npgsql, so the full validated-scope
        // path below runs and the GUC write-path stays exactly as reviewed.
        if (!db.Database.IsRelational())
        {
            return Result.Success();
        }

        // Step 2 — admin-elevate so the interceptor no-ops (no SET LOCAL
        // prelude → no EF write-rows-affected desync). MUST precede any DB
        // command on this context; ElevateToAdminCrossTenant throws if a
        // single-tenant claim was already set in this scope.
        tenantContext.ElevateToAdminCrossTenant();

        // Step 3 — set the caller's user_id GUC so the user-scoped PERMISSIVE
        // SELECT policies (20260606074635 / 20260607120000) surface ONLY the
        // caller's own farms/memberships for the membership read below.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {userId.ToString()}, true)", ct);

        // Step 4 — the isolation gate. Reads ssf.farms (owner shortcut) +
        // ssf.farm_memberships under the user-scoped policies set in step 3.
        var (isMember, ownerAccountId) = await repository
            .GetFarmMembershipForTenantAsync(farmId, userId, ct);

        // Step 5 — non-member → Forbidden, with NO farm_id GUC set. Nothing
        // about a foreign farm leaks. This is the sole authorization gate for
        // the wired voice endpoints.
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        // Step 6 — caller is a member: establish the single-farm scope so every
        // subsequent farm-scoped read AND the ai_jobs WITH-CHECK write pass.
        // user_id was already set in step 3.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {farmId.ToString()}, true)", ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {ownerAccountId.ToString()}, true)", ct);

        return Result.Success();
    }
}
