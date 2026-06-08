using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: voice-tenant-claim-caller-farm-2026-06-08 — establishes a
/// membership-VALIDATED single-farm tenant scope for the CURRENT request so
/// that farm-scoped reads AND the <c>ssf.ai_jobs</c> <c>WITH CHECK</c> write
/// both pass under prod FORCE-RLS (app connects as <c>agrisync_app</c>, no
/// <c>BYPASSRLS</c>).
///
/// <para>
/// The three user-visible victims — <c>POST /shramsafal/ai/voice-parse</c>,
/// <c>GET /shramsafal/farms/{id}</c>, and
/// <c>GET /shramsafal/farms/{id}/weather/*</c> — self-authorize via the
/// repository and never set the tenant claim, so the first farm-scoped command
/// fail-closes in <c>TenantConnectionInterceptor</c>. Voice additionally WRITES
/// <c>ssf.ai_jobs</c> (DIRECT <c>farm_id</c> <c>WITH CHECK</c>), so it needs the
/// <c>agrisync.farm_id</c> GUC — an admin-elevate skip-list alone leaves the
/// GUC unset and the INSERT blocked.
/// </para>
///
/// <para>
/// <b>Isolation gate.</b> The implementation confirms the caller's membership of
/// <paramref name="farmId"/> by reading <c>ssf.farms</c> / <c>ssf.farm_memberships</c>
/// under the caller's OWN user-scoped RLS policies (keyed on the validated JWT
/// <c>agrisync.user_id</c>, NOT a caller-supplied claim). A forged
/// <paramref name="farmId"/> the caller does not own/belong to surfaces NO
/// membership → <see cref="Result.Failure"/> with NO <c>agrisync.farm_id</c> GUC
/// ever set → never cross-tenant exposure. This membership check IS the
/// authorization gate for the wired endpoints.
/// </para>
/// </summary>
public interface ICallerFarmTenantScope
{
    /// <summary>
    /// Validate that <paramref name="userId"/> owns or is an active member of
    /// <paramref name="farmId"/> (under the caller's own user-scoped RLS), and
    /// — only on success — establish the single-farm tenant GUCs
    /// (<c>agrisync.farm_id</c>, <c>agrisync.owner_account_id</c>,
    /// <c>agrisync.user_id</c>) on the per-request transaction.
    /// Returns <see cref="Result.Failure"/> (Forbidden) without setting the
    /// farm GUC when the caller is not a member; (Validation) when either id is
    /// empty.
    /// </summary>
    Task<Result> EstablishForCallerAsync(Guid farmId, Guid userId, CancellationToken ct = default);
}
