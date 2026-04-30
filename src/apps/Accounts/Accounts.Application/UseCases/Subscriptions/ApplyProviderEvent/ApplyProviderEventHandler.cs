using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Accounts.Application.Ports;
using Accounts.Domain.Subscriptions;

namespace Accounts.Application.UseCases.Subscriptions.ApplyProviderEvent;

/// <summary>
/// Applies a billing-provider webhook event to the matching subscription.
///
/// Safety properties:
///   - Idempotent: a duplicate ProviderEventId is a no-op (returns
///     <see cref="ApplyProviderEventResult"/> with WasDuplicate=true).
///   - I7 preserved: never writes Status directly; delegates to the
///     Subscription aggregate methods (Activate, MarkPastDue, Expire, Cancel).
///   - Unknown event types are logged and accepted (HTTP 200) so the provider
///     stops retrying and the raw payload is stored for forensics.
/// </summary>
public sealed class ApplyProviderEventHandler(
    ISubscriptionRepository subscriptionRepository,
    IClock clock)
{
    public async Task<Result<ApplyProviderEventResult>> HandleAsync(
        ApplyProviderEventCommand command,
        CancellationToken ct = default)
    {
        // Idempotency guard — same event ID must never apply twice.
        if (await subscriptionRepository.WebhookEventExistsAsync(command.ProviderEventId, ct))
        {
            return Result.Success(new ApplyProviderEventResult(WasDuplicate: true, WasUnknownEventType: false));
        }

        var utcNow = clock.UtcNow;

        // Resolve the subscription if an ID was supplied. For events that
        // don't carry a sub ID (rare but possible) we skip mutation and
        // still record the raw event for audit.
        Subscription? subscription = null;
        if (command.SubscriptionId.HasValue && !command.SubscriptionId.Value.IsEmpty)
        {
            subscription = await subscriptionRepository.GetByIdAsync(command.SubscriptionId.Value, ct);
        }

        var wasUnknown = false;
        if (subscription is not null)
        {
            var applyResult = ApplyEvent(subscription, command, utcNow);
            if (!applyResult.IsSuccess)
            {
                // Sub-plan 03 Task 3: validation-class command failure is a
                // Result.Failure, not a thrown exception. Return early WITHOUT
                // persisting the raw event — a malformed activation payload
                // means the provider should resend, not that we should record
                // a half-applied state.
                return Result.Failure<ApplyProviderEventResult>(applyResult.Error);
            }
            wasUnknown = !applyResult.Value;
        }

        // Always persist the raw event for audit/forensics regardless of whether
        // the subscription was found or the event type was recognized.
        await subscriptionRepository.AddWebhookEventAsync(
            new SubscriptionWebhookEvent(
                Guid.NewGuid(),
                command.ProviderEventId,
                command.EventType,
                command.SubscriptionId?.Value,
                utcNow,
                command.RawPayload),
            ct);

        await subscriptionRepository.SaveChangesAsync(ct);

        return Result.Success(new ApplyProviderEventResult(WasDuplicate: false, WasUnknownEventType: wasUnknown));
    }

    /// <summary>
    /// Applies the event to the aggregate. Returns a <see cref="Result{T}"/>
    /// where <c>Value = true</c> when the event was recognized and applied,
    /// <c>Value = false</c> when the event type is unknown (forensic-only
    /// path), and <see cref="Result{T}.IsSuccess"/> = false when the
    /// command violates a precondition (e.g. activation without
    /// <c>ValidUntilUtc</c>).
    /// </summary>
    private static Result<bool> ApplyEvent(Subscription subscription, ApplyProviderEventCommand command, DateTime utcNow)
    {
        switch (command.EventType)
        {
            case ProviderEventTypes.SubscriptionActivated:
            case ProviderEventTypes.SubscriptionRenewed:
                if (command.ValidUntilUtc is null)
                {
                    return Result.Failure<bool>(Error.Validation(
                        "Accounts.MissingValidUntilUtc",
                        $"Event '{command.EventType}' requires ValidUntilUtc."));
                }
                var validFrom = command.ValidFromUtc ?? utcNow;
                subscription.Activate(validFrom, command.ValidUntilUtc.Value, command.BillingProviderCustomerId, utcNow);
                return Result.Success(true);

            case ProviderEventTypes.SubscriptionPastDue:
                var gracePeriodEnd = command.GracePeriodEndsAtUtc ?? utcNow.AddDays(7);
                subscription.MarkPastDue(gracePeriodEnd, utcNow);
                return Result.Success(true);

            case ProviderEventTypes.SubscriptionExpired:
                subscription.Expire(utcNow);
                return Result.Success(true);

            case ProviderEventTypes.SubscriptionCanceled:
                subscription.Cancel(utcNow);
                return Result.Success(true);

            case ProviderEventTypes.SubscriptionSuspended:
                subscription.Suspend(utcNow);
                return Result.Success(true);

            default:
                return Result.Success(false);
        }
    }
}

public sealed record ApplyProviderEventResult(bool WasDuplicate, bool WasUnknownEventType);
