namespace Accounts.Domain.Subscriptions;

/// <summary>
/// Subscription lifecycle states.
///
/// State transitions are the only way to change status; the setter is
/// intentionally private so invariant I7 ("Subscription.Status is never
/// mutated from client input") is a compile-time property, not a runtime
/// hope.
/// </summary>
public enum SubscriptionStatus
{
    Trialing = 1,
    Active = 2,
    PastDue = 3,
    Expired = 4,
    Canceled = 5,
    Suspended = 6,
}
