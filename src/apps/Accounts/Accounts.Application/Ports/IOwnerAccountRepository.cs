using AgriSync.SharedKernel.Contracts.Ids;
using Accounts.Domain.OwnerAccounts;
using Accounts.Domain.Subscriptions;

namespace Accounts.Application.Ports;

public interface IOwnerAccountRepository
{
    Task AddAsync(OwnerAccount account, CancellationToken ct = default);
    Task<OwnerAccount?> GetByIdAsync(OwnerAccountId id, CancellationToken ct = default);
    Task<OwnerAccount?> GetByPrimaryOwnerUserIdAsync(UserId userId, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}

public interface ISubscriptionRepository
{
    Task AddAsync(Subscription subscription, CancellationToken ct = default);
    Task<Subscription?> GetCurrentAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
