using AgriSync.Bootstrapper.Jobs;
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
/// </summary>
internal sealed class WorkerRetentionReader(ShramSafalDbContext ssfContext) : IWorkerRetentionReader
{
    public async Task<List<WorkerRetentionEntry>> GetMembershipsCrossing30dThresholdAsync(
        DateTime activeBefore,
        CancellationToken ct = default)
    {
        return await ssfContext.FarmMemberships
            .Join(ssfContext.Farms,
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
