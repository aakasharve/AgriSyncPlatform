using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Memberships.ClaimJoin;

public sealed record ClaimJoinCommand(
    string Token,
    string FarmCode,
    UserId CallerUserId,
    bool PhoneVerified);

public sealed record ClaimJoinResult(
    Guid MembershipId,
    FarmId FarmId,
    string FarmName,
    string Role,
    bool WasAlreadyMember);
