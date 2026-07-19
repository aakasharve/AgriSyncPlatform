using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: dfes-companion-2026-07-11 — establishes a user-scoped (NOT farm-scoped)
/// tenant claim for the CURRENT request, for tables whose RLS is keyed ENTIRELY
/// on <c>agrisync.user_id</c> (no <c>farm_id</c> column, no farm-scoped
/// predicate at all). <c>ssf.correction_events</c> is the first consumer:
/// policy <c>p_user_correction_events</c>
/// (<c>20260517010000_AddDeferredAuditRls</c>) reads
/// <c>USING/WITH CHECK (user_id = current_setting('agrisync.user_id', true)::uuid)</c>.
///
/// <para>
/// <b>Why not <see cref="ICallerFarmTenantScope"/>.</b> That port validates the
/// caller's MEMBERSHIP of a caller-suppliable <c>farmId</c> before trusting it —
/// there is no analogous "foreign id" here: the scope this port establishes is
/// always the caller's OWN validated JWT subject, never a value the caller
/// supplies, so there is nothing to authorize a membership check against. A
/// farm-shaped port would have no farmId to resolve from the request or the
/// entity (<c>CorrectionEvent</c> carries no farm dimension at all).
/// </para>
///
/// <para>
/// <b>Why not <c>TenantContext.SetUserScoped</c> + the interceptor's automatic
/// prepend</b> (the mechanism <c>GET /sync/pull</c> uses). That path is
/// READ-only in practice: <see cref="AgriSync.BuildingBlocks.Persistence.TenantConnectionInterceptor"/>
/// prepends <c>SET LOCAL agrisync.user_id = '...'; </c> onto the SAME
/// <see cref="System.Data.Common.DbCommand.CommandText"/> as the actual query.
/// For a SELECT that is harmless; for an EF <c>SaveChangesAsync</c> INSERT it
/// desyncs EF's rows-affected parsing of the batched command
/// (<c>reference_interceptor_setlocal_desyncs_ef_writes</c> —
/// confirmed live: <c>DbUpdateConcurrencyException "expected to affect 1
/// row(s), but actually affected 0 row(s)"</c>). This port instead follows
/// <see cref="ICallerFarmTenantScope"/>'s proven WRITE-safe technique: admin-
/// elevate (making the interceptor a no-op) then set the GUC via a SEPARATE,
/// preceding <c>SELECT set_config(...)</c> command — so the actual INSERT
/// command text is never touched.
/// </para>
/// </summary>
public interface ICallerUserTenantScope
{
    /// <summary>
    /// Establish the user-scoped tenant GUC (<c>agrisync.user_id</c>) on the
    /// per-request transaction for <paramref name="userId"/> — the CALLER'S OWN
    /// validated JWT subject. Returns <see cref="Result.Failure"/> (Validation)
    /// when <paramref name="userId"/> is empty; otherwise always succeeds (no
    /// membership gate — see the interface remarks for why none is needed).
    /// </summary>
    Task<Result> EstablishForCallerAsync(Guid userId, CancellationToken ct = default);
}
