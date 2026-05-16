// spec: data-principle-spine-2026-05-05/03.2
namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.2 — per-request tenant claim
/// holder consumed by <see cref="TenantConnectionInterceptor"/> to set the
/// Postgres GUCs <c>agrisync.farm_id</c> and <c>agrisync.owner_account_id</c>
/// that Phase 03.3 RLS policies key on.
///
/// <para>
/// <b>Scope:</b> registered as Scoped so the lifetime matches the
/// per-request DI scope. The <see cref="TenantTransactionMiddleware"/>
/// ensures the entire request body executes inside a single transaction
/// so the GUCs (set with <c>is_local := true</c>) propagate correctly.
/// </para>
///
/// <para>
/// <b>Two terminal states, never mixed:</b>
/// <list type="bullet">
/// <item>Single-tenant — <see cref="SetTenant"/> recorded. Reassigning to a
/// DIFFERENT farm within the same scope throws (catches cross-tenant
/// data smuggling at handler-boundary level).</item>
/// <item>Admin cross-tenant — <see cref="ElevateToAdminCrossTenant"/>
/// recorded. The interceptor then skips GUC injection so the
/// session-level admin role bypasses RLS. Used by hosted services and
/// the upcoming <c>IAdminDbContextFactory</c> (Phase 03.5).</item>
/// </list>
/// Downgrade in either direction throws — explicit guard against the
/// "elevate then re-narrow" anti-pattern that would leak cross-tenant
/// rows into a single-farm response.
/// </para>
/// </summary>
public sealed class TenantContext
{
    public Guid? FarmId { get; private set; }
    public Guid? OwnerAccountId { get; private set; }
    public Guid? UserId { get; private set; }
    public bool IsAdminCrossTenant { get; private set; }

    public void SetTenant(Guid farmId, Guid ownerAccountId, Guid? userId = null)
    {
        if (FarmId is { } existing && existing != farmId)
            throw new InvalidOperationException(
                $"TenantContext already set to FarmId={existing}; refusing reassignment to {farmId} within same request scope.");
        if (IsAdminCrossTenant)
            throw new InvalidOperationException(
                "TenantContext is elevated to AdminCrossTenant; cannot downgrade to single-tenant scope.");
        FarmId = farmId;
        OwnerAccountId = ownerAccountId;
        UserId = userId ?? UserId;
    }

    public void ElevateToAdminCrossTenant()
    {
        if (FarmId is not null)
            throw new InvalidOperationException(
                "Cannot elevate to AdminCrossTenant after SetTenant was called.");
        IsAdminCrossTenant = true;
    }
}
