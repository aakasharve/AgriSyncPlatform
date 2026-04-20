using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Application.UseCases.Subscriptions.ApplyProviderEvent;

/// <param name="ProviderEventId">Unique ID from the billing provider — used for idempotency.</param>
/// <param name="EventType">Normalised event name, e.g. "subscription.activated".</param>
/// <param name="SubscriptionId">The subscription affected (null if the provider doesn't include it).</param>
/// <param name="ValidFromUtc">For activate/renew events. Null for other types.</param>
/// <param name="ValidUntilUtc">For activate/renew events. Null for other types.</param>
/// <param name="GracePeriodEndsAtUtc">For past-due events. Null for other types.</param>
/// <param name="BillingProviderCustomerId">Customer ID from the provider. Null if not supplied.</param>
/// <param name="RawPayload">Full raw JSON from the provider — stored for audit.</param>
public sealed record ApplyProviderEventCommand(
    string ProviderEventId,
    string EventType,
    SubscriptionId? SubscriptionId,
    DateTime? ValidFromUtc,
    DateTime? ValidUntilUtc,
    DateTime? GracePeriodEndsAtUtc,
    string? BillingProviderCustomerId,
    string RawPayload);

/// <summary>Known provider event type strings — mirrors AnalyticsEventType for subscriptions.</summary>
public static class ProviderEventTypes
{
    public const string SubscriptionActivated = "subscription.activated";
    public const string SubscriptionRenewed = "subscription.renewed";
    public const string SubscriptionPastDue = "subscription.past_due";
    public const string SubscriptionExpired = "subscription.expired";
    public const string SubscriptionCanceled = "subscription.canceled";
    public const string SubscriptionSuspended = "subscription.suspended";
}
