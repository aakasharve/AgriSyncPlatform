// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S3) - whose face a person may see needs his farm-mates' seats.
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// <see cref="IFarmMateSeatReader"/> over <c>ssf.farm_memberships</c>. The request's own context runs under the caller's USER scope, where row
/// security shows only his own seats; reading a farm-mate's seat needs that FARM's tenant scope. So this reader opens a CHILD service scope (its
/// own <see cref="TenantContext"/>, interceptor, context and connection, resolved through DI like every context), puts it in the caller's own user
/// scope, and reads each farm inside its own transaction through <see cref="RlsIdentityScope.RunAsFarmAsync{T}"/>: the farm setting lives only in
/// that transaction and never reaches the request's. Callers ask only for farms the reader works on (his read scopes); only ids and roles leave.
/// </summary>
internal sealed class FarmMateSeatReader(IServiceScopeFactory scopes) : IFarmMateSeatReader
{
    public async Task<IReadOnlyList<FarmMateSeat>> GetActiveSeatsAsync(
        IReadOnlyCollection<FarmMateFarm> farms, Guid readerUserId, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(farms);
        var wanted = farms.Where(f => f.FarmId != Guid.Empty && f.OwnerAccountId != Guid.Empty).DistinctBy(f => f.FarmId).ToList();
        if (wanted.Count == 0 || readerUserId == Guid.Empty)
        {
            return [];
        }

        await using var scope = scopes.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetUserScoped(readerUserId);
        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var seats = new List<FarmMateSeat>();
        foreach (var farm in wanted)
        {
            var farmKey = new AgriSync.SharedKernel.Contracts.Ids.FarmId(farm.FarmId);
            var rows = await RlsIdentityScope.RunAsFarmAsync(
                db,
                farm.FarmId,
                farm.OwnerAccountId,
                readerUserId,
                token => db.FarmMemberships
                    .AsNoTracking()
                    .Where(m => m.FarmId == farmKey
                        && m.Status == MembershipStatus.Active
                        && m.RevokedAtUtc == null
                        && m.ExitedAtUtc == null)
                    .Select(m => new { m.UserId, m.Role })
                    .ToListAsync(token),
                ct);
            seats.AddRange(rows.Select(r => new FarmMateSeat(farm.FarmId, r.UserId.Value, r.Role)));
        }

        return seats;
    }
}
