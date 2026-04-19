using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Subscriptions;

/// <summary>
/// Read-only projection of a subscription, owned by the Accounts app
/// but exposed into the ssf schema as a SQL view for ShramSafal to read
/// without violating the Apps-boundary rule (Architecture Ref §7).
///
/// Consumers:
///   - <see cref="ShramSafal.Application.Ports.External.ISubscriptionReader"/>
///     (called by <see cref="ShramSafal.Application.Ports.IEntitlementPolicy"/>)
///
/// This type is deliberately NOT an aggregate — it has no behaviour. It
/// is a data-transfer shape. Its numeric status values match the
/// <c>Accounts.Domain.Subscriptions.SubscriptionStatus</c> enum.
/// </summary>
public sealed class SubscriptionProjection
{
    private SubscriptionProjection() { } // EF Core

    public SubscriptionId SubscriptionId { get; private set; }
    public OwnerAccountId OwnerAccountId { get; private set; }
    public string PlanCode { get; private set; } = string.Empty;

    /// <summary>Matches Accounts.Domain.Subscriptions.SubscriptionStatus numeric values.</summary>
    public int Status { get; private set; }

    public DateTime ValidFromUtc { get; private set; }
    public DateTime ValidUntilUtc { get; private set; }
    public DateTime? TrialEndsAtUtc { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    public bool IsTrialing => Status == 1;
    public bool IsActive => Status == 2;
    public bool IsPastDue => Status == 3;
    public bool IsExpired => Status == 4;
    public bool IsCanceled => Status == 5;
    public bool IsSuspended => Status == 6;

    public bool AllowsOwnerWrites => IsTrialing || IsActive;
    public bool AllowsOwnerReadsOnly => IsPastDue;
    public bool IsCurrentlyValid => AllowsOwnerWrites;
}
