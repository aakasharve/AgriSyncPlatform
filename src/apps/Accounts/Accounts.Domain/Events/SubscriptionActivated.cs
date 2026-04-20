using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Domain.Events;

public sealed record SubscriptionActivated(
    Guid EventId,
    DateTime OccurredOnUtc,
    SubscriptionId SubscriptionId,
    OwnerAccountId OwnerAccountId,
    string PlanCode,
    DateTime ValidFromUtc,
    DateTime ValidUntilUtc,
    bool IsTrial) : IDomainEvent;

public sealed record SubscriptionPastDue(
    Guid EventId,
    DateTime OccurredOnUtc,
    SubscriptionId SubscriptionId,
    OwnerAccountId OwnerAccountId,
    DateTime GracePeriodEndsAtUtc) : IDomainEvent;

public sealed record SubscriptionExpired(
    Guid EventId,
    DateTime OccurredOnUtc,
    SubscriptionId SubscriptionId,
    OwnerAccountId OwnerAccountId,
    DateTime ExpiredAtUtc) : IDomainEvent;

public sealed record SubscriptionCanceled(
    Guid EventId,
    DateTime OccurredOnUtc,
    SubscriptionId SubscriptionId,
    OwnerAccountId OwnerAccountId,
    DateTime CanceledAtUtc) : IDomainEvent;
