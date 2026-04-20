using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Memberships.ExitMembership;

public sealed record ExitMembershipCommand(Guid MembershipId, UserId CallerUserId);

public sealed record ExitMembershipResult(Guid MembershipId, bool AlreadyExited);
