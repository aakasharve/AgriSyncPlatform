using System.Diagnostics;
using Accounts.Domain.Events;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using Microsoft.Extensions.Logging;

namespace Accounts.Application.EventHandlers;

/// <summary>
/// T-IGH-03-OUTBOX-PUBLISHER-IMPL — first production
/// <see cref="IDomainEventHandler{TEvent}"/> subscriber. Listens for the
/// four <c>Subscription*</c> lifecycle events emitted by
/// <see cref="Domain.Subscriptions.Subscription"/> and writes a
/// structured-log line + an <see cref="Activity"/> event for each
/// transition.
///
/// <para>
/// <b>Why this exists.</b> The outbox dispatcher's publish path was
/// proven for the writer side (interceptor → outbox row → publisher
/// dispatch loop) by <c>OutboxE2ETests</c>, but had no real production
/// consumer wired in. This subscriber closes that gap: a billing
/// transition in <c>Subscription</c> now produces an observable trail
/// in logs and OTel without coupling Accounts to ShramSafal at the
/// domain layer.
/// </para>
///
/// <para>
/// <b>Why not a projection table.</b> A persisted projection would have
/// required a new schema + migration + read-side code — substantial
/// surface for a "first subscriber" proof. Structured logs + Activity
/// events give ops the same observability with zero schema risk; if a
/// future read-model needs the same data, a second subscriber can
/// project alongside this one without changing this class.
/// </para>
///
/// <para>
/// <b>Idempotency.</b> Logs and Activity events are append-only and
/// idempotent by nature; the dispatcher's at-least-once delivery
/// (publish then mark processed) means a redelivery will append a
/// duplicate log line, which is acceptable here. Future projection
/// subscribers must use <see cref="OutboxMessage.Id"/> as their
/// idempotency key.
/// </para>
/// </summary>
public sealed class SubscriptionLifecycleAuditSubscriber :
    IDomainEventHandler<SubscriptionActivated>,
    IDomainEventHandler<SubscriptionPastDue>,
    IDomainEventHandler<SubscriptionExpired>,
    IDomainEventHandler<SubscriptionCanceled>
{
    public const string ActivitySource = "AgriSync.Accounts.SubscriptionLifecycle";

    private static readonly ActivitySource Source = new(ActivitySource);

    private readonly ILogger<SubscriptionLifecycleAuditSubscriber> _logger;

    public SubscriptionLifecycleAuditSubscriber(
        ILogger<SubscriptionLifecycleAuditSubscriber> logger)
    {
        _logger = logger;
    }

    public Task HandleAsync(SubscriptionActivated domainEvent, CancellationToken cancellationToken)
    {
        EmitActivity(
            "subscription.activated",
            domainEvent.SubscriptionId.Value,
            domainEvent.OwnerAccountId.Value,
            domainEvent.OccurredOnUtc,
            tag: ("plan_code", domainEvent.PlanCode),
            tag2: ("is_trial", domainEvent.IsTrial.ToString()));

        _logger.LogInformation(
            "Subscription {SubscriptionId} activated for owner {OwnerAccountId}: plan={PlanCode}, trial={IsTrial}, validUntil={ValidUntilUtc:o}.",
            domainEvent.SubscriptionId,
            domainEvent.OwnerAccountId,
            domainEvent.PlanCode,
            domainEvent.IsTrial,
            domainEvent.ValidUntilUtc);

        return Task.CompletedTask;
    }

    public Task HandleAsync(SubscriptionPastDue domainEvent, CancellationToken cancellationToken)
    {
        EmitActivity(
            "subscription.past_due",
            domainEvent.SubscriptionId.Value,
            domainEvent.OwnerAccountId.Value,
            domainEvent.OccurredOnUtc,
            tag: ("grace_period_ends_at_utc", domainEvent.GracePeriodEndsAtUtc.ToString("o")));

        _logger.LogWarning(
            "Subscription {SubscriptionId} past due for owner {OwnerAccountId}: gracePeriodEndsAt={GracePeriodEndsAtUtc:o}.",
            domainEvent.SubscriptionId,
            domainEvent.OwnerAccountId,
            domainEvent.GracePeriodEndsAtUtc);

        return Task.CompletedTask;
    }

    public Task HandleAsync(SubscriptionExpired domainEvent, CancellationToken cancellationToken)
    {
        EmitActivity(
            "subscription.expired",
            domainEvent.SubscriptionId.Value,
            domainEvent.OwnerAccountId.Value,
            domainEvent.OccurredOnUtc,
            tag: ("expired_at_utc", domainEvent.ExpiredAtUtc.ToString("o")));

        _logger.LogWarning(
            "Subscription {SubscriptionId} expired for owner {OwnerAccountId} at {ExpiredAtUtc:o}.",
            domainEvent.SubscriptionId,
            domainEvent.OwnerAccountId,
            domainEvent.ExpiredAtUtc);

        return Task.CompletedTask;
    }

    public Task HandleAsync(SubscriptionCanceled domainEvent, CancellationToken cancellationToken)
    {
        EmitActivity(
            "subscription.canceled",
            domainEvent.SubscriptionId.Value,
            domainEvent.OwnerAccountId.Value,
            domainEvent.OccurredOnUtc,
            tag: ("canceled_at_utc", domainEvent.CanceledAtUtc.ToString("o")));

        _logger.LogInformation(
            "Subscription {SubscriptionId} canceled for owner {OwnerAccountId} at {CanceledAtUtc:o}.",
            domainEvent.SubscriptionId,
            domainEvent.OwnerAccountId,
            domainEvent.CanceledAtUtc);

        return Task.CompletedTask;
    }

    private static void EmitActivity(
        string eventName,
        Guid subscriptionId,
        Guid ownerAccountId,
        DateTime occurredOnUtc,
        (string Key, string Value) tag,
        (string Key, string Value)? tag2 = null)
    {
        // Activity is best-effort observability — if no listener is
        // attached (no OTel pipeline), this is a no-op. The structured
        // log statement above is the always-on fallback.
        var current = Activity.Current;
        if (current is null)
        {
            return;
        }

        var tags = new ActivityTagsCollection
        {
            ["event.name"] = eventName,
            ["subscription.id"] = subscriptionId.ToString(),
            ["owner_account.id"] = ownerAccountId.ToString(),
            ["event.occurred_on_utc"] = occurredOnUtc.ToString("o"),
            [tag.Key] = tag.Value,
        };
        if (tag2.HasValue)
        {
            tags[tag2.Value.Key] = tag2.Value.Value;
        }
        current.AddEvent(new ActivityEvent(eventName, tags: tags));
    }
}
