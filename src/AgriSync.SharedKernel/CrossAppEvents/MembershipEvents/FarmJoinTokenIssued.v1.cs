using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.MembershipEvents;

public sealed record FarmJoinTokenIssuedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    FarmJoinTokenId FarmJoinTokenId,
    FarmInvitationId FarmInvitationId,
    FarmId FarmId,
    string SuggestedRole,
    DateTime ExpiresAtUtc,
    int? MaxUses);
