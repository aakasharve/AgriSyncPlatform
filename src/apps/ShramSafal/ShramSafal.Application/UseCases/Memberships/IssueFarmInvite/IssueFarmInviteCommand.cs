using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;

public sealed record IssueFarmInviteCommand(FarmId FarmId, UserId CallerUserId);

/// <summary>
/// Issue response. The raw <see cref="Token"/> is returned only here —
/// it is never retrievable from the DB afterwards. The owner's client
/// stores it in the QR payload; the server stores only the hash.
/// </summary>
public sealed record IssueFarmInviteResult(
    FarmInvitationId InvitationId,
    FarmJoinTokenId JoinTokenId,
    FarmId FarmId,
    string FarmName,
    string FarmCode,
    string Token,
    DateTime IssuedAtUtc);
