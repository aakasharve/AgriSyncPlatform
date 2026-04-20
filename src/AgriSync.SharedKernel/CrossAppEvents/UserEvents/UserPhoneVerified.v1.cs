using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.UserEvents;

public sealed record UserPhoneVerifiedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    UserId UserId,
    string PhoneNumberNormalized,
    DateTime VerifiedAtUtc);
