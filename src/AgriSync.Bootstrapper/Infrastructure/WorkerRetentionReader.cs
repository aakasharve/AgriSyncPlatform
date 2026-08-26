using AgriSync.Bootstrapper.Jobs;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>
/// Cross-app read: queries ShramSafal to find Worker/Mukadam memberships
/// whose <c>granted_at_utc</c> crossed the 30-day threshold.
/// Joins to <c>ssf.farms</c> to resolve the owning OwnerAccountId.
///
/// Bootstrapper is the only host permitted to compose across DbContexts
/// (plan §0A.4 / §0A.7).
///
/// <para>
/// <b>RLS FIX (2026-08-10).</b> This used to run on the SCOPED
/// <see cref="ShramSafalDbContext"/> while <c>WorkerRetentionJob</c> merely
/// admin-ELEVATED the <see cref="TenantContext"/>. Elevation only makes
/// <see cref="TenantConnectionInterceptor"/> skip its GUC prelude — it grants no
/// visibility. <c>ssf.farm_memberships</c> and <c>ssf.farms</c> both have RLS
/// ENABLED and FORCED and the runtime role <c>agrisync_app</c> owns nothing and
/// has no <c>BYPASSRLS</c>, so with neither <c>agrisync.farm_id</c> nor
/// <c>agrisync.user_id</c> set this query returned ZERO rows on every pass and
/// the job silently returned at its <c>memberships.Count == 0</c> guard — no
/// <c>WorkerRetained30d</c> growth event has ever been emitted in normal
/// operation. "Every farm's 30-day-old workers" is genuinely cross-tenant and
/// has no single farm scope to set, so it belongs on the privileged context the
/// admin factory exists to hand out (and which records an
/// <c>AuditEvent("admin_cross_tenant","open")</c> row for the opening).
/// </para>
/// </summary>
internal sealed class WorkerRetentionReader(
    IAdminDbContextFactory<ShramSafalDbContext> adminDbFactory) : IWorkerRetentionReader
{
    public async Task<List<WorkerRetentionEntry>> GetMembershipsCrossing30dThresholdAsync(
        DateTime activeBefore,
        CancellationToken ct = default)
    {
        await using var ssfContext = await adminDbFactory.CreateAsync(
            reason: $"{nameof(WorkerRetentionReader)}.enumerate-30d-memberships",
            actorUserId: SystemActor.Worker,
            ct: ct);

        return await ssfContext.FarmMemberships
            .AsNoTracking()
            .Join(ssfContext.Farms.AsNoTracking(),
                m => m.FarmId,
                f => f.Id,
                (m, f) => new { m, f })
            .Where(x =>
                (x.m.Role == AppRole.Worker || x.m.Role == AppRole.Mukadam) &&
                x.m.Status == MembershipStatus.Active &&
                x.m.GrantedAtUtc <= activeBefore &&
                x.m.RevokedAtUtc == null &&
                x.m.ExitedAtUtc == null)
            .Select(x => new WorkerRetentionEntry(
                x.m.Id,
                new OwnerAccountId(x.f.OwnerAccountId.Value)))
            .ToListAsync(ct);
    }
}
