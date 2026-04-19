using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Subscriptions;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

internal sealed class SubscriptionReader(ShramSafalDbContext db) : ISubscriptionReader
{
    public Task<SubscriptionProjection?> GetByOwnerAccountAsync(
        OwnerAccountId ownerAccountId,
        CancellationToken ct = default)
    {
        // The view orders by nothing; pick the highest-priority row: any
        // Trialing/Active first, else the most recently updated.
        //   status 1 = Trialing, 2 = Active, 3 = PastDue, 4 = Expired,
        //   5 = Canceled, 6 = Suspended.
        return db.SubscriptionProjections
            .AsNoTracking()
            .Where(x => x.OwnerAccountId == ownerAccountId)
            .OrderBy(x => x.Status == 1 || x.Status == 2 ? 0 : 1)
            .ThenByDescending(x => x.UpdatedAtUtc)
            .FirstOrDefaultAsync(ct);
    }
}
