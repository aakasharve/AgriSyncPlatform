using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using Accounts.Domain.OwnerAccounts;

namespace Accounts.Domain.Events;

/// <summary>
/// Domain event raised when an <see cref="OwnerAccount"/> is created.
///
/// This is a DOMAIN event private to the Accounts app. The infrastructure
/// layer translates it to the public integration event
/// <c>OwnerAccountCreatedV1</c> (SharedKernel) via the Outbox. No other
/// App is allowed to import this type.
/// </summary>
public sealed record OwnerAccountCreated(
    Guid EventId,
    DateTime OccurredOnUtc,
    OwnerAccountId OwnerAccountId,
    UserId PrimaryOwnerUserId,
    string AccountName,
    OwnerAccountType AccountType) : IDomainEvent;
