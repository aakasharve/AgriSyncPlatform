using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.MembershipEvents;

public sealed record FarmMembershipCreatedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    Guid FarmMembershipId,
    FarmId FarmId,
    UserId UserId,
    string Role,
    string Status,
    string JoinedVia,
    FarmInvitationId? InvitationId);
