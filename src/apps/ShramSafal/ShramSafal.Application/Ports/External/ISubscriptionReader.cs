using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Subscriptions;

namespace ShramSafal.Application.Ports.External;

/// <summary>
/// Read-only port over the subscription projection. ShramSafal never
/// writes subscription state — Accounts owns the source of truth.
/// Plan §0A.4 X1.
/// </summary>
public interface ISubscriptionReader
{
    /// <summary>
    /// Returns the current subscription row for an OwnerAccount, or null
    /// if the account has never had a subscription.
    /// </summary>
    Task<SubscriptionProjection?> GetByOwnerAccountAsync(
        OwnerAccountId ownerAccountId,
        CancellationToken ct = default);
}
