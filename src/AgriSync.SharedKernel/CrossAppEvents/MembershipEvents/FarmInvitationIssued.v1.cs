using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.SharedKernel.CrossAppEvents.MembershipEvents;

public sealed record FarmInvitationIssuedV1(
    Guid EventId,
    DateTime OccurredOnUtc,
    FarmInvitationId FarmInvitationId,
    FarmId FarmId,
    string ProposedRole,
    UserId CreatedByUserId,
    DateTime ExpiresAtUtc,
    int? MaxUses,
    bool RequireApproval);
