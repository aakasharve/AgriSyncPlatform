// spec: data-principle-spine-2026-05-05/03.5
namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.5 — explicit admin
/// escape hatch for cross-tenant reads/writes that must bypass the
/// Phase 03.3 Row-Level Security policies.
///
/// <para>
/// <b>Why a factory and not <see cref="TenantContext.ElevateToAdminCrossTenant"/>
/// alone?</b> The 03.2 interceptor closes over the per-request
/// <see cref="TenantContext"/>. Elevating the scoped context to admin
/// merely tells the interceptor to skip GUC injection — the policy
/// expression <c>farm_id = current_setting('agrisync.farm_id', true)::uuid</c>
/// then evaluates against NULL and yields zero rows (documented as the
/// 03.4 boundary in <c>RowLevelSecurityTests</c>). The admin factory
/// returns a NEW DbContext whose options chain has NO
/// <c>TenantConnectionInterceptor</c> attached at all, so commands leave
/// without the prelude and the migration-runner / hosted-service caller
/// (which connects as the table owner) executes outside the policy gate.
/// </para>
///
/// <para>
/// <b>Audit-first.</b> Every <see cref="CreateAsync"/> call writes an
/// <c>AuditEvent</c> row tagged <c>actorRole=admin_cross_tenant</c>
/// BEFORE returning the privileged context. This is the only path that
/// closes the gap left by RLS — without the audit row, an admin opening
/// is indistinguishable from a tenant-scoped query in the event log.
/// The audit write itself runs through a short-lived parallel context
/// (same connection string, same NO-interceptor options) and is
/// committed before the caller sees the primary context.
/// </para>
///
/// <para>
/// <b>Lifetime:</b> implementations should be registered as Scoped so
/// they can resolve <see cref="TenantContext"/> if they ever need to
/// stamp the actor's pre-elevation claim onto the audit payload. The
/// returned <typeparamref name="TContext"/> is the caller's
/// responsibility to <c>DisposeAsync</c> — typically wrapped in an
/// <c>await using</c> at the call site (sweepers, retention jobs).
/// </para>
/// </summary>
/// <typeparam name="TContext">
/// The concrete <see cref="Microsoft.EntityFrameworkCore.DbContext"/>
/// to materialise. Constrained to <see cref="Microsoft.EntityFrameworkCore.DbContext"/>
/// so factory implementations can construct the type with the standard
/// options-only constructor.
/// </typeparam>
public interface IAdminDbContextFactory<TContext>
    where TContext : Microsoft.EntityFrameworkCore.DbContext
{
    /// <summary>
    /// Build a fresh <typeparamref name="TContext"/> whose options chain
    /// has NO <see cref="TenantConnectionInterceptor"/> attached, write
    /// an <c>AuditEvent</c> recording the admin opening, and return the
    /// privileged context to the caller.
    /// </summary>
    /// <param name="reason">
    /// Human-readable justification recorded on the audit payload.
    /// Must be non-whitespace; thrown as <see cref="ArgumentException"/>
    /// otherwise so a bad caller fails before any DB work runs.
    /// </param>
    /// <param name="actorUserId">
    /// Identity of the human or system principal opening the cross-
    /// tenant scope. Must be non-empty; thrown as
    /// <see cref="ArgumentException"/> otherwise. Hosted services use a
    /// well-known sentinel (e.g. the worker's deterministic Guid).
    /// </param>
    /// <param name="ct">Cancellation propagated through the audit write.</param>
    Task<TContext> CreateAsync(string reason, Guid actorUserId, CancellationToken ct);
}
