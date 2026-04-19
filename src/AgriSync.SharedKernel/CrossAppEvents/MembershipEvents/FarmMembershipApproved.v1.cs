using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.MembershipEvents;

public sealed record FarmMembershipApprovedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    Guid FarmMembershipId,
    FarmId FarmId,
    UserId UserId,
    UserId ApprovedByUserId);
