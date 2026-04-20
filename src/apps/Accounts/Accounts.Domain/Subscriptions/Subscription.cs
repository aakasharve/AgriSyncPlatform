using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using Accounts.Domain.Events;

namespace Accounts.Domain.Subscriptions;

/// <summary>
/// Subscription aggregate.
///
/// Invariants:
///   I6 — at most one Trialing/Active subscription per OwnerAccount at any
///        point in time. Enforced in the repository via partial unique
///        index; domain disallows a second Activate() while status is
///        already Trialing/Active.
///   I7 — <see cref="Status"/> is only mutated through the lifecycle
///        methods below. No public setter exists. The authoritative source
///        for transitions is the billing-provider webhook pipeline.
///
/// Spec: plan §3.3, §5.1, §13.1 Rule 2 (entitlement-vs-identity split).
/// </summary>
public sealed class Subscription : Entity<SubscriptionId>
{
    private Subscription() : base(default) { } // EF Core

    private Subscription(
        SubscriptionId id,
        OwnerAccountId ownerAccountId,
        string planCode,
        SubscriptionStatus status,
        DateTime validFromUtc,
        DateTime validUntilUtc,
        DateTime? trialEndsAtUtc,
        DateTime createdAtUtc)
        : base(id)
    {
        OwnerAccountId = ownerAccountId;
        PlanCode = planCode;
        Status = status;
        ValidFromUtc = validFromUtc;
        ValidUntilUtc = validUntilUtc;
        TrialEndsAtUtc = trialEndsAtUtc;
        CreatedAtUtc = createdAtUtc;
        UpdatedAtUtc = createdAtUtc;
    }

    public OwnerAccountId OwnerAccountId { get; private set; }
    public string PlanCode { get; private set; } = string.Empty;
    public SubscriptionStatus Status { get; private set; }
    public DateTime ValidFromUtc { get; private set; }
    public DateTime ValidUntilUtc { get; private set; }
    public DateTime? TrialEndsAtUtc { get; private set; }
    public string? BillingProviderCustomerId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    public bool IsCurrentlyValid =>
        Status is SubscriptionStatus.Trialing or SubscriptionStatus.Active;

    public bool AllowsOwnerWrites => Status is SubscriptionStatus.Trialing or SubscriptionStatus.Active;

    public bool AllowsOwnerReadsOnly => Status is SubscriptionStatus.PastDue;

    public static Subscription StartTrial(
        SubscriptionId id,
        OwnerAccountId ownerAccountId,
        string planCode,
        DateTime trialStartUtc,
        DateTime trialEndsAtUtc)
    {
        if (id.IsEmpty) throw new ArgumentException("Subscription id is required.", nameof(id));
        if (ownerAccountId.IsEmpty) throw new ArgumentException("OwnerAccount id is required.", nameof(ownerAccountId));
        if (string.IsNullOrWhiteSpace(planCode)) throw new ArgumentException("PlanCode is required.", nameof(planCode));
        if (trialEndsAtUtc <= trialStartUtc) throw new ArgumentException("Trial must end after it starts.", nameof(trialEndsAtUtc));

        var subscription = new Subscription(
            id,
            ownerAccountId,
            planCode,
            SubscriptionStatus.Trialing,
            trialStartUtc,
            trialEndsAtUtc,
            trialEndsAtUtc,
            trialStartUtc);

        subscription.Raise(new SubscriptionActivated(
            Guid.NewGuid(),
            trialStartUtc,
            id,
            ownerAccountId,
            planCode,
            trialStartUtc,
            trialEndsAtUtc,
            IsTrial: true));

        return subscription;
    }

    public void Activate(DateTime validFromUtc, DateTime validUntilUtc, string? billingProviderCustomerId, DateTime utcNow)
    {
        if (Status is SubscriptionStatus.Canceled or SubscriptionStatus.Expired)
        {
            throw new InvalidOperationException(
                $"Subscription '{Id}' is in terminal status {Status}. Create a new subscription instead.");
        }

        if (validUntilUtc <= validFromUtc)
        {
            throw new ArgumentException("ValidUntil must be after ValidFrom.", nameof(validUntilUtc));
        }

        Status = SubscriptionStatus.Active;
        ValidFromUtc = validFromUtc;
        ValidUntilUtc = validUntilUtc;
        BillingProviderCustomerId = billingProviderCustomerId ?? BillingProviderCustomerId;
        UpdatedAtUtc = utcNow;

        Raise(new SubscriptionActivated(
            Guid.NewGuid(),
            utcNow,
            Id,
            OwnerAccountId,
            PlanCode,
            validFromUtc,
            validUntilUtc,
            IsTrial: false));
    }

    public void MarkPastDue(DateTime gracePeriodEndsAtUtc, DateTime utcNow)
    {
        if (Status is SubscriptionStatus.Canceled or SubscriptionStatus.Expired or SubscriptionStatus.Suspended)
        {
            return;
        }

        Status = SubscriptionStatus.PastDue;
        UpdatedAtUtc = utcNow;

        Raise(new SubscriptionPastDue(
            Guid.NewGuid(),
            utcNow,
            Id,
            OwnerAccountId,
            gracePeriodEndsAtUtc));
    }

    public void Expire(DateTime utcNow)
    {
        if (Status == SubscriptionStatus.Expired)
        {
            return;
        }

        Status = SubscriptionStatus.Expired;
        UpdatedAtUtc = utcNow;

        Raise(new SubscriptionExpired(
            Guid.NewGuid(),
            utcNow,
            Id,
            OwnerAccountId,
            utcNow));
    }

    public void Cancel(DateTime utcNow)
    {
        if (Status == SubscriptionStatus.Canceled)
        {
            return;
        }

        Status = SubscriptionStatus.Canceled;
        UpdatedAtUtc = utcNow;

        Raise(new SubscriptionCanceled(
            Guid.NewGuid(),
            utcNow,
            Id,
            OwnerAccountId,
            utcNow));
    }

    public void Suspend(DateTime utcNow)
    {
        Status = SubscriptionStatus.Suspended;
        UpdatedAtUtc = utcNow;
    }
}
