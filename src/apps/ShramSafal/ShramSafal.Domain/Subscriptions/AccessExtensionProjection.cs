using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Subscriptions;

/// <summary>
/// spec R-11 (b) — read-only projection of an owner account's server-managed pilot access
/// extension (<c>accounts.access_extensions</c>, owned by the Accounts app), exposed into the ssf
/// schema as the <c>ssf.access_extension_projections</c> view, exactly like
/// <see cref="SubscriptionProjection"/>. No behaviour beyond the time test.
/// </summary>
public sealed class AccessExtensionProjection
{
    private AccessExtensionProjection() { } // EF Core

    public Guid AccessExtensionId { get; private set; }
    public OwnerAccountId OwnerAccountId { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public DateTime StartsAtUtc { get; private set; }
    public DateTime EndsAtUtc { get; private set; }
    public Guid GrantedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Start inclusive, end exclusive — the same rule as the Accounts aggregate.</summary>
    public bool IsActiveAt(DateTime utc) => StartsAtUtc <= utc && utc < EndsAtUtc;
}
