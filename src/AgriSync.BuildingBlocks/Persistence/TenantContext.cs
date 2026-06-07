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
/// <b>Three terminal states, never mixed:</b>
/// <list type="bullet">
/// <item>Single-tenant — <see cref="SetTenant"/> recorded. Reassigning to a
/// DIFFERENT farm within the same scope throws (catches cross-tenant
/// data smuggling at handler-boundary level).</item>
/// <item>Admin cross-tenant — <see cref="ElevateToAdminCrossTenant"/>
/// recorded. The interceptor then skips GUC injection so the
/// session-level admin role bypasses RLS. Used by hosted services and
/// the upcoming <c>IAdminDbContextFactory</c> (Phase 03.5).</item>
/// <item>User-scoped — <see cref="SetUserScoped"/> recorded (ADR 0019). A
/// multi-farm, NON-admin READ mode: the interceptor injects ONLY
/// <c>agrisync.user_id</c> and the user-scoped RLS policies filter to the
/// caller's own farms. Used by <c>GET /sync/pull</c>.</item>
/// </list>
/// Downgrade or mixing in ANY direction throws — explicit guard against the
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

    /// <summary>
    /// ADR 0019 — user-scoped (multi-farm, NON-admin) read mode. The interceptor
    /// injects ONLY <c>agrisync.user_id</c>; the user-scoped RLS policies filter
    /// to the caller's own farms. Mutually exclusive with the other two states.
    /// </summary>
    public bool IsUserScoped { get; private set; }

    public void SetTenant(Guid farmId, Guid ownerAccountId, Guid? userId = null)
    {
        if (FarmId is { } existing && existing != farmId)
            throw new InvalidOperationException(
                $"TenantContext already set to FarmId={existing}; refusing reassignment to {farmId} within same request scope.");
        if (IsAdminCrossTenant)
            throw new InvalidOperationException(
                "TenantContext is elevated to AdminCrossTenant; cannot downgrade to single-tenant scope.");
        // ADR 0019 — additive guard; the two checks above are unchanged.
        if (IsUserScoped)
            throw new InvalidOperationException(
                "TenantContext is user-scoped; cannot downgrade to single-tenant scope.");
        FarmId = farmId;
        OwnerAccountId = ownerAccountId;
        UserId = userId ?? UserId;
    }

    public void ElevateToAdminCrossTenant()
    {
        if (FarmId is not null)
            throw new InvalidOperationException(
                "Cannot elevate to AdminCrossTenant after SetTenant was called.");
        // ADR 0019 — additive guard; the check above is unchanged.
        if (IsUserScoped)
            throw new InvalidOperationException(
                "Cannot elevate to AdminCrossTenant after user-scoped mode was entered.");
        IsAdminCrossTenant = true;
    }

    /// <summary>
    /// ADR 0019 — enter user-scoped (multi-farm, NON-admin) read mode. The
    /// interceptor then injects ONLY <c>agrisync.user_id</c> (Caveat A: the
    /// single-tenant fail-closed guard and the admin early-return are UNCHANGED).
    /// Entered from the validated JWT claim only (Caveat B); a non-empty userId is
    /// required. Mutually exclusive with both other terminal states.
    /// </summary>
    public void SetUserScoped(Guid userId)
    {
        if (userId == Guid.Empty)
            throw new ArgumentException("SetUserScoped requires a non-empty userId.", nameof(userId));
        if (FarmId is not null)
            throw new InvalidOperationException(
                "Cannot enter user-scoped mode after SetTenant was called.");
        if (IsAdminCrossTenant)
            throw new InvalidOperationException(
                "Cannot enter user-scoped mode after ElevateToAdminCrossTenant.");
        IsUserScoped = true;
        UserId = userId;
    }
}
