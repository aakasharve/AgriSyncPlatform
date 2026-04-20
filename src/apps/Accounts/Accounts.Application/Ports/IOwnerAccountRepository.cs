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
    Task<Subscription?> GetByIdAsync(SubscriptionId subscriptionId, CancellationToken ct = default);
    Task<bool> WebhookEventExistsAsync(string providerEventId, CancellationToken ct = default);
    Task AddWebhookEventAsync(SubscriptionWebhookEvent webhookEvent, CancellationToken ct = default);
    /// <summary>Returns subscriptions in Trialing/Active/PastDue state whose ValidUntilUtc is before <paramref name="asOfUtc"/>.</summary>
    Task<List<Subscription>> GetNonTerminalExpiredAsync(DateTime asOfUtc, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
