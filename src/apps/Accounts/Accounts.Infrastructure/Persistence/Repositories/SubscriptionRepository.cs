using Accounts.Application.Ports;
using Accounts.Domain.Subscriptions;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;

namespace Accounts.Infrastructure.Persistence.Repositories;

internal sealed class SubscriptionRepository(AccountsDbContext dbContext) : ISubscriptionRepository
{
    public async Task AddAsync(Subscription subscription, CancellationToken ct = default)
    {
        await dbContext.Subscriptions.AddAsync(subscription, ct);
    }

    public Task<Subscription?> GetCurrentAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default)
    {
        return dbContext.Subscriptions
            .Where(s => s.OwnerAccountId == ownerAccountId &&
                        (s.Status == SubscriptionStatus.Trialing || s.Status == SubscriptionStatus.Active))
            .OrderByDescending(s => s.CreatedAtUtc)
            .FirstOrDefaultAsync(ct)!;
    }

    public Task<Subscription?> GetByIdAsync(SubscriptionId subscriptionId, CancellationToken ct = default)
    {
        return dbContext.Subscriptions
            .FirstOrDefaultAsync(s => s.Id == subscriptionId, ct)!;
    }

    public Task<bool> WebhookEventExistsAsync(string providerEventId, CancellationToken ct = default)
    {
        return dbContext.SubscriptionWebhookEvents
            .AnyAsync(e => e.ProviderEventId == providerEventId, ct);
    }

    public async Task AddWebhookEventAsync(SubscriptionWebhookEvent webhookEvent, CancellationToken ct = default)
    {
        await dbContext.SubscriptionWebhookEvents.AddAsync(webhookEvent, ct);
    }

    public Task<List<Subscription>> GetNonTerminalExpiredAsync(DateTime asOfUtc, CancellationToken ct = default)
    {
        return dbContext.Subscriptions
            .Where(s =>
                (s.Status == SubscriptionStatus.Trialing ||
                 s.Status == SubscriptionStatus.Active ||
                 s.Status == SubscriptionStatus.PastDue) &&
                s.ValidUntilUtc < asOfUtc)
            .ToListAsync(ct);
    }

    public Task SaveChangesAsync(CancellationToken ct = default) =>
        dbContext.SaveChangesAsync(ct);
}
