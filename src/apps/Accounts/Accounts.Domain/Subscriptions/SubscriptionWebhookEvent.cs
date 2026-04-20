namespace Accounts.Domain.Subscriptions;

/// <summary>
/// Idempotency record for provider webhook events.
/// Each inbound event is stored here before mutating the subscription;
/// a duplicate provider_event_id is silently ignored (I7 safe).
/// </summary>
public sealed class SubscriptionWebhookEvent
{
    private SubscriptionWebhookEvent() { } // EF

    public SubscriptionWebhookEvent(
        Guid id,
        string providerEventId,
        string eventType,
        Guid? subscriptionId,
        DateTime receivedAtUtc,
        string rawPayload)
    {
        Id = id;
        ProviderEventId = providerEventId;
        EventType = eventType;
        SubscriptionId = subscriptionId;
        ReceivedAtUtc = receivedAtUtc;
        RawPayload = rawPayload;
    }

    public Guid Id { get; private set; }
    public string ProviderEventId { get; private set; } = string.Empty;
    public string EventType { get; private set; } = string.Empty;
    public Guid? SubscriptionId { get; private set; }
    public DateTime ReceivedAtUtc { get; private set; }
    public string RawPayload { get; private set; } = string.Empty;
}
