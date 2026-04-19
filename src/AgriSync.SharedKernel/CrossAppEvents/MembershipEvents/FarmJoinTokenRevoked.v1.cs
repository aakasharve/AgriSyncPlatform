using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.MembershipEvents;

public sealed record FarmJoinTokenRevokedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    FarmJoinTokenId FarmJoinTokenId,
    FarmId FarmId,
    UserId RevokedByUserId,
    DateTime RevokedAtUtc);
