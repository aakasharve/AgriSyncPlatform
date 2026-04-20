using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.RotateFarmInvite;

/// <summary>
/// Explicit owner action that invalidates the currently-shared QR and
/// issues a fresh one. The old <see cref="FarmInvitation"/> moves to
/// <see cref="InvitationStatus.Revoked"/> and its token's
/// <c>IsRevoked</c> flips; any QR already printed or WhatsApp-shared
/// will stop working after this call.
///
/// Authorization: owner of the farm only.
/// </summary>
public sealed class RotateFarmInviteHandler(
    IFarmInvitationRepository invitationRepository,
    IShramSafalRepository farmRepository,
    IAuthorizationEnforcer authz,
    IClock clock)
{
    public async Task<Result<RotateFarmInviteResult>> HandleAsync(
        RotateFarmInviteCommand command,
        CancellationToken ct = default)
    {
        if (command.FarmId.IsEmpty || command.CallerUserId.IsEmpty)
        {
            return Result.Failure<RotateFarmInviteResult>(ShramSafalErrors.InvalidCommand);
        }

        await authz.EnsureIsOwner(command.CallerUserId, command.FarmId);

        var farm = await farmRepository.GetFarmByIdAsync(command.FarmId.Value, ct)
            ?? throw new InvalidOperationException($"Farm '{command.FarmId}' not found.");

        var utcNow = clock.UtcNow;

        var existing = await invitationRepository.GetActiveInvitationByFarmAsync(command.FarmId, ct);
        if (existing is not null)
        {
            var existingToken = await invitationRepository.GetActiveTokenByInvitationAsync(existing.Id, ct);
            existingToken?.Revoke(utcNow);
            existing.Revoke(utcNow);
        }

        var invitation = FarmInvitation.Issue(
            FarmInvitationId.New(),
            command.FarmId,
            command.CallerUserId,
            utcNow);

        var rawToken = IssueFarmInviteHandler.GenerateRawToken();
        var tokenHash = IssueFarmInviteHandler.ComputeTokenHash(rawToken);

        var token = FarmJoinToken.Issue(
            FarmJoinTokenId.New(),
            invitation.Id,
            command.FarmId,
            rawToken,
            tokenHash,
            utcNow);

        await invitationRepository.AddInvitationAsync(invitation, ct);
        await invitationRepository.AddTokenAsync(token, ct);
        await invitationRepository.SaveChangesAsync(ct);

        return Result.Success(new RotateFarmInviteResult(
            new IssueFarmInviteResult(
                InvitationId: invitation.Id,
                JoinTokenId: token.Id,
                FarmId: farm.Id,
                FarmName: farm.Name,
                FarmCode: farm.FarmCode ?? "",
                Token: rawToken,
                IssuedAtUtc: token.CreatedAtUtc)));
    }
}
