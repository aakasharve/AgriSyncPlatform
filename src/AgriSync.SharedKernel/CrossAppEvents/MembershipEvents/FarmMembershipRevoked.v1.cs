using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.MembershipEvents;

public sealed record FarmMembershipRevokedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    Guid FarmMembershipId,
    FarmId FarmId,
    UserId UserId,
    UserId RevokedByUserId,
    string Reason);
